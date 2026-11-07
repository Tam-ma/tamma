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
/// <para>In-memory and per process, on purpose: it closes a seconds-wide ordering race in one
/// engine. Cross-process durability is 40-3's persisted signal row and reconciler; the
/// activity's <c>Timeout</c> edge is the last resort. Entries expire after <see cref="Ttl"/>.
/// The stored payload is a copy — callers' dictionaries are never kept or mutated.</para>
/// </summary>
public sealed class PendingAgentRunCompletionBuffer
{
    private static readonly TimeSpan Ttl = TimeSpan.FromHours(1);

    private readonly ConcurrentDictionary<string, (Dictionary<string, object> Input, DateTimeOffset At)> _pending =
        new(StringComparer.Ordinal);

    /// <summary>Record a completion signal that found no suspended wait.</summary>
    public void Record(string bookmarkName, IDictionary<string, object> input)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(bookmarkName);
        ArgumentNullException.ThrowIfNull(input);
        Sweep();
        _pending[bookmarkName] = (new Dictionary<string, object>(input), DateTimeOffset.UtcNow);
    }

    /// <summary>Remove and return the recorded signal for this name. True at most once per record.</summary>
    public bool TryConsume(string bookmarkName, out IDictionary<string, object> input)
    {
        input = default!;
        if (string.IsNullOrWhiteSpace(bookmarkName)) return false;
        if (!_pending.TryRemove(bookmarkName, out var entry)) return false;
        if (DateTimeOffset.UtcNow - entry.At > Ttl) return false;
        input = entry.Input;
        return true;
    }

    private void Sweep()
    {
        var cutoff = DateTimeOffset.UtcNow - Ttl;
        foreach (var (key, value) in _pending)
        {
            if (value.At < cutoff) _pending.TryRemove(key, out _);
        }
    }
}
