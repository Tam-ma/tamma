using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Management.Activities.SetOutput;
using Elsa.Workflows.Memory;
using Elsa.Workflows.Models;
using Elsa.Workflows.Options;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using NUnit.Framework;
using Tamma.Activities.Testing;
using Tamma.Activities.Testing.Models;
using ElsaSequence = Elsa.Workflows.Activities.Sequence;

namespace Tamma.Activities.Tests.Testing;

/// <summary>
/// The pass-path checks of the testing pipeline (coverage, lint, security) and the
/// report that turns them into the workflow's <c>passed</c> output. <c>passed</c> is what
/// the parent cycle trusts to merge, so the boundaries are what these pin.
/// Each test runs the real activity through a real <see cref="IWorkflowRunner"/>.
/// </summary>
[TestFixture]
public class QualityCheckActivitiesTests
{
    private static CIResultsPayload Ci(
        double coverage = 95, int lintWarnings = 0, int lintErrors = 0,
        bool build = true, int failedTests = 0, params SecuritySeverity[] vulns) => new()
    {
        RunId = "run-7",
        BuildPassed = build,
        TotalTests = 10,
        PassedTests = 10 - failedTests,
        FailedTests = failedTests,
        CoveragePercentage = coverage,
        LintWarnings = lintWarnings,
        LintErrors = lintErrors,
        SecurityIssues = vulns.Select((s, i) => new SecurityVulnerability
        {
            Id = $"v{i}", Severity = s, Package = "pkg", Description = "d",
        }).ToList(),
    };

    // ── CheckCoverage ────────────────────────────────────────────────────────

    [Test]
    public async Task Coverage_AtTheLevelBar_Passes_JustBelow_Fails()
    {
        var bar = QualityThresholds.ForSkillLevel(3).MinCoveragePercent;

        var at = await RunCoverageAsync(Ci(coverage: bar), 3);
        var below = await RunCoverageAsync(Ci(coverage: bar - 0.1), 3);

        at.Passed.Should().BeTrue();
        at.Gap.Should().Be(0);
        below.Passed.Should().BeFalse();
        below.Gap.Should().BeApproximately(0.1, 1e-9);
        below.RequiredCoverage.Should().Be(bar);
    }

    [Test]
    public async Task Coverage_Override_ReplacesTheLevelBar()
    {
        var result = await RunCoverageAsync(Ci(coverage: 50), 5, overrideMin: 40);

        result.Passed.Should().BeTrue();
        result.RequiredCoverage.Should().Be(40);
    }

    // ── CheckLinting ─────────────────────────────────────────────────────────

    [Test]
    public async Task Lint_WarningsUpToTheAllowance_Pass()
    {
        var allowed = QualityThresholds.ForSkillLevel(1).MaxLintWarnings;

        var result = await RunLintAsync(Ci(lintWarnings: allowed), 1);

        result.Passed.Should().BeTrue();
        result.Issues.Should().BeEmpty();
    }

    [Test]
    public async Task Lint_OneWarningOverTheAllowance_Fails_AsAutoFixableWarning()
    {
        var allowed = QualityThresholds.ForSkillLevel(1).MaxLintWarnings;

        var result = await RunLintAsync(Ci(lintWarnings: allowed + 1), 1);

        result.Passed.Should().BeFalse();
        result.Issues.Should().ContainSingle()
            .Which.Should().Match<QualityIssue>(i => i.Severity == QualityIssueSeverity.Warning && i.AutoFixable);
    }

    [Test]
    public async Task Lint_AnyError_Fails_AtEveryLevel()
    {
        var result = await RunLintAsync(Ci(lintErrors: 1), 1);

        result.Passed.Should().BeFalse();
        result.Issues.Should().ContainSingle(i => i.Severity == QualityIssueSeverity.Error);
    }

    // ── CheckSecurity ────────────────────────────────────────────────────────

    [Test]
    public async Task Security_HighWithinTheLevelAllowance_Passes()
    {
        var result = await RunSecurityAsync(Ci(vulns: [SecuritySeverity.High, SecuritySeverity.Medium]), 1);

        result.Passed.Should().BeTrue();
        result.HighCount.Should().Be(1);
        result.MediumCount.Should().Be(1);
    }

    [Test]
    public async Task Security_HighOverTheAllowance_Fails()
    {
        var result = await RunSecurityAsync(Ci(vulns: [SecuritySeverity.High]), 3);

        result.Passed.Should().BeFalse();
    }

    [Test]
    public async Task Security_AnyCritical_Fails_AtEveryLevel()
    {
        var result = await RunSecurityAsync(Ci(vulns: [SecuritySeverity.Critical]), 1);

        result.Passed.Should().BeFalse();
        result.CriticalCount.Should().Be(1);
    }

    [Test]
    public async Task Security_LowAndMedium_NeverFail()
    {
        var result = await RunSecurityAsync(
            Ci(vulns: [SecuritySeverity.Low, SecuritySeverity.Medium, SecuritySeverity.Info]), 5);

        result.Passed.Should().BeTrue();
    }

    // ── GenerateQualityReport ────────────────────────────────────────────────

    [Test]
    public async Task Report_AllGreen_PassesWithGradeA_AndCountsThePass()
    {
        var report = await RunReportAsync(Ci(), skillLevel: 3, consecutivePasses: 1);

        report.Passed.Should().BeTrue();
        report.Grade.Should().Be("A");
        report.OverallScore.Should().Be(100);
        report.ConsecutivePassCount.Should().Be(2);
        report.RunId.Should().Be("run-7");
        report.AllIssues.Should().BeEmpty();
    }

