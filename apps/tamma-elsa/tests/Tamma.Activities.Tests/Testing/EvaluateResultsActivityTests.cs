using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities.Flowchart.Activities;
using Elsa.Workflows.Management.Activities.SetOutput;
using Elsa.Workflows.Models;
using Elsa.Workflows.Options;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using NUnit.Framework;
using Tamma.Activities.Testing;
using Tamma.Activities.Testing.Models;
using FlowConnection = Elsa.Workflows.Activities.Flowchart.Models.Connection;
using FlowEndpoint = Elsa.Workflows.Activities.Flowchart.Models.Endpoint;

namespace Tamma.Activities.Tests.Testing;

/// <summary>
/// <see cref="EvaluateResultsActivity"/> decides which edge the testing pipeline takes:
/// AllPass/MinorIssues → pass, MajorIssues → auto-fix loop, Critical → escalation. A wrong
/// edge either ships a red build or burns fix attempts on a green one, so these run the
/// real activity through a real <see cref="IWorkflowRunner"/> and read the TAKEN edge.
/// </summary>
[TestFixture]
public class EvaluateResultsActivityTests
{
    private static CIResultsPayload Green(double coverage = 95) => new()
    {
        RunId = "run-1",
        Status = "Success",
        BuildPassed = true,
        TotalTests = 10,
        PassedTests = 10,
        CoveragePercentage = coverage,
    };

    [Test]
    public async Task AllGreen_TakesAllPass_WithFullScore()
    {
        var (edge, result) = await RunAsync(Green(), skillLevel: 3);

        edge.Should().Be("AllPass");
        result.Issues.Should().BeEmpty();
        result.OverallScore.Should().Be(100);
    }

    [Test]
    public async Task BuildFailure_IsCritical()
    {
        var ci = Green();
        ci.BuildPassed = false;

        var (edge, result) = await RunAsync(ci, skillLevel: 1);

        edge.Should().Be("Critical", "a red build must never reach the pass or auto-fix edge");
        result.BuildScore.Should().Be(0);
    }

    [Test]
    public async Task AFewFailedTests_AreMajor_AndListEachFailure()
    {
        var ci = Green();
        ci.FailedTests = 2;
        ci.FailedTestDetails =
        [
            new FailedTestDetail { TestName = "A", ErrorMessage = "boom" },
            new FailedTestDetail { TestName = "B", ErrorMessage = "bang" },
        ];

        var (edge, result) = await RunAsync(ci, skillLevel: 3);

        edge.Should().Be("MajorIssues");
        result.Issues.Should().Contain(i => i.Message == "Test failed: A" && i.Details == "boom");
        result.Issues.Should().Contain(i => i.Message == "Test failed: B");
    }

    [Test]
    public async Task MoreThanFiveFailedTests_AreCritical()
    {
        var ci = Green();
        ci.FailedTests = 6;

        var (edge, _) = await RunAsync(ci, skillLevel: 3);

        edge.Should().Be("Critical");
    }

    [TestCase(10.0, "MinorIssues")]  // gap ≤ 10 → warning
    [TestCase(15.0, "MajorIssues")]  // 10 < gap ≤ 20 → error
    [TestCase(25.0, "Critical")]     // gap > 20 → critical
    public async Task CoverageGap_SetsTheEdge(double gap, string expectedEdge)
    {
        var required = QualityThresholds.ForSkillLevel(3).MinCoveragePercent;

        var (edge, result) = await RunAsync(Green(coverage: required - gap), skillLevel: 3);

        edge.Should().Be(expectedEdge);
        result.CoverageScore.Should().BeApproximately((required - gap) / required * 100, 0.01);
    }

    [Test]
    public async Task CoverageExactlyAtThreshold_Passes()
    {
        var required = QualityThresholds.ForSkillLevel(4).MinCoveragePercent;

        var (edge, _) = await RunAsync(Green(coverage: required), skillLevel: 4);

        edge.Should().Be("AllPass");
    }

    [Test]
    public async Task ThreeConsecutivePasses_TightenTheCoverageBar()
    {
        var baseline = QualityThresholds.ForSkillLevel(3).MinCoveragePercent;
        var ci = Green(coverage: baseline + 1); // passes the normal bar, not the tightened one

        var (normalEdge, _) = await RunAsync(ci, skillLevel: 3, consecutivePasses: 2);
        var (tightEdge, tight) = await RunAsync(ci, skillLevel: 3, consecutivePasses: 3);

        normalEdge.Should().Be("AllPass");
        tightEdge.Should().Be("MinorIssues");
        tight.AppliedThresholds.MinCoveragePercent.Should().Be(baseline + 5);
    }

    [Test]
    public async Task SkillLevelOutOfRange_IsClamped()
    {
        var (_, low) = await RunAsync(Green(), skillLevel: -4);
        var (_, high) = await RunAsync(Green(), skillLevel: 99);

        low.SkillLevel.Should().Be(1);
        high.SkillLevel.Should().Be(5);
    }

    [Test]
    public async Task AnyLintError_IsMajor_AndAutoFixable()
    {
        var ci = Green();
        ci.LintErrors = 1;

        var (edge, result) = await RunAsync(ci, skillLevel: 1);

        edge.Should().Be("MajorIssues", "every level allows zero lint errors");
        result.AutoFixable.Should().BeTrue("lint is the auto-fix loop's bread and butter");
    }

