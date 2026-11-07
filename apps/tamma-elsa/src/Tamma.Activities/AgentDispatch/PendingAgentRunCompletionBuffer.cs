using System.Collections.Concurrent;

namespace Tamma.Activities.AgentDispatch;

/// <summary>
/// Story 40-2 — the early-completion buffer for <see cref="WaitForAgentRunActivity"/>
/// (the <see cref="ADL.PendingPrMergeBuffer"/> pattern).
///
/// <para><b>The race.</b> The activity dispatches the run, then creates its bookmark. The
/// bookmark is only in the store once the workflow commits, after the activity returns. A
/// completion signal that arrives in that window finds no bookmark. Without this buffer a
/// once-only delivery is lost and the wait sits until its timeout.</para>
///
/// <para><b>Contract for the resume side (40-3).</b> On a bookmark miss, the resumer calls
/// <see cref="Record"/> with the <c>LifecycleBookmarks.ForAgentRun</c> name and the resume
/// input it would have sent. The activity calls <see cref="TryConsume"/> three times:
/// before creating its bookmarks, right after, and once more from a short durable reconcile
/// timer that only fires after the suspended state is committed (reconcile-after-persist).
/// A hit completes the wait with the buffered payload.</para>
///
/// <para><b>Only for the dispatch it belongs to.</b> Session ids are fixed per issue + task
/// (<c>adl-{issue}-task-{index}</c>), so a re-dispatch of the same task waits on the same name.
/// The activity calls <see cref="Arm"/> with its dispatch start right after dispatching; from then
/// on an entry recorded before that start, or for a run created before it, is refused — a stale
/// completion of the previous run can never complete the next one.</para>
///
/// <para>In-memory and per process, on purpose: it closes a seconds-wide ordering race in one
/// engine. Cross-process durability is 40-3's persisted signal row and reconciler; the
/// activity's <c>Timeout</c> edge is the last resort. Entries expire after <see cref="Ttl"/>.
/// The stored payload is a copy — callers' dictionaries are never kept or mutated.</para>
/// </summary>
public sealed class PendingAgentRunCompletionBuffer
{
    private static readonly TimeSpan Ttl = TimeSpan.FromHours(1);

    /// <summary>
    /// Allowance between GitHub's clock (a run's <c>created_at</c>) and this engine's (the
    /// dispatch start). The recorded-at check needs none: both sides read this process's clock.
    /// </summary>
    internal static readonly TimeSpan RunClockSkew = TimeSpan.FromSeconds(60);

    private readonly ConcurrentDictionary<string, (Dictionary<string, object> Input, DateTimeOffset At)> _pending =
        new(StringComparer.Ordinal);

    // Per bookmark name: when the current dispatch for it started (set by Arm).
    private readonly ConcurrentDictionary<string, DateTimeOffset> _floors = new(StringComparer.Ordinal);

    /// <summary>Record a completion signal that found no suspended wait.</summary>
    public void Record(string bookmarkName, IDictionary<string, object> input)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(bookmarkName);
        ArgumentNullException.ThrowIfNull(input);
        Sweep();
        _pending[bookmarkName] = (new Dictionary<string, object>(input), DateTimeOffset.UtcNow);
    }

    /// <summary>
    /// Bind <paramref name="bookmarkName"/> to the dispatch that started at
    /// <paramref name="dispatchStartedAt"/>. Session ids — and so bookmark names — repeat when a
    /// task is re-dispatched, so from now on only a completion that can belong to THIS dispatch
    /// is handed out: one recorded before it started is dropped here, and one whose run was
    /// created before it started (less <see cref="RunClockSkew"/>) is refused by
    /// <see cref="TryConsume"/>. Called by the wait right after a successful dispatch.
    /// </summary>
    public void Arm(string bookmarkName, DateTimeOffset dispatchStartedAt)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(bookmarkName);
        _floors[bookmarkName] = dispatchStartedAt;
        if (_pending.TryGetValue(bookmarkName, out var entry) && entry.At < dispatchStartedAt)
            _pending.TryRemove(KeyValuePair.Create(bookmarkName, entry)); // only if not replaced meanwhile
    }

    /// <summary>
    /// Remove and return the recorded signal for this name. True at most once per record, and
    /// never for a completion that cannot belong to the dispatch <see cref="Arm"/> bound the
    /// name to (a refused entry is removed too).
    /// </summary>
    public bool TryConsume(string bookmarkName, out IDictionary<string, object> input)
    {
        input = default!;
        if (string.IsNullOrWhiteSpace(bookmarkName)) return false;
        if (!_pending.TryRemove(bookmarkName, out var entry)) return false;
        if (DateTimeOffset.UtcNow - entry.At > Ttl) return false;
        if (_floors.TryGetValue(bookmarkName, out var floor) && !BelongsTo(entry.Input, entry.At, floor))
            return false;
        input = entry.Input;
        return true;
    }

    private static bool BelongsTo(IDictionary<string, object> input, DateTimeOffset recordedAt, DateTimeOffset dispatchStartedAt)
    {
        if (recordedAt < dispatchStartedAt) return false;
        return !AgentRunCompletionSignal.TryReadRunCreatedAt(input, out var created)
               || new DateTimeOffset(created, TimeSpan.Zero) + RunClockSkew >= dispatchStartedAt;
    }

    private void Sweep()
    {
        var cutoff = DateTimeOffset.UtcNow - Ttl;
        foreach (var (key, value) in _pending)
        {
            if (value.At < cutoff) _pending.TryRemove(key, out _);
        }
        foreach (var (key, at) in _floors)
        {
            if (at < cutoff) _floors.TryRemove(key, out _);
        }
    }
}