    [Test]
    public async Task Report_BuildFailure_NeverPasses_AndResetsTheStreak()
    {
        var report = await RunReportAsync(Ci(build: false), skillLevel: 3, consecutivePasses: 5);

        report.Passed.Should().BeFalse();
        report.ConsecutivePassCount.Should().Be(0);
        report.AllIssues.Should().Contain(i =>
            i.Category == QualityIssueCategory.Build && i.Severity == QualityIssueSeverity.Critical);
        report.Recommendations.First().Should().StartWith("Fix build errors");
    }

    [Test]
    public async Task Report_FailingTests_NeverPass_AndAreListedAsTheIssue()
    {
        // Every other check is green: the failing tests are the only reason this fails,
        // so they must be in AllIssues and drive the teaching feedback — not be silently
        // missing from the report while `passed` says false.
        var report = await RunReportAsync(Ci(failedTests: 2), skillLevel: 3, consecutivePasses: 0);

        report.Passed.Should().BeFalse();
        report.AllTestsPassed.Should().BeFalse();
        report.AllIssues.Should().Contain(i => i.Category == QualityIssueCategory.Test);
        report.TeachingFeedback.Should().Contain("Failing tests");
    }

    [Test]
    public async Task Report_AllowedHighVulnerability_StillPasses()
    {
        var report = await RunReportAsync(Ci(vulns: [SecuritySeverity.High]), skillLevel: 1, consecutivePasses: 0);

        report.Passed.Should().BeTrue();
        report.AllIssues.Should().NotContain(i => i.Category == QualityIssueCategory.Security);
    }

    [TestCase(2, false)]
    [TestCase(3, true)]
    public async Task Report_FlagsTightenedThresholds_AfterThreePasses(int passes, bool tightened)
    {
        var report = await RunReportAsync(Ci(), skillLevel: 3, consecutivePasses: passes);

        report.ThresholdsTightened.Should().Be(tightened);
    }

    [TestCase(1, "Great job!")]
    [TestCase(3, "Well done!")]
    [TestCase(5, "Excellent work!")]
    public async Task Report_TeachingFeedback_IsPitchedAtTheSkillLevel(int level, string opening)
    {
        var report = await RunReportAsync(Ci(), skillLevel: level, consecutivePasses: 0);

        report.TeachingFeedback.Should().StartWith(opening);
    }

    // ── Harness ─────────────────────────────────────────────────────────────

    private static Task<CoverageCheckResult> RunCoverageAsync(CIResultsPayload ci, int level, double? overrideMin = null) =>
        RunAsync<CoverageCheckResult>(v => new CheckCoverageActivity
        {
            CIResults = new(ci),
            SkillLevel = new(level),
            MinCoverageOverride = new(overrideMin),
            Result = new(v),
        });

    private static Task<LintCheckResult> RunLintAsync(CIResultsPayload ci, int level) =>
        RunAsync<LintCheckResult>(v => new CheckLintingActivity { CIResults = new(ci), SkillLevel = new(level), Result = new(v) });

    private static Task<SecurityCheckResult> RunSecurityAsync(CIResultsPayload ci, int level) =>
        RunAsync<SecurityCheckResult>(v => new CheckSecurityActivity { CIResults = new(ci), SkillLevel = new(level), Result = new(v) });

    /// <summary>Runs the three checks first, as <c>TestingWorkflow</c> does, then the report.</summary>
    private static async Task<QualityReport> RunReportAsync(CIResultsPayload ci, int skillLevel, int consecutivePasses)
    {
        var coverage = await RunCoverageAsync(ci, skillLevel);
        var lint = await RunLintAsync(ci, skillLevel);
        var security = await RunSecurityAsync(ci, skillLevel);
        return await RunAsync<QualityReport>(v => new GenerateQualityReportActivity
        {
            SessionId = new(Guid.NewGuid()),
            CIResults = new(ci),
            CoverageResult = new(coverage),
            LintResult = new(lint),
            SecurityResult = new(security),
            SkillLevel = new(skillLevel),
            ConsecutivePassCount = new(consecutivePasses),
            Result = new(v),
        });
    }

    private static async Task<T> RunAsync<T>(Func<Variable<T?>, IActivity> build)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddElsa(elsa => elsa
            .AddActivity<CheckCoverageActivity>()
            .AddActivity<CheckLintingActivity>()
            .AddActivity<CheckSecurityActivity>()
            .AddActivity<GenerateQualityReportActivity>());

        await using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var runner = scope.ServiceProvider.GetRequiredService<IWorkflowRunner>();

        var run = await runner.RunAsync(new ProbeWorkflow<T>(build), new RunWorkflowOptions(), CancellationToken.None);

        run.WorkflowState.SubStatus.Should().Be(WorkflowSubStatus.Finished, "the check must not fault");
        return (T)run.WorkflowState.Output["result"];
    }

    private sealed class ProbeWorkflow<T>(Func<Variable<T?>, IActivity> build) : WorkflowBase
    {
        protected override void Build(IWorkflowBuilder builder)
        {
            var result = builder.WithVariable<T?>("Result", default);
            builder.Root = new ElsaSequence
            {
                Activities =
                {
                    build(result),
                    new SetOutput { OutputName = new("result"), OutputValue = new(ctx => (object?)result.Get(ctx)) },
                },
            };
        }
    }
}
