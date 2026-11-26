using System.Text.Json;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Types;

namespace Tamma.Core.Tests.Documents;

[TestFixture]
public sealed class PlanTaskKindAndRoutingTests
{
    private readonly PlanDocumentType _docType = new();

    [TestCase("code", ResolvedTaskKind.Code)]
    [TestCase("test", ResolvedTaskKind.Test)]
    [TestCase("docs", ResolvedTaskKind.Docs)]
    [TestCase("infra", ResolvedTaskKind.Infra)]
    [TestCase("design", ResolvedTaskKind.Design)]
    [TestCase("investigation", ResolvedTaskKind.Investigation)]
    [TestCase("chore", ResolvedTaskKind.Chore)]
    [TestCase("CODE", ResolvedTaskKind.Code)]
    public void PlanDocumentType_accepts_all_closed_task_kinds_and_PlanRouting_resolves_them(
        string rawKind, ResolvedTaskKind expected)
    {
        var json = $$"""
            {
              "tasks": [
                {
                  "id": "T-1",
                  "kind": "{{rawKind}}",
                  "description": "Do work",
                  "files": ["src/A.cs"],
                  "dependsOn": [],
                  "testing": "unit test"
                }
              ],
              "files": ["src/A.cs"]
            }
            """;

        using var doc = JsonDocument.Parse(json);
        var result = _docType.Validate(doc.RootElement);
        result.IsValid.Should().BeTrue();

        var taskJson = doc.RootElement.GetProperty("tasks")[0].GetRawText();
        var resolved = PlanRouting.ResolveKind(taskJson);
        resolved.Kind.Should().Be(expected);
        resolved.KindWire.Should().Be(rawKind.ToLowerInvariant());
    }

    [Test]
    public void Absent_kind_is_valid_defaults_to_code_and_round_trips_legacy_plan_generation_fixture()
    {
        // AC1 / AC8: legacy plan-generation fixture with no "kind" field validates and round-trips.
        const string legacyPlan = """
            {
              "tasks": [
                {
                  "id": "T-1",
                  "description": "Legacy task without kind",
                  "files": ["src/Legacy.cs"],
                  "dependsOn": [],
                  "testing": "unit tests pass"
                }
              ],
              "files": ["src/Legacy.cs"]
            }
            """;

        using var doc = JsonDocument.Parse(legacyPlan);
        _docType.Validate(doc.RootElement).IsValid.Should().BeTrue();

        var roundTripped = JsonSerializer.Deserialize<Plan>(legacyPlan, DocumentJson.Options);
        roundTripped.Should().NotBeNull();
        roundTripped!.Tasks.Should().ContainSingle();
        roundTripped.Tasks[0].Kind.Should().BeNull();

        var taskJson = doc.RootElement.GetProperty("tasks")[0].GetRawText();
        var resolved = PlanRouting.ResolveKind(taskJson);
        resolved.Kind.Should().Be(ResolvedTaskKind.Code);
        resolved.KindWire.Should().Be("code");
        resolved.RawKind.Should().BeNull();
    }

    [TestCase("deploy")]
    [TestCase("bogus")]
    [TestCase("")]
    public void Out_of_vocab_kind_fails_validation_with_TASK_KIND_OUT_OF_VOCABULARY_and_resolves_to_Unknown(string badKind)
    {
        var json = $$"""
            {
              "tasks": [
                {
                  "id": "T-9",
                  "kind": "{{badKind}}",
                  "description": "Bad kind task",
                  "files": ["src/X.cs"],
                  "dependsOn": [],
                  "testing": "unit"
                }
              ],
              "files": ["src/X.cs"]
            }
            """;

        using var doc = JsonDocument.Parse(json);
        var result = _docType.Validate(doc.RootElement);
        result.IsValid.Should().BeFalse();
        result.Violations.Should().Contain(v =>
            v.Code == PlanDocumentType.TaskKindOutOfVocabulary &&
            v.Message.Contains("T-9") &&
            v.Message.Contains(badKind));

        var taskJson = doc.RootElement.GetProperty("tasks")[0].GetRawText();
        var resolved = PlanRouting.ResolveKind(taskJson);
        resolved.Kind.Should().Be(ResolvedTaskKind.Unknown);
        resolved.KindWire.Should().Be("unknown");
        resolved.RawKind.Should().Be(badKind);
    }

