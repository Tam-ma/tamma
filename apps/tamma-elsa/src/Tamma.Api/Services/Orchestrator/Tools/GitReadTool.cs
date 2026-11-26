using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Access;
using Tamma.Platforms.Abstractions;
using Tamma.Platforms.Abstractions.Models;

namespace Tamma.Api.Services.Orchestrator.Tools;

/// <summary>
/// Story 39-17 (AC2 / AC4 / D6) — read-only git inspection tool for the
/// Orchestrator Agent. Strictly allowlisted to read-only operations
/// (<c>file_content</c>, <c>branches</c>, <c>repo</c>, <c>pr_diff</c>) backed
/// by the tenant's <see cref="IPlatformResolver"/> / <see cref="IGitPlatformClient"/>.
/// Deliberately a separate class from the write-capable <c>GitOperationsTool</c>.
///
/// <para>When <see cref="OrchestratorToolContext.ActingUserId"/> is set (chat
/// attenuation), enforces <see cref="IRepoAccessEvaluator"/> (<c>&gt;= read</c>)
/// before touching the platform driver.</para>
/// </summary>
public sealed class GitReadTool : IPrincipalScopedToolExecutor
{
    public static readonly IReadOnlySet<string> AllowedOperations =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "file_content",
            "branches",
            "repo",
            "pr",
        };

    private const int MaxFileBytes = 64 * 1024;

    private readonly OrchestratorToolContext _ctx;
    private readonly IPlatformResolver _platforms;
    private readonly IRepoAccessEvaluator? _repoAccess;

    public GitReadTool(
        OrchestratorToolContext ctx,
        IPlatformResolver platforms,
        IRepoAccessEvaluator? repoAccess = null)
    {
        _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
        _platforms = platforms ?? throw new ArgumentNullException(nameof(platforms));
        _repoAccess = repoAccess;
    }

    public string ToolName => "git_read";
    public ToolDescriptor Descriptor => ToolDescriptor.Default;
    public string Description =>
        "Read-only git repository inspection over the tenant's connected platform driver: " +
        "'file_content' (owner, repo, path, ref), 'branches' (owner, repo), 'repo' (owner, repo), " +
        "or 'pr' (owner, repo, prNumber). Never mutates git state.";

    public Dictionary<string, object> InputSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new Dictionary<string, object>
        {
            ["operation"] = new Dictionary<string, object> { ["type"] = "string", ["enum"] = new[] { "file_content", "branches", "repo", "pr" } },
            ["owner"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Repository owner/org." },
            ["repo"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Repository name." },
            ["path"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "File path (for file_content)." },
            ["ref"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Git ref/branch/SHA (for file_content, default 'main')." },
            ["prNumber"] = new Dictionary<string, object> { ["type"] = "integer", ["description"] = "Pull request number (for pr)." },
        },
        ["required"] = new[] { "operation", "owner", "repo" },
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
                return Fail(toolCallId, sw, "git_read requires a non-empty tenant scope.");

            if (string.IsNullOrWhiteSpace(argumentsJson))
                return Fail(toolCallId, sw, "operation, owner, and repo are required.");

            using var doc = JsonDocument.Parse(argumentsJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return Fail(toolCallId, sw, "Arguments must be a JSON object.");

            var root = doc.RootElement;
            var op = GetString(root, "operation")?.Trim().ToLowerInvariant();
            var owner = GetString(root, "owner")?.Trim();
            var repo = GetString(root, "repo")?.Trim();

            if (string.IsNullOrWhiteSpace(op) || !AllowedOperations.Contains(op))
                return Fail(toolCallId, sw, $"Operation '{op}' is not allowed. Read-only operations: file_content, branches, repo, pr.");
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

            switch (op)
            {
                case "repo":
                {
                    var res = await driver.Client.GetRepoAsync(owner, repo, cancellationToken).ConfigureAwait(false);
                    return res switch
                    {
                        PlatformResult<Repo>.Ok(var value) => Ok(toolCallId, sw, JsonSerializer.Serialize(value)),
                        PlatformResult<Repo>.Failed(var err) => Fail(toolCallId, sw, $"Failed to read repo '{repoFullName}': {err}"),
                        _ => Fail(toolCallId, sw, $"Failed to read repo '{repoFullName}': platform service unavailable."),
                    };
                }
                case "branches":
                {
                    var res = await driver.Client.ListRepoBranchesAsync(owner, repo, cancellationToken).ConfigureAwait(false);
                    return res switch
                    {
                        PlatformResult<IReadOnlyList<Branch>>.Ok(var value) => Ok(toolCallId, sw, JsonSerializer.Serialize(value)),
                        PlatformResult<IReadOnlyList<Branch>>.Failed(var err) => Fail(toolCallId, sw, $"Failed to list branches for '{repoFullName}': {err}"),
                        _ => Fail(toolCallId, sw, $"Failed to list branches for '{repoFullName}': platform service unavailable."),
                    };
                }
                case "file_content":
                {
                    var path = GetString(root, "path")?.Trim();
                    if (string.IsNullOrWhiteSpace(path))
                        return Fail(toolCallId, sw, "'path' is required for operation 'file_content'.");
                    var gitRef = GetString(root, "ref")?.Trim();
                    if (string.IsNullOrWhiteSpace(gitRef)) gitRef = "main";
                    var res = await driver.Client.GetFileContentAsync(
                        new GetFileContentRequest(owner, repo, path, gitRef), cancellationToken).ConfigureAwait(false);
                    return res switch
                    {
                        PlatformResult<byte[]>.Ok(var bytes) => Ok(toolCallId, sw, JsonSerializer.Serialize(new
                        {
                            path,
                            gitRef,
                            truncated = bytes.Length > MaxFileBytes,
                            content = Encoding.UTF8.GetString(bytes.Length > MaxFileBytes ? bytes[..MaxFileBytes] : bytes),
                        })),
                        PlatformResult<byte[]>.Failed(var err) => Fail(toolCallId, sw, $"Failed to read '{path}' at '{gitRef}': {err}"),
                        _ => Fail(toolCallId, sw, $"Failed to read '{path}' at '{gitRef}': platform service unavailable."),
                    };
                }
                case "pr":
                {
                    if (!root.TryGetProperty("prNumber", out var prEl) || !prEl.TryGetInt32(out var prNum) || prNum <= 0)
                        return Fail(toolCallId, sw, "Positive integer 'prNumber' is required for operation 'pr'.");
                    var res = await driver.Client.GetPullRequestAsync(
                        owner, repo, prNum.ToString(System.Globalization.CultureInfo.InvariantCulture), cancellationToken).ConfigureAwait(false);
                    return res switch
                    {
                        PlatformResult<PullRequest>.Ok(var value) => Ok(toolCallId, sw, JsonSerializer.Serialize(value)),
                        PlatformResult<PullRequest>.Failed(var err) => Fail(toolCallId, sw, $"Failed to read PR #{prNum} on '{repoFullName}': {err}"),
                        _ => Fail(toolCallId, sw, $"Failed to read PR #{prNum} on '{repoFullName}': platform service unavailable."),
                    };
                }
                default:
                    return Fail(toolCallId, sw, $"Unsupported operation '{op}'.");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Fail(toolCallId, sw, $"git_read failed: {ex.Message}");
        }
    }

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String
            ? el.GetString()
            : null;

    private ToolExecutionResult Ok(string toolCallId, Stopwatch sw, string output) =>
        new(toolCallId, ToolName, true, output, sw.ElapsedMilliseconds);

    private ToolExecutionResult Fail(string toolCallId, Stopwatch sw, string msg) =>
        new(toolCallId, ToolName, false, msg, sw.ElapsedMilliseconds);
}
