using System.Text.Json;
using Tamma.Activities.LlmCall.Models;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (AC1 / D9) — per-tenant persistent conversation session held in
/// memory by <see cref="OrchestratorAgentInstance"/>.
///
/// <para><b>The session is a cache; the DCB stream is the memory of record.</b>
/// On restart, <see cref="RehydrateFromStreamAsync"/> seeds a bootstrap context
/// block from recent tenant events; when turns exceed <c>CompactAfterTurns</c>
/// or estimated tokens exceed <c>MaxSessionTokens</c>, older turns are folded
/// into a deterministic summary block (zero extra LLM calls).</para>
/// </summary>
public sealed class OrchestratorSession
{
    public const string SystemPrompt =
        "You are the Tamma Orchestrator Agent — the stateful per-tenant decision-maker riding above " +
        "the Elsa execution workflows. Inspect documents, reviews, lineage, and effective acceptance rules " +
        "using your closed audited toolset. For acceptance requests, output strict JSON matching either:\n" +
        "  {\"routing\":\"decide-self\",\"decision\":{\"kind\":\"accept\"|\"request-revision\"|\"escalate\",...},\"reasoningSummary\":\"...\"}\n" +
        "or\n" +
        "  {\"routing\":\"assign-to-role\",\"roleWire\":\"<role>\",\"basis\":\"initiator\"|\"repo-access\",\"reasoningSummary\":\"...\"}\n" +
        "Never fabricate tool outputs, never bypass server guardrails, and respect the configured autonomy level.";

    private readonly object _gate = new();
    private readonly List<ConversationMessage> _messages = new();
    private int _turnsSinceCompaction;

    public Guid TenantId { get; }
    public string? BootstrapContext { get; private set; }
    public int CompactionCount { get; private set; }

    public OrchestratorSession(Guid tenantId)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("TenantId is required.", nameof(tenantId));
        TenantId = tenantId;
        _messages.Add(new ConversationMessage { Role = "system", Content = SystemPrompt });
    }

    /// <summary>Snapshot of current conversation messages.</summary>
    public IReadOnlyList<ConversationMessage> Snapshot()
    {
        lock (_gate)
            return _messages.ToList();
    }

    /// <summary>Live mutable list passed into <see cref="IOrchestratorTurnRunner"/> (caller holds per-instance turn lock).</summary>
    public List<ConversationMessage> Messages => _messages;

    /// <summary>
    /// Re-hydrate bootstrap context from the tenant's DCB stream (D9) after a
    /// cold start or restart. Returns <c>true</c> if prior events existed
    /// (restart re-hydration), <c>false</c> on a fresh tenant with no prior stream.
    /// </summary>
    public async Task<bool> RehydrateFromStreamAsync(
        IEventRepository events,
        int maxEvents = 40,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(events);

        var recent = new List<string>();
        foreach (var prefix in new[] { "ORCHESTRATOR.", "APPROVAL.", "ESCALATION.", "DOCUMENT." })
        {
            var (rows, _) = await events.QueryEventsAsync(
                TenantId,
                type: prefix,
                typeIsPrefix: true,
                correlationId: null,
                actor: null,
                from: null,
                to: null,
                cursor: null,
                limit: Math.Max(5, maxEvents / 4),
                includeTotal: false).ConfigureAwait(false);

            foreach (var r in rows)
            {
                var summary = r.Data is { Length: > 160 } d ? d[..160] + "..." : r.Data ?? "{}";
                recent.Add($"[{r.CreatedAt:O}] {r.Type} (seq={r.SequenceNumber}): {summary}");
            }
        }

        if (recent.Count == 0)
            return false;

        BootstrapContext = "Re-hydrated recent tenant stream context:\n" + string.Join("\n", recent.Take(maxEvents));
        lock (_gate)
        {
            _messages.Add(new ConversationMessage
            {
                Role = "system",
                Content = BootstrapContext,
            });
        }

        return true;
    }

    /// <summary>Append a user/workflow prompt message and increment the turn counter.</summary>
    public void AppendUserTurn(string content)
    {
        lock (_gate)
        {
            _messages.Add(new ConversationMessage { Role = "user", Content = content });
            _turnsSinceCompaction++;
        }
    }

    /// <summary>
    /// Deterministic context compaction (D9): when turns exceed
    /// <paramref name="compactAfterTurns"/> or estimated tokens exceed
    /// <paramref name="maxSessionTokens"/>, folds older non-system turns into a
    /// single bounded summary block while retaining the system prompt(s) and the
    /// most recent turns. Zero extra LLM calls.
    /// </summary>
    public bool CompactIfNeeded(int maxSessionTokens, int compactAfterTurns)
    {
        lock (_gate)
        {
            var estimatedTokens = EstimateTokens(_messages);
            if (_turnsSinceCompaction < compactAfterTurns && estimatedTokens <= maxSessionTokens)
                return false;

            // Keep leading system prompts and the last 4 messages intact.
            var firstNonSystem = _messages.FindIndex(m => !string.Equals(m.Role, "system", StringComparison.OrdinalIgnoreCase));
            if (firstNonSystem < 0) return false;

            const int keepTail = 4;
            var foldableCount = _messages.Count - firstNonSystem - keepTail;
            if (foldableCount <= 1) return false;

            var folded = _messages.GetRange(firstNonSystem, foldableCount);
            var digestLines = folded
                .Where(m => !string.IsNullOrWhiteSpace(m.Content))
                .Select(m =>
                {
                    var text = m.Content!.Replace('\n', ' ').Trim();
                    if (text.Length > 120) text = text[..120] + "...";
                    return $"- {m.Role}: {text}";
                })
                .Take(20)
                .ToList();

            var summaryBlock = new ConversationMessage
            {
                Role = "system",
                Content = $"[Compacted {folded.Count} earlier messages]\n" + string.Join("\n", digestLines),
            };

            _messages.RemoveRange(firstNonSystem, foldableCount);
            _messages.Insert(firstNonSystem, summaryBlock);
            _turnsSinceCompaction = 0;
            CompactionCount++;
            return true;
        }
    }

    /// <summary>Rough 4-chars-per-token heuristic used for deterministic compaction triggers.</summary>
    public static int EstimateTokens(IReadOnlyList<ConversationMessage> messages)
    {
        var chars = 0;
        foreach (var m in messages)
            chars += (m.Content?.Length ?? 0) + 16;
        return chars / 4;
    }
}
