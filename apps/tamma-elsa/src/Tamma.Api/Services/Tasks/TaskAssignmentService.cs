using System.Text.Json;
using Tamma.Api.Authorization;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Orchestrator;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Services.Tasks;

/// <summary>
/// Story 39-20 (AC4 / AC5 / D7 / D8) — server-side task assignment and
/// completion gate. Re-derives <see cref="ITaskAudienceResolver.EligibleAudienceAsync"/>
/// on every assign/reassign and refuses unknown roles or empty audiences with a
/// typed <see cref="AssignmentResult"/> (zero events emitted). All <c>TASK.*</c>
/// events are appended fail-loud so the event stream is the authoritative record.
/// </summary>
public sealed class TaskAssignmentService(
    ITaskAudienceResolver audienceResolver,
    IEventRepository events) : ITaskAssignmentService
{
    public async Task<AssignmentResult> AssignAsync(
        Guid tenantId,
        TaskRef task,
        string roleWire,
        string basis,
        string? autonomyContextRef,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(task);

        if (tenantId == Guid.Empty || task.TenantId != tenantId)
            return AssignmentResult.Refused(AssignmentOutcome.RefusedInvalidInput, "tenantId mismatch or empty");

        if (!TaskEvents.AllowedBases.Contains(basis))
            return AssignmentResult.Refused(AssignmentOutcome.RefusedInvalidInput, $"Unknown assignment basis '{basis}'.");

        if (!TenantRoleHierarchy.IsValid(roleWire))
            return AssignmentResult.Refused(AssignmentOutcome.RefusedUnknownRole, $"Unknown role '{roleWire}'.");

        var audience = await audienceResolver.EligibleAudienceAsync(task, roleWire);
        if (audience.Count == 0)
        {
            return AssignmentResult.Refused(
                AssignmentOutcome.RefusedEmptyAudience,
                $"Role '{roleWire}' resolves to an empty eligible audience for this task.");
        }

        // Fail-loud append (D8): the event stream IS the assignment record.
        await events.AppendAsync(new DomainEvent
        {
            Id = Guid.NewGuid(),
            Type = TaskEvents.Assigned,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(BuildTags(tenantId, task, userId: null)),
            Metadata = """{"source":"TaskAssignmentService"}""",
            Data = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["roleWire"] = roleWire,
                ["audienceUserIds"] = audience.Select(m => m.UserId.ToString()).ToArray(),
                ["basis"] = basis,
                ["autonomyContextRef"] = autonomyContextRef,
                ["requiredPermission"] = task.RequiredPermission,
            }),
            CreatedAt = DateTime.UtcNow,
        });

        return AssignmentResult.Accepted(roleWire, audience);
    }

    public async Task<AssignmentResult> ReassignAsync(
        Guid tenantId,
        TaskRef task,
        string previousRoleWire,
        string newRoleWire,
        string basis,
        string? autonomyContextRef,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(task);

        if (tenantId == Guid.Empty || task.TenantId != tenantId)
            return AssignmentResult.Refused(AssignmentOutcome.RefusedInvalidInput, "tenantId mismatch or empty");

        if (!TaskEvents.AllowedBases.Contains(basis))
            return AssignmentResult.Refused(AssignmentOutcome.RefusedInvalidInput, $"Unknown assignment basis '{basis}'.");

        if (!TenantRoleHierarchy.IsValid(previousRoleWire))
            return AssignmentResult.Refused(AssignmentOutcome.RefusedUnknownRole, $"Unknown previous role '{previousRoleWire}'.");

        if (!TenantRoleHierarchy.IsValid(newRoleWire))
            return AssignmentResult.Refused(AssignmentOutcome.RefusedUnknownRole, $"Unknown target role '{newRoleWire}'.");

        var audience = await audienceResolver.EligibleAudienceAsync(task, newRoleWire);
        if (audience.Count == 0)
        {
            return AssignmentResult.Refused(
                AssignmentOutcome.RefusedEmptyAudience,
                $"Role '{newRoleWire}' resolves to an empty eligible audience for this task.");
        }

        await events.AppendAsync(new DomainEvent
        {
            Id = Guid.NewGuid(),
            Type = TaskEvents.Reassigned,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(BuildTags(tenantId, task, userId: null)),
            Metadata = """{"source":"TaskAssignmentService"}""",
            Data = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["previousRoleWire"] = previousRoleWire,
                ["roleWire"] = newRoleWire,
                ["audienceUserIds"] = audience.Select(m => m.UserId.ToString()).ToArray(),
                ["basis"] = basis,
                ["autonomyContextRef"] = autonomyContextRef,
                ["requiredPermission"] = task.RequiredPermission,
            }),
            CreatedAt = DateTime.UtcNow,
        });

        return AssignmentResult.Accepted(newRoleWire, audience);
    }

    public async Task<TaskCompletionResult> CompleteAsync(
        Guid tenantId,
        TaskRef task,
        Guid completedByUserId,
        string surface,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(task);

        if (tenantId == Guid.Empty || task.TenantId != tenantId || completedByUserId == Guid.Empty)
            return TaskCompletionResult.Refused(TaskCompletionOutcome.RefusedInvalidInput, "tenantId or completedByUserId is invalid");

        if (!TaskEvents.AllowedSurfaces.Contains(surface))
            return TaskCompletionResult.Refused(TaskCompletionOutcome.RefusedInvalidInput, $"Unknown completion surface '{surface}'.");

        // Act-time authorization against the resolver (AC4 / D7).
        var canSee = await audienceResolver.CanSeeAsync(completedByUserId, task);
        if (!canSee)
        {
            return TaskCompletionResult.Refused(
                TaskCompletionOutcome.RefusedNotEligible,
                "Caller is not eligible to complete this task.");
        }

        if (!string.IsNullOrWhiteSpace(task.RequiredPermission))
        {
            var eligible = await audienceResolver.EligibleAudienceAsync(task, TenantRoleHierarchy.Member);
            if (!eligible.Any(m => m.UserId == completedByUserId))
            {
                return TaskCompletionResult.Refused(
                    TaskCompletionOutcome.RefusedNotEligible,
                    $"Caller lacks required permission '{task.RequiredPermission}' for this task.");
            }
        }

        await events.AppendAsync(new DomainEvent
        {
            Id = Guid.NewGuid(),
            Type = TaskEvents.Completed,
            TenantId = tenantId,
            Tags = JsonSerializer.Serialize(BuildTags(tenantId, task, completedByUserId)),
            Metadata = """{"source":"TaskAssignmentService"}""",
            Data = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["completedByUserId"] = completedByUserId.ToString(),
                ["surface"] = surface,
            }),
            CreatedAt = DateTime.UtcNow,
        });

        return TaskCompletionResult.Completed();
    }

    private static Dictionary<string, object?> BuildTags(Guid tenantId, TaskRef task, Guid? userId)
    {
        var tags = new Dictionary<string, object?>
        {
            ["tenantId"] = tenantId.ToString(),
        };
        if (!string.IsNullOrWhiteSpace(task.IssueId))
            tags["issueId"] = task.IssueId;
        if (task.DocumentId is Guid docId && docId != Guid.Empty)
            tags["documentId"] = docId.ToString();
        if (userId is Guid uid && uid != Guid.Empty)
            tags["userId"] = uid.ToString();
        return tags;
    }
}
