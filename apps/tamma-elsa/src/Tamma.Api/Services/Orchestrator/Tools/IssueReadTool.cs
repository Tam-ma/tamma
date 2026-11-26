using System.Diagnostics;
using System.Text.Json;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Access;
using Tamma.Platforms.Abstractions;
using Tamma.Platforms.Abstractions.Models;

namespace Tamma.Api.Services.Orchestrator.Tools;

/// <summary>
/// Story 39-17 (AC2 / AC4 / D6) — read-only platform/issue inspection tool
/// backed by the tenant's <see cref="IPlatformResolver"/> / <see cref="IGitPlatformClient"/>.
/// Enforces acting-user repo-scope attenuation via <see cref="IRepoAccessEvaluator"/>
/// when <see cref="OrchestratorToolContext.ActingUserId"/> is set.
/// </summary>
public sealed class IssueReadTool : IPrincipalScopedToolExecutor
{
    private readonly OrchestratorToolContext _ctx;
    private readonly IPlatformResolver _platforms;
    private readonly IRepoAccessEvaluator? _repoAccess;

    public IssueReadTool(
        OrchestratorToolContext ctx,
        IPlatformResolver platforms,
        IRepoAccessEvaluator? repoAccess = null)
    {
        _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
        _platforms = platforms ?? throw new ArgumentNullException(nameof(platforms));
        _repoAccess = repoAccess;
    }

    public string ToolName => "issue_read";
    public ToolDescriptor Descriptor => ToolDescriptor.Default;
    public string Description =>
        "Read repository metadata or a pull request / issue reference from the tenant's connected git platform. " +
        "Read-only and attenuated to the acting user's repo access scope when serving chat.";

    public Dictionary<string, object> InputSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new Dictionary<string, object>
        {
            ["owner"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Repository owner/org." },
            ["repo"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Repository name." },
            ["prNumber"] = new Dictionary<string, object> { ["type"] = "integer", ["description"] = "Optional PR number to inspect." },
        },
        ["required"] = new[] { "owner", "repo" },
    };

    public async Task<ToolExecutionResult> ExecuteAsync(
        string toolCallId,
        string argumentsJson,
        CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            if (_ctx.TenantId is null || _ctx.TenantId == Guid.Empty)
                return Fail(toolCallId, sw, "issue_read requires a non-empty tenant scope.");

            if (string.IsNullOrWhiteSpace(argumentsJson))
                return Fail(toolCallId, sw, "owner and repo are required.");

            using var doc = JsonDocument.Parse(argumentsJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return Fail(toolCallId, sw, "Arguments must be a JSON object.");

            var root = doc.RootElement;
            var owner = root.TryGetProperty("owner", out var oEl) && oEl.ValueKind == JsonValueKind.String ? oEl.GetString()?.Trim() : null;
            var repo = root.TryGetProperty("repo", out var rEl) && rEl.ValueKind == JsonValueKind.String ? rEl.GetString()?.Trim() : null;
            if (string.IsNullOrWhiteSpace(owner) || string.IsNullOrWhiteSpace(repo))
                return Fail(toolCallId, sw, "Both 'owner' and 'repo' are required.");

            var repoFullName = $"{owner}/{repo}";
            if (_ctx.ActingUserId is { } actingUser && _repoAccess is not null)
            {
                var accessLevel = await _repoAccess.GetEffectiveAccessLevelAsync(
                    actingUser, _ctx.TenantId.Value, repositoryId: null, repoFullName,
                    cancellationToken).ConfigureAwait(false);
                if (string.IsNullOrEmpty(accessLevel))
                    return Fail(toolCallId, sw, $"Access denied: acting user lacks read access to '{repoFullName}'.");
            }

            var driver = await _platforms.ResolveForTenantAsync(_ctx.TenantId.Value, cancellationToken)
                .ConfigureAwait(false);
            if (driver is null)
                return Fail(toolCallId, sw, "No git platform installation is configured for this tenant.");

            if (root.TryGetProperty("prNumber", out var prEl) && prEl.TryGetInt32(out var prNum) && prNum > 0)
            {
                var prRes = await driver.Client.GetPullRequestAsync(
                    owner, repo, prNum.ToString(System.Globalization.CultureInfo.InvariantCulture), cancellationToken)
                    .ConfigureAwait(false);
                return prRes switch
                {
                    PlatformResult<PullRequest>.Ok(var value) =>
                        new ToolExecutionResult(toolCallId, ToolName, true, JsonSerializer.Serialize(value), sw.ElapsedMilliseconds),
                    PlatformResult<PullRequest>.Failed(var err) =>
                        Fail(toolCallId, sw, $"Failed to read PR #{prNum} on '{repoFullName}': {err}"),
                    _ => Fail(toolCallId, sw, $"Failed to read PR #{prNum} on '{repoFullName}': platform service unavailable."),
                };
            }

            var repoRes = await driver.Client.GetRepoAsync(owner, repo, cancellationToken).ConfigureAwait(false);
            return repoRes switch
            {
                PlatformResult<Repo>.Ok(var value) =>
                    new ToolExecutionResult(toolCallId, ToolName, true, JsonSerializer.Serialize(value), sw.ElapsedMilliseconds),
                PlatformResult<Repo>.Failed(var err) =>
                    Fail(toolCallId, sw, $"Failed to read repository '{repoFullName}': {err}"),
                _ => Fail(toolCallId, sw, $"Failed to read repository '{repoFullName}': platform service unavailable."),
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Fail(toolCallId, sw, $"issue_read failed: {ex.Message}");
        }
    }

    private ToolExecutionResult Fail(string toolCallId, Stopwatch sw, string msg) =>
        new(toolCallId, ToolName, false, msg, sw.ElapsedMilliseconds);
}
