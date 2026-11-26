using System.Diagnostics;
using System.Text.Json;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Documents;
using Tamma.Core.Documents;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Orchestrator.Tools;

/// <summary>
/// Story 39-17 (AC2 / AC4 / D6) — read-only single-document fetch backed by
/// Story 39-11's <see cref="IDocumentInstanceRepository.GetByIdAsync"/> and
/// <see cref="LineageAssembler.AssembleDocument"/>.
///
/// <para>When <see cref="OrchestratorToolContext.ActingUserId"/> is set (39-19
/// chat attenuation), verifies the acting user can view the document's issue/repo
/// via Story 39-20's <see cref="ITaskAudienceResolver"/> before returning it.</para>
/// </summary>
public sealed class DocumentGetTool : IPrincipalScopedToolExecutor
{
    private readonly OrchestratorToolContext _ctx;
    private readonly IDocumentInstanceRepository _documents;
    private readonly ITaskAudienceResolver? _audience;

    public DocumentGetTool(
        OrchestratorToolContext ctx,
        IDocumentInstanceRepository documents,
        ITaskAudienceResolver? audience = null)
    {
        _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
        _documents = documents ?? throw new ArgumentNullException(nameof(documents));
        _audience = audience;
    }

    public string ToolName => "document_get";
    public ToolDescriptor Descriptor => ToolDescriptor.Default;
    public string Description =>
        "Fetch a single validated document instance by documentId from the tenant's document store. Read-only.";

    public Dictionary<string, object> InputSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new Dictionary<string, object>
        {
            ["documentId"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "UUID of the document instance." },
            ["repoKey"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional repository full name (owner/repo) for user-scope check." },
        },
        ["required"] = new[] { "documentId" },
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
                return Fail(toolCallId, sw, "document_get requires a non-empty tenant scope.");

            if (string.IsNullOrWhiteSpace(argumentsJson))
                return Fail(toolCallId, sw, "documentId is required.");

            using var doc = JsonDocument.Parse(argumentsJson);
            if (!doc.RootElement.TryGetProperty("documentId", out var idEl)
                || idEl.ValueKind != JsonValueKind.String
                || !Guid.TryParse(idEl.GetString(), out var documentId)
                || documentId == Guid.Empty)
            {
                return Fail(toolCallId, sw, "Valid UUID 'documentId' is required.");
            }

            string? repoKey = null;
            if (doc.RootElement.TryGetProperty("repoKey", out var rEl) && rEl.ValueKind == JsonValueKind.String)
                repoKey = rEl.GetString();

            var row = await _documents.GetByIdAsync(_ctx.TenantId.Value, documentId, cancellationToken)
                .ConfigureAwait(false);
            if (row is null)
                return Fail(toolCallId, sw, $"Document '{documentId}' not found in tenant scope.");

            if (_ctx.ActingUserId is { } actingUser && _audience is not null)
            {
                var taskRef = new TaskRef(_ctx.TenantId.Value, InitiatorUserId: null, RepoKey: repoKey, IssueId: row.IssueId, DocumentId: documentId);
                var canSee = await _audience.CanSeeAsync(actingUser, taskRef)
                    .ConfigureAwait(false);
                if (!canSee)
                    return Fail(toolCallId, sw, $"Access denied: acting user is not authorized to read document '{documentId}'.");
            }

            var entry = LineageAssembler.AssembleDocument(row);
            var output = JsonSerializer.Serialize(entry, DocumentJson.Options);
            return new ToolExecutionResult(toolCallId, ToolName, true, output, sw.ElapsedMilliseconds);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Fail(toolCallId, sw, $"document_get failed: {ex.Message}");
        }
    }

    private ToolExecutionResult Fail(string toolCallId, Stopwatch sw, string msg) =>
        new(toolCallId, ToolName, false, msg, sw.ElapsedMilliseconds);
}

/// <summary>
/// Story 39-17 (AC2 / AC4 / D6) — read-only issue document lineage assembly backed
/// by Story 39-11's <see cref="IDocumentInstanceRepository.ListByIssueAsync"/> and
/// <see cref="LineageAssembler.Assemble"/>.
/// </summary>
public sealed class DocumentLineageTool : IPrincipalScopedToolExecutor
{
    private readonly OrchestratorToolContext _ctx;
    private readonly IDocumentInstanceRepository _documents;
    private readonly ITaskAudienceResolver? _audience;

    public DocumentLineageTool(
        OrchestratorToolContext ctx,
        IDocumentInstanceRepository documents,
        ITaskAudienceResolver? audience = null)
    {
        _ctx = ctx ?? throw new ArgumentNullException(nameof(ctx));
        _documents = documents ?? throw new ArgumentNullException(nameof(documents));
        _audience = audience;
    }

    public string ToolName => "document_lineage";
    public ToolDescriptor Descriptor => ToolDescriptor.Default;
    public string Description =>
        "Read the full document revision lineage and attached reviews for an issueId in the tenant's document store. Read-only.";

    public Dictionary<string, object> InputSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new Dictionary<string, object>
        {
            ["issueId"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Issue identifier (e.g. 'owner/repo#42' or tracker key)." },
            ["audience"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional audience filter." },
            ["repoKey"] = new Dictionary<string, object> { ["type"] = "string", ["description"] = "Optional repository full name (owner/repo) for user-scope check." },
        },
        ["required"] = new[] { "issueId" },
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
                return Fail(toolCallId, sw, "document_lineage requires a non-empty tenant scope.");

            if (string.IsNullOrWhiteSpace(argumentsJson))
                return Fail(toolCallId, sw, "issueId is required.");

            using var doc = JsonDocument.Parse(argumentsJson);
            if (!doc.RootElement.TryGetProperty("issueId", out var issueEl)
                || issueEl.ValueKind != JsonValueKind.String
                || string.IsNullOrWhiteSpace(issueEl.GetString()))
            {
                return Fail(toolCallId, sw, "issueId is required.");
            }

            var issueId = issueEl.GetString()!.Trim();
            string? audience = null;
            if (doc.RootElement.TryGetProperty("audience", out var audEl) && audEl.ValueKind == JsonValueKind.String)
                audience = audEl.GetString();
            string? repoKey = null;
            if (doc.RootElement.TryGetProperty("repoKey", out var rEl) && rEl.ValueKind == JsonValueKind.String)
                repoKey = rEl.GetString();

            if (_ctx.ActingUserId is { } actingUser && _audience is not null)
            {
                var taskRef = new TaskRef(_ctx.TenantId.Value, InitiatorUserId: null, RepoKey: repoKey, IssueId: issueId);
                var canSee = await _audience.CanSeeAsync(actingUser, taskRef)
                    .ConfigureAwait(false);
                if (!canSee)
                    return Fail(toolCallId, sw, $"Access denied: acting user is not authorized to read lineage for issue '{issueId}'.");
            }

            var rows = await _documents.ListByIssueAsync(_ctx.TenantId.Value, issueId, audience, cancellationToken)
                .ConfigureAwait(false);
            var lineage = LineageAssembler.Assemble(issueId, rows);
            var output = JsonSerializer.Serialize(lineage, DocumentJson.Options);
            return new ToolExecutionResult(toolCallId, ToolName, true, output, sw.ElapsedMilliseconds);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Fail(toolCallId, sw, $"document_lineage failed: {ex.Message}");
        }
    }

    private ToolExecutionResult Fail(string toolCallId, Stopwatch sw, string msg) =>
        new(toolCallId, ToolName, false, msg, sw.ElapsedMilliseconds);
}
