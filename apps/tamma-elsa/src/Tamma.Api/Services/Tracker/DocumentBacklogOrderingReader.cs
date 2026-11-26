using System.Text.Json;
using Tamma.Core;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Types;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Production <see cref="IBacklogOrderingReader"/> (Story 44-3 AC7/AC9 / D6).
/// Reads <c>DocumentInstance.BodyJson</c> through
/// <see cref="IDocumentInstanceRepository.GetByIdAsync"/> and deserializes into
/// the shipped <see cref="BacklogOrdering"/> / <see cref="BacklogItem"/> types
/// using <see cref="DocumentJson.Options"/>. Performs NO document mutations and
/// emits NO <c>DOCUMENT.*</c> events (D11).
/// </summary>
public sealed class DocumentBacklogOrderingReader(
    IDocumentInstanceRepository documents) : IBacklogOrderingReader
{
    private static readonly string ExpectedTypeWire = DocumentTypeKey.BacklogOrdering.ToWire();
    private static readonly string AcceptedStatusWire = DocumentInstanceStatus.Accepted.ToWire();

    public async Task<BacklogOrderingView> ReadAcceptedAsync(
        Guid tenantId, Guid documentId, CancellationToken ct = default)
    {
        var row = await documents.GetByIdAsync(tenantId, documentId, ct);
        if (row is null)
        {
            throw new TammaError(
                "TRACKER.DOCUMENT_NOT_FOUND",
                $"Document '{documentId}' does not exist in this tenant.",
                new Dictionary<string, object?> { ["documentId"] = documentId },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        if (!string.Equals(row.DocumentType, ExpectedTypeWire, StringComparison.Ordinal))
        {
            throw new TammaError(
                "DOCUMENT_NOT_BACKLOG_ORDERING",
                $"Document '{documentId}' has type '{row.DocumentType}', expected '{ExpectedTypeWire}' "
                + "(DOCUMENT_NOT_BACKLOG_ORDERING).",
                new Dictionary<string, object?>
                {
                    ["documentId"] = documentId,
                    ["actualType"] = row.DocumentType,
                    ["expectedType"] = ExpectedTypeWire,
                },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        if (!string.Equals(row.Status, AcceptedStatusWire, StringComparison.Ordinal))
        {
            throw new TammaError(
                "DOCUMENT_NOT_ACCEPTED",
                $"Document '{documentId}' has status '{row.Status}', expected '{AcceptedStatusWire}'. "
                + "Only accepted backlog-ordering documents may be applied (DOCUMENT_NOT_ACCEPTED).",
                new Dictionary<string, object?>
                {
                    ["documentId"] = documentId,
                    ["actualStatus"] = row.Status,
                    ["expectedStatus"] = AcceptedStatusWire,
                },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        BacklogOrdering? body;
        try
        {
            body = JsonSerializer.Deserialize<BacklogOrdering>(row.BodyJson, DocumentJson.Options);
        }
        catch (JsonException ex)
        {
            throw new TammaError(
                "TRACKER.INVALID_DOCUMENT_BODY",
                $"Document '{documentId}' body could not be deserialized as '{ExpectedTypeWire}': {ex.Message}",
                new Dictionary<string, object?> { ["documentId"] = documentId },
                retryable: false,
                severity: TammaErrorSeverity.High);
        }

        return new BacklogOrderingView(row.Id, row.Revision, body?.Items ?? []);
    }
}
