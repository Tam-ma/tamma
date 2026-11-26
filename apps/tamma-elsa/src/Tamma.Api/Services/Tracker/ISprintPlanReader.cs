using Tamma.Core.Documents.Types;

namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-4 AC9 (D7 / Amendment A4) — read view returned by
/// <see cref="ISprintPlanReader"/>. Carries the <b>shipped</b>
/// <see cref="SprintPlan"/> record from <c>Tamma.Core.Documents.Types</c>
/// verbatim — this namespace deliberately declares NO parallel entry record so
/// the apply seam can never drift from <see cref="SprintPlanDocumentType"/>.
/// </summary>
public sealed record SprintPlanDocument(
    Guid DocumentId,
    int Revision,
    SprintPlan Plan);

/// <summary>
/// Story 44-4 AC9 (D7) — narrow seam for reading an accepted <c>sprint-plan</c>
/// document from the 39-11 document store. Keeps the tenant-scoped
/// <c>IDocumentInstanceRepository.GetByIdAsync</c> read and AC9's type + status
/// gate in one testable, fixture-substitutable place.
/// </summary>
public interface ISprintPlanReader
{
    /// <summary>
    /// Load the document and enforce AC9's gates:
    /// <list type="bullet">
    /// <item>missing → throws <c>TRACKER.DOCUMENT_NOT_FOUND</c> (HTTP 404)</item>
    /// <item><c>DocumentType != "sprint-plan"</c> → throws <c>DOCUMENT_NOT_SPRINT_PLAN</c> (HTTP 409)</item>
    /// <item><c>Status != "accepted"</c> → throws <c>DOCUMENT_NOT_ACCEPTED</c> (HTTP 409)</item>
    /// </list>
    /// </summary>
    Task<SprintPlanDocument> ReadAcceptedAsync(
        Guid tenantId, Guid documentId, CancellationToken ct = default);
}