    [Test]
    public async Task LintWarningsOverTheLevelAllowance_AreMinor()
    {
        var allowed = QualityThresholds.ForSkillLevel(2).MaxLintWarnings;
        var ci = Green();
        ci.LintWarnings = allowed + 1;

        var (edge, _) = await RunAsync(ci, skillLevel: 2);

        edge.Should().Be("MinorIssues");
    }

    [Test]
    public async Task LintWarningsWithinTheLevelAllowance_Pass()
    {
        var allowed = QualityThresholds.ForSkillLevel(1).MaxLintWarnings;
        var ci = Green();
        ci.LintWarnings = allowed;

        var (edge, _) = await RunAsync(ci, skillLevel: 1);

        edge.Should().Be("AllPass");
    }

    [Test]
    public async Task ACriticalVulnerability_IsCritical_AtEveryLevel()
    {
        var ci = Green();
        ci.SecurityIssues =
        [
            new SecurityVulnerability { Severity = SecuritySeverity.Critical, Package = "pkg", Description = "rce", CveId = "CVE-1" },
        ];

        var (edge, result) = await RunAsync(ci, skillLevel: 1);

        edge.Should().Be("Critical");
        result.Issues.Should().Contain(i => i.Details == "CVE-1");
    }

    [Test]
    public async Task HighVulnerabilitiesOverTheLevelAllowance_AreMajor()
    {
        var ci = Green();
        ci.SecurityIssues =
        [
            new SecurityVulnerability { Severity = SecuritySeverity.High, Package = "pkg", Description = "xss" },
        ];

        // Level 3+ allows no high-severity findings.
        var (edge, _) = await RunAsync(ci, skillLevel: 3);

        edge.Should().Be("MajorIssues");
    }

    [Test]
    public async Task HighVulnerabilitiesWithinTheLevelAllowance_DoNotFailTheGate()
    {
        // Level 1 allows up to MaxSecurityHigh (2) high-severity findings. The allowance
        // must actually change the routing: before the fix every listed high finding was
        // added as an Error, so the gate went MajorIssues no matter what the level allowed.
        QualityThresholds.ForSkillLevel(1).MaxSecurityHigh.Should().BeGreaterThan(0);
        var ci = Green();
        ci.SecurityIssues =
        [
            new SecurityVulnerability { Severity = SecuritySeverity.High, Package = "pkg", Description = "xss", FixVersion = "1.2.3" },
        ];

        var (edge, result) = await RunAsync(ci, skillLevel: 1);

        edge.Should().Be("MinorIssues", "an allowed finding is still reported, as a warning");
        result.Issues.Should().ContainSingle(i => i.Category == QualityIssueCategory.Security)
            .Which.AutoFixable.Should().BeTrue("a fix version exists");
    }

    [Test]
    public async Task SecurityScore_DeductsPerSeverity()
    {
        var ci = Green();
        ci.SecurityIssues =
        [
            new SecurityVulnerability { Severity = SecuritySeverity.High },
            new SecurityVulnerability { Severity = SecuritySeverity.Medium },
            new SecurityVulnerability { Severity = SecuritySeverity.Low },
        ];

        var (_, result) = await RunAsync(ci, skillLevel: 1);

        result.SecurityScore.Should().Be(100 - 15 - 5);
    }

    // ── Harness ─────────────────────────────────────────────────────────────

    private static async Task<(string Edge, QualityGateResult Result)> RunAsync(
        CIResultsPayload ci, int skillLevel, int consecutivePasses = 0)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddElsa(elsa => elsa.AddActivity<EvaluateResultsActivity>());

        await using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var runner = scope.ServiceProvider.GetRequiredService<IWorkflowRunner>();

        var run = await runner.RunAsync(
            new ProbeWorkflow(ci, skillLevel, consecutivePasses), new RunWorkflowOptions(), CancellationToken.None);

        run.WorkflowState.Status.Should().Be(WorkflowStatus.Finished);
        run.WorkflowState.SubStatus.Should().Be(WorkflowSubStatus.Finished, "the evaluator must not fault");
        var output = run.WorkflowState.Output;
        return ((string)output["edge"], (QualityGateResult)output["result"]);
    }

    private sealed class ProbeWorkflow(CIResultsPayload ci, int skillLevel, int consecutivePasses) : WorkflowBase
    {
        protected override void Build(IWorkflowBuilder builder)
        {
            var result = builder.WithVariable<QualityGateResult?>("Result", null);

            var evaluate = new EvaluateResultsActivity
            {
                Id = "Evaluate",
                CIResults = new Input<CIResultsPayload>(ci),
                SkillLevel = new Input<int>(skillLevel),
                ConsecutivePassCount = new Input<int>(consecutivePasses),
                EvaluationResult = new Output<QualityGateResult>(result),
            };

            var recordResult = new SetOutput
            {
                Id = "RecordResult",
                OutputName = new("result"),
                OutputValue = new(ctx => (object?)result.Get(ctx)),
            };

            var flowchart = new Flowchart { Start = evaluate, Activities = { evaluate, recordResult } };
            foreach (var edge in new[] { "AllPass", "MinorIssues", "MajorIssues", "Critical" })
            {
                var mark = new SetOutput
                {
                    Id = "On" + edge,
                    OutputName = new("edge"),
                    OutputValue = new(_ => (object)edge),
                };
                flowchart.Activities.Add(mark);
                flowchart.Connections.Add(new FlowConnection(new FlowEndpoint(evaluate, edge), new FlowEndpoint(mark)));
                flowchart.Connections.Add(new FlowConnection(new FlowEndpoint(mark), new FlowEndpoint(recordResult)));
            }

            builder.Root = flowchart;
        }
    }
}
