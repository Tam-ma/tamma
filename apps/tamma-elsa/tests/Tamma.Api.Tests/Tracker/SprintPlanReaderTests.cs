using System.Reflection;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Api.Dtos.Tracker;
using Tamma.Api.Services.Tracker;
using Tamma.Core;
using Tamma.Core.Documents.Types;
using Tamma.Core.Tracking;

namespace Tamma.Api.Tests.Tracker;

/// <summary>
/// Story 44-4 pure reflection &amp; source-isolation tests (no Docker):
/// - Test 20c (AC9): no type in <c>Tamma.Api.Services.Tracker</c> redeclares
///   <see cref="SprintPlan"/> / <see cref="SprintCommittedItem"/> / <see cref="SprintCarryOverItem"/>
/// - Test 19b (AC10b / D9): tracker iteration/board/apply services have ZERO
///   references to <c>ITaskAudienceResolver</c>, <c>ChannelAudience</c>, or <c>"TASK."</c>
/// - Step 7 / A6 DoD: <see cref="ApplyOutcome"/> is ONE shared record used by both apply seams
/// - AC6 / D5: <see cref="BoardGroupBy"/> is a closed, ordinal 5-member vocabulary
/// </summary>
[TestFixture]
public class SprintPlanReaderTests
{
    [Test]
    public void No_tracker_type_redeclares_the_document_shape()
    {
        // AC9 / Test 20c: no type under Tamma.Api.Services.Tracker may redeclare
        // sprintId / committed / carryOver / ownerRole / estimate. The seam MUST
        // deserialize the shipped Tamma.Core.Documents.Types.SprintPlan directly.
        var trackerServiceTypes = typeof(SprintPlanApplyService).Assembly
            .GetTypes()
            .Where(t => string.Equals(t.Namespace, "Tamma.Api.Services.Tracker", StringComparison.Ordinal))
            .ToList();

        trackerServiceTypes.Should().NotBeEmpty();

        var forbiddenShape = new[] { "SprintId", "Committed", "CarryOver", "OwnerRole", "Estimate" };
        var offenders = trackerServiceTypes
            .Where(t =>
            {
                var propNames = t.GetProperties(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                    .Select(p => p.Name)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);
                return forbiddenShape.Count(f => propNames.Contains(f)) >= 2;
            })
            .Select(t => t.FullName)
            .ToList();

        offenders.Should().BeEmpty(
            "AC9: Tamma.Api.Services.Tracker must deserialize the shipped Tamma.Core.Documents.Types.SprintPlan "
            + "and declare NO parallel entry record of its own");

        // Positive confirmation: SprintPlanDocument.Plan carries the shipped SprintPlan.
        typeof(SprintPlanDocument)
            .GetProperty(nameof(SprintPlanDocument.Plan))!
            .PropertyType.Should().Be(typeof(SprintPlan));
    }

    [Test]
    public void Tracker_services_do_not_reference_the_task_plane()
    {
        // AC10b / D9 / Test 19b: structural isolation from the 39-19/39-20 decision inbox
        // (the code half of the 41-6 AC3 correction).
        var trackerServicesDir = LocateTrackerServicesDir();
        var files = Directory.GetFiles(trackerServicesDir, "*.cs", SearchOption.AllDirectories);
        files.Should().NotBeEmpty();

        // Pre-existing Story 44-2 files that legitimately reference ITaskAudienceResolver
        // for AC6 assignee picker and AC7 list visibility (never for sprint commitment):
        var preExisting442AudienceFiles = new HashSet<string>(StringComparer.Ordinal)
        {
            "ITrackerService.cs",
            "TrackerService.cs",
            "TrackerAssigneeResolver.cs",
        };

        foreach (var file in files)
        {
            var fileName = Path.GetFileName(file);
            var content = File.ReadAllText(file);

            content.Should().NotContain("ChannelAudience",
                $"AC10b: '{fileName}' must not reference ChannelAudience (decision-inbox plane)");
            content.Should().NotContain("\"TASK.",
                $"AC10b: '{fileName}' must not reference any \"TASK.\" event literal");

            if (!preExisting442AudienceFiles.Contains(fileName))
            {
                content.Should().NotContain("ITaskAudienceResolver",
                    $"AC10b/D9: '{fileName}' must not import ITaskAudienceResolver — sprint commitment is a tracker write, never a Task-View decision");
            }
        }
    }

    [Test]
    public void ApplyOutcome_is_shared_by_both_apply_seams()
    {
        // Step 7 / A6 DoD: one shared ApplyOutcome record used by BOTH OrderingApplyService
        // and SprintPlanApplyService, not two duplicate records.
        typeof(ApplyOrderingResponse)
            .GetProperty(nameof(ApplyOrderingResponse.Outcomes))!
            .PropertyType.Should().Be(typeof(IReadOnlyList<ApplyOutcome>));

        typeof(ApplySprintPlanResponse)
            .GetProperty(nameof(ApplySprintPlanResponse.Outcomes))!
            .PropertyType.Should().Be(typeof(IReadOnlyList<ApplyOutcome>));
    }

    [Test]
    public void BoardGroupBy_vocabulary_is_closed_and_ordinal()
    {
        Enum.GetValues<BoardGroupBy>().Select(g => g.ToWire())
            .Should().Equal("status", "assignee", "kind", "priority", "iteration");

        foreach (var g in Enum.GetValues<BoardGroupBy>())
            BoardGroupByExtensions.Parse(g.ToWire()).Should().Be(g);

        var bad = () => BoardGroupByExtensions.Parse("STATUS");
        bad.Should().Throw<TammaError>().Which.Code.Should().Be("TRACKER.UNKNOWN_GROUP_BY");
    }

    private static string LocateTrackerServicesDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(
                dir.FullName, "apps", "tamma-elsa", "src", "Tamma.Api", "Services", "Tracker");
            if (Directory.Exists(candidate))
                return candidate;
            dir = dir.Parent;
        }
        throw new InvalidOperationException("Could not locate apps/tamma-elsa/src/Tamma.Api/Services/Tracker.");
    }
}
