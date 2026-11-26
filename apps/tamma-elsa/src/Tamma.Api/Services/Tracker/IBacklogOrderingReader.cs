using Tamma.Core.Documents.Types;

namespace Tamma.Api.Services.Tracker;

/// <summary>
/// Story 44-3 AC9 (D6 / Amendment A2) — read view returned by
/// <see cref="IBacklogOrderingReader"/>. Carries the <b>shipped</b>
/// <see cref="BacklogItem"/> records from <c>Tamma.Core.Documents.Types</c>
/// verbatim — this namespace deliberately declares NO parallel entry record so
/// the apply seam can never drift from <see cref="BacklogOrderingDocumentType"/>.
/// </summary>
public sealed record BacklogOrderingView(
    Guid DocumentId,
    int Revision,
    IReadOnlyList<BacklogItem> Entries);

/// <summary>
/// Story 44-3 AC7/AC9 (D6) — narrow seam for reading an accepted
/// <c>backlog-ordering</c> document from the 39-11 document store. Keeps the
/// tenant-scoped <c>IDocumentInstanceRepository.GetByIdAsync</c> call and AC7's
/// type + status gate in one testable, fixture-substitutable place.
/// </summary>
public interface IBacklogOrderingReader
{
    /// <summary>
    /// Load the document and enforce AC7's gates:
    /// <list type="bullet">
    /// <item>missing → throws <c>TRACKER.DOCUMENT_NOT_FOUND</c> (HTTP 404)</item>
    /// <item><c>DocumentType != "backlog-ordering"</c> → throws <c>DOCUMENT_NOT_BACKLOG_ORDERING</c> (HTTP 409)</item>
    /// <item><c>Status != "accepted"</c> → throws <c>DOCUMENT_NOT_ACCEPTED</c> (HTTP 409)</item>
    /// </list>
    /// </summary>
    Task<BacklogOrderingView> ReadAcceptedAsync(
        Guid tenantId, Guid documentId, CancellationToken ct = default);
}
