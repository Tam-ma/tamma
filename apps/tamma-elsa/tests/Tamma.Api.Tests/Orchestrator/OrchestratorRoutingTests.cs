using System.Text.RegularExpressions;
using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Access;
using Tamma.Api.Services.Orchestrator;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Policy;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (AC3 / D11) — proves routing is model-driven (no hard-coded
/// <c>if (autonomy &gt;= X)</c> threshold branches in <see cref="OrchestratorAgentInstance"/>):
/// autonomy 70 assigns to role via <see cref="ITaskAssignmentService"/>; autonomy
/// 100 self-decides; server refusals (<c>RefusedUnknownRole</c> /
/// <c>RefusedEmptyAudience</c>) feed back into the loop for re-routing.
/// </summary>
[TestFixture]
public class OrchestratorRoutingTests
{
    [Test]
    public async Task Autonomy_70_assigns_to_role_via_ITaskAssignmentService_while_100_self_decides()
    {
        var rig = new OrchestratorTestHarness.Rig();

        // Turn 1: autonomy=70 -> model chooses assign-to-role
        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn(
            """{"routing":"assign-to-role","roleWire":"architect","basis":"repo-access","reasoningSummary":"Autonomy is 70; delegating plan review to architect."}"""));
        var req70 = OrchestratorTestHarness.MakeRequest(docType: DocumentTypeKey.Findings, autonomyLevel: 70);
        var res70 = await rig.Instance.HandleAcceptanceRequestAsync(req70);

        res70.Routing.Should().Be("assign-to-role");
        res70.AssignedRole.Should().Be("architect");
        rig.TaskAssignment.Verify(t => t.AssignAsync(
            rig.TenantId,
            It.Is<TaskRef>(tr => tr.DocumentId == req70.Document.Id),
            "architect",
            "repo-access",
            It.Is<string?>(s => s != null && s.Contains("autonomy=70")),
            It.IsAny<CancellationToken>()), Times.Once);

        // Turn 2: autonomy=100 -> model chooses decide-self
        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn(
            """{"routing":"decide-self","decision":{"kind":"accept","note":"Clean."},"reasoningSummary":"Autonomy is 100; self-accepting."}"""));
        var req100 = OrchestratorTestHarness.MakeRequest(docType: DocumentTypeKey.Findings, autonomyLevel: 100);
        var res100 = await rig.Instance.HandleAcceptanceRequestAsync(req100);

        res100.Routing.Should().Be("decide-self");
        res100.Decision.Should().BeOfType<AcceptanceDecision.Accept>();
    }

    [Test]
    public async Task Assignment_refusal_triggers_reroute_and_accepts_second_valid_role()
    {
        var rig = new OrchestratorTestHarness.Rig();
        rig.TaskAssignment.SetupSequence(t => t.AssignAsync(
                rig.TenantId, It.IsAny<TaskRef>(), It.IsAny<string>(),
                It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(AssignmentResult.Refused(AssignmentOutcome.RefusedUnknownRole, "Role 'made_up_role' does not exist."))
            .ReturnsAsync(AssignmentResult.Accepted("tech_lead", new[] { new AudienceMember(Guid.NewGuid(), "tech_lead") }));

        rig.Runner
            .Enqueue(new ScriptedTurnRunner.ScriptedTurn(
                """{"routing":"assign-to-role","roleWire":"made_up_role","basis":"repo-access","reasoningSummary":"First attempt."}"""))
            .Enqueue(new ScriptedTurnRunner.ScriptedTurn(
                """{"routing":"assign-to-role","roleWire":"tech_lead","basis":"repo-access","reasoningSummary":"Re-routed to valid role."}"""));

        var req = OrchestratorTestHarness.MakeRequest(docType: DocumentTypeKey.Findings, autonomyLevel: 70);
        var res = await rig.Instance.HandleAcceptanceRequestAsync(req);

        rig.Runner.CallCount.Should().Be(2);
        res.Routing.Should().Be("assign-to-role");
        res.AssignedRole.Should().Be("tech_lead");
        // Second turn prompt carries the server refusal reason
        rig.Runner.RecordedRequests[1].Messages.Should().Contain(m =>
            m.Role == "user" && m.Content != null && m.Content.Contains("made_up_role"));
    }

    [Test]
    public async Task Exhausted_reroutes_on_empty_audience_fail_closed_to_escalation()
    {
        var rig = new OrchestratorTestHarness.Rig();
        rig.TaskAssignment.Setup(t => t.AssignAsync(
                rig.TenantId, It.IsAny<TaskRef>(), It.IsAny<string>(),
                It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(AssignmentResult.Refused(AssignmentOutcome.RefusedEmptyAudience, "No eligible users for role."));

        for (var i = 0; i < 3; i++)
        {
            rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn(
                """{"routing":"assign-to-role","roleWire":"architect","basis":"repo-access","reasoningSummary":"Attempt."}"""));
        }

        var req = OrchestratorTestHarness.MakeRequest(docType: DocumentTypeKey.Findings, autonomyLevel: 70);
        var res = await rig.Instance.HandleAcceptanceRequestAsync(req);

        res.Routing.Should().Be("decide-self");
        res.Decision.Should().BeOfType<AcceptanceDecision.Escalate>();
    }

    [Test]
    public void Source_pin_OrchestratorAgentInstance_contains_no_hardcoded_autonomy_threshold_branch()
    {
        var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Tamma.sln")))
            dir = dir.Parent;
        dir.Should().NotBeNull("must locate apps/tamma-elsa/Tamma.sln");

        var sourcePath = Path.Combine(
            dir!.FullName, "src", "Tamma.Api", "Services", "Orchestrator", "OrchestratorAgentInstance.cs");
        var source = File.ReadAllText(sourcePath);

        // Strip comments so doc comments describing D11 do not false-positive
        var stripped = Regex.Replace(source, @"//.*$|/\*[\s\S]*?\*/", "", RegexOptions.Multiline);

        Regex.IsMatch(stripped, @"AutonomyLevel\s*(>=|<=|>|<|==|!=)\s*\d+")
            .Should().BeFalse("Story 39-17 D11: routing is model-driven; no hardcoded autonomy threshold branch is permitted in OrchestratorAgentInstance");
    }
}
