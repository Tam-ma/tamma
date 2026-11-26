using System.Text.Json;
using Tamma.Core;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Types;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Production <see cref="ISprintPlanReader"/> (Story 44-4 AC9 / D7 / A4).
/// Reads <c>DocumentInstance.BodyJson</c> through
/// <see cref="IDocumentInstanceRepository.GetByIdAsync"/> and deserializes into
/// the shipped <see cref="SprintPlan"/> record using <see cref="DocumentJson.Options"/>.
/// Re-validates nothing (the 41-1b validator already gated acceptance — D10),
/// mutates no document, and emits no events.
/// </summary>
public sealed class DocumentSprintPlanReader(
    IDocumentInstanceRepository documents) : ISprintPlanReader
{
    private static readonly string ExpectedTypeWire = DocumentTypeKey.SprintPlan.ToWire();
    private static readonly string AcceptedStatusWire = DocumentInstanceStatus.Accepted.ToWire();

    public async Task<SprintPlanDocument> ReadAcceptedAsync(
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
                "DOCUMENT_NOT_SPRINT_PLAN",
                $"Document '{documentId}' has type '{row.DocumentType}', expected '{ExpectedTypeWire}' "
                + "(DOCUMENT_NOT_SPRINT_PLAN).",
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
                + "Only accepted sprint-plan documents may be applied (DOCUMENT_NOT_ACCEPTED).",
                new Dictionary<string, object?>
                {
                    ["documentId"] = documentId,
                    ["actualStatus"] = row.Status,
                    ["expectedStatus"] = AcceptedStatusWire,
                },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }

        SprintPlan? plan;
        try
        {
            plan = JsonSerializer.Deserialize<SprintPlan>(row.BodyJson, DocumentJson.Options);
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

        return new SprintPlanDocument(row.Id, row.Revision, plan ?? new SprintPlan());
    }
}