    [Test]
    public void PlanDocumentType_contract_teaches_closed_kind_vocabulary()
    {
        var contract = _docType.RenderContract();
        contract.Should().Contain("\"kind\"");
        foreach (var token in new[] { "code", "test", "docs", "infra", "design", "investigation", "chore" })
            contract.Should().Contain(token);
    }

    [Test]
    public void PlanRouting_TargetFor_never_maps_any_task_kind_to_deployment_pipeline()
    {
        foreach (var kind in Enum.GetValues<ResolvedTaskKind>())
        {
            var target = PlanRouting.TargetFor(kind);
            target.TargetWorkflow.Should().NotBe("deployment-pipeline",
                "deployment-pipeline is post-merge step 15 and requires MergeSha (AC2)");
        }

        PlanRouting.TargetFor(ResolvedTaskKind.Code).RouteMode.Should().Be(PlanRouting.ModeCoding);
        PlanRouting.TargetFor(ResolvedTaskKind.Infra).RouteMode.Should().Be(PlanRouting.ModeCoding);
        PlanRouting.TargetFor(ResolvedTaskKind.Chore).RouteMode.Should().Be(PlanRouting.ModeCoding);
        PlanRouting.TargetFor(ResolvedTaskKind.Test).TargetWorkflow.Should().Be("test-case-creation");
        PlanRouting.TargetFor(ResolvedTaskKind.Investigation).TargetWorkflow.Should().Be("research");
        PlanRouting.TargetFor(ResolvedTaskKind.Design).TargetWorkflow.Should().Be("design-proposal");
        PlanRouting.TargetFor(ResolvedTaskKind.Docs).RouteMode.Should().Be(PlanRouting.ModeDeferToHuman);
        PlanRouting.TargetFor(ResolvedTaskKind.Unknown).RouteMode.Should().Be(PlanRouting.ModeUnknown);
    }

    [Test]
    public void ResolveIssuePreRoute_branches_on_question_and_needs_human_only_and_keeps_docs_on_plan_path()
    {
        // Accepted triage decision wins over work-item labels.
        PlanRouting.ResolveIssuePreRoute(
            """{"type":"question","automation":"tamma-auto"}""",
            """{"type":"feature","labels":["feature"]}""")
            .ChosenFlow.Should().Be(PlanRouting.FlowQuestion);

        PlanRouting.ResolveIssuePreRoute(
            """{"type":"bug","automation":"needs-human"}""",
            """{"type":"bug"}""")
            .ChosenFlow.Should().Be(PlanRouting.FlowNeedsHuman);

        // AC4: docs is NOT pre-routed — takes the plan path.
        var docsRoute = PlanRouting.ResolveIssuePreRoute(
            """{"type":"docs","automation":"tamma-auto"}""",
            """{"labels":["docs"]}""");
        docsRoute.ChosenFlow.Should().Be(PlanRouting.FlowPlan);
        docsRoute.IssueType.Should().Be("docs");

        foreach (var planType in new[] { "bug", "feature", "chore", "docs", "security" })
        {
            PlanRouting.ResolveIssuePreRoute(
                $$"""{"type":"{{planType}}","automation":"tamma-auto"}""",
                null)
                .ChosenFlow.Should().Be(PlanRouting.FlowPlan);
        }

        // Fallback to work-item labels when no triage document exists.
        PlanRouting.ResolveIssuePreRoute(null, """{"labels":["question"]}""")
            .ChosenFlow.Should().Be(PlanRouting.FlowQuestion);
        PlanRouting.ResolveIssuePreRoute(null, """{"labels":["needs-human"]}""")
            .ChosenFlow.Should().Be(PlanRouting.FlowNeedsHuman);
        PlanRouting.ResolveIssuePreRoute(null, """{"labels":["documentation"]}""")
            .ChosenFlow.Should().Be(PlanRouting.FlowPlan);
    }
}
