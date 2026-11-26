using System.Text.RegularExpressions;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Core.Actions;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Policy;

namespace Tamma.Core.Tests.Actions;

/// <summary>
/// Story 43-18 (AC3, AC4, AC6c, AC8, AC9) — pure unit &amp; architecture tests for
/// platform-scope shipped-level overrides:
/// <list type="bullet">
///   <item><b>AC3:</b> <see cref="IShippedLevelResolver.EffectiveShippedLevel"/>
///     returns <c>override ?? DefaultMinAutonomy</c>; evaluator's shipped-default
///     rung AND snapshot-degraded break-glass fallback both read it (both raising
///     and lowering directions at dial 60).</item>
///   <item><b>AC4:</b> guard rails — 50-line consequence floor naming both numbers
///     (e.g. delete-family 95 → 45), detent step 5 in [5,100] ∪ {101}, machinery
///     rejection naming classification, unknown key → 404, missing field → 400,
///     AlwaysHuman 101 accepted.</item>
///   <item><b>AC6(c):</b> 43-16 derived acceptor floor (<see cref="AcceptanceFloors"/>)
///     follows the override in both directions.</item>
///   <item><b>AC8:</b> stranded overrides (retired/unknown or reclassified
///     machinery keys) are detected with remediation messages.</item>
///   <item><b>AC9:</b> architecture test proves no production source file under
///     <c>src/</c> reads <c>.DefaultMinAutonomy</c> outside the resolver, catalog
///     construction, and descriptor definition.</item>
/// </list>
/// </summary>
[TestFixture]
public class ActionLevelOverrideTests
{
    private static readonly GovernancePrincipal User = GovernancePrincipal.ForUser(Guid.NewGuid());

    private static ResolvedAcceptanceRules RulesAtDial(int dial) => new(
        AcceptanceDefaults.Rules with { AutonomyLevel = dial },
        AcceptanceRulesSource.SystemDefault, 1, "base", DateTimeOffset.UtcNow);

    // ── AC3 — Override wins, shipped is the default, both directions ───────

    [Test]
    public void Ac3_Evaluator_RaisesActionFrom40To70_FlipsToRequiresHumanAtDial60_AndRevertsOnDelete()
    {
        // agent-action:code-review ships at 40 (below dial 60 → automated).
        var key = ActionKey.Parse("agent-action:code-review");
        CatalogDefaultShippedLevelResolver.Instance.ShippedDefault(key).Should().Be(40);

        var rulesAt60 = RulesAtDial(60);

        // Baseline (no override): automated at dial 60.
        var baseline = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(key, User), GovernancePolicySnapshot.Empty, rulesAt60);
        baseline.Outcome.Should().Be(AutonomyOutcome.Automated);
        baseline.EffectiveMinAutonomy.Should().Be(40);

        // Override 40 → 70: flips to RequiresHuman at dial 60.
        var overrides = new Dictionary<string, int>(StringComparer.Ordinal) { [key.ToWire()] = 70 };
        IShippedLevelResolver resolver = new DictionaryShippedLevelResolver(overrides);
        resolver.EffectiveShippedLevel(key).Should().Be(70);
        resolver.ShippedDefault(key).Should().Be(40, "shipped constant never mutates");
        resolver.LevelSource(key).Should().Be(IShippedLevelResolver.SourceOverride);

        var snapshotWithOverride = GovernancePolicySnapshot.FromSuccessfulRead(
            new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal),
            new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal),
            new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal),
            new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal),
            overrides);

        var overridden = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(key, User), snapshotWithOverride, rulesAt60, shippedLevels: resolver);
        overridden.Outcome.Should().Be(AutonomyOutcome.RequiresHuman);
        overridden.EffectiveMinAutonomy.Should().Be(70);

        // Delete override: flips back to Automated at dial 60.
        var afterDelete = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(key, User), GovernancePolicySnapshot.Empty, rulesAt60,
            shippedLevels: CatalogDefaultShippedLevelResolver.Instance);
        afterDelete.Outcome.Should().Be(AutonomyOutcome.Automated);
        afterDelete.EffectiveMinAutonomy.Should().Be(40);
    }

    [Test]
    public void Ac3_Evaluator_LowersActionFrom70To40_AutomatesAtDial60()
    {
        // effect:deploy.dev ships at 70 (above dial 60 → RequiresHuman).
        var key = ActionKey.Parse("effect:deploy.dev");
        CatalogDefaultShippedLevelResolver.Instance.ShippedDefault(key).Should().Be(70);

        var rulesAt60 = RulesAtDial(60);

        var baseline = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(key, User), GovernancePolicySnapshot.Empty, rulesAt60);
        baseline.Outcome.Should().Be(AutonomyOutcome.RequiresHuman);
        baseline.EffectiveMinAutonomy.Should().Be(70);

        // Override 70 → 40: automates at dial 60 through the real evaluator.
        var overrides = new Dictionary<string, int>(StringComparer.Ordinal) { [key.ToWire()] = 40 };
        var resolver = new DictionaryShippedLevelResolver(overrides);
        var snapshot = GovernancePolicySnapshot.FromSuccessfulRead(
            new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal),
            new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal),
            new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal),
            new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal),
            overrides);

        var lowered = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(key, User), snapshot, rulesAt60, shippedLevels: resolver);
        lowered.Outcome.Should().Be(AutonomyOutcome.Automated);
        lowered.EffectiveMinAutonomy.Should().Be(40);
    }

    [Test]
    public void Ac3_DegradedBreakGlassFallback_ReadsEffectiveShippedLevel()
    {
        // When the policy snapshot is Unavailable and break-glass is engaged,
        // the fallback rung must read EffectiveShippedLevel (not raw DefaultMinAutonomy).
        var key = ActionKey.Parse("agent-action:code-review"); // ships at 40
        var descriptor = ActionCatalog.Get(key);
        var resolver = new DictionaryShippedLevelResolver(
            new Dictionary<string, int>(StringComparer.Ordinal) { [key.ToWire()] = 75 });
        var breakGlass = BreakGlassState.Engaged(
            DateTimeOffset.UtcNow.AddMinutes(10), "incident test");

        // ResolveEffectiveMinAutonomy directly reports the overridden shipped level with BreakGlass.
        var resolved = AutonomyGateEvaluator.ResolveEffectiveMinAutonomy(
            descriptor, GovernancePolicySnapshot.Unavailable, breakGlass, shippedLevels: resolver);
        resolved.EffectiveMinAutonomy.Should().Be(75);
        resolved.Source.Should().Be(ActionAssignmentSource.BreakGlass);

        // At dial 60 (between shipped 40 and override 75), the override keeps it
        // blocked as RequiresHuman even under break-glass (so Source is Unavailable,
        // not BreakGlass — the override did NOT let it through).
        var blocked = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(key, User),
            GovernancePolicySnapshot.Unavailable,
            RulesAtDial(60),
            breakGlass,
            shippedLevels: resolver);
        blocked.EffectiveMinAutonomy.Should().Be(75);
        blocked.Outcome.Should().Be(AutonomyOutcome.RequiresHuman);
        blocked.Source.Should().Be(ActionAssignmentSource.Unavailable);

        // At dial 80 (>= override 75), break-glass lets it through using the override level.
        var allowed = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(key, User),
            GovernancePolicySnapshot.Unavailable,
            RulesAtDial(80),
            breakGlass,
            shippedLevels: resolver);
        allowed.EffectiveMinAutonomy.Should().Be(75);
        allowed.Outcome.Should().Be(AutonomyOutcome.Automated);
        allowed.Source.Should().Be(ActionAssignmentSource.BreakGlass);
    }

    [Test]
    public void GuardRail_PlatformCeilingStillWinsOverLowerOverride()
    {
        // §6.4 — ceiling composes via max() over the effective shipped level.
        var key = ActionKey.Parse("effect:deploy.qa"); // ships at 75
        var overrides = new Dictionary<string, int>(StringComparer.Ordinal) { [key.ToWire()] = 55 };
        var platformCeiling = new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal)
        {
            [key.ToWire()] = new ActionAssignmentValue(90, null, null, null),
        };
        var snapshot = GovernancePolicySnapshot.FromSuccessfulRead(
            platformCeiling,
            new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal),
            new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal),
            new Dictionary<string, ActionAssignmentValue>(StringComparer.Ordinal),
            overrides);

        var decision = AutonomyGateEvaluator.Evaluate(
            new AutonomyQuery(key, User), snapshot, RulesAtDial(70),
            shippedLevels: new DictionaryShippedLevelResolver(overrides));

        decision.EffectiveMinAutonomy.Should().Be(90);
        decision.Source.Should().Be(ActionAssignmentSource.PlatformCeiling);
        decision.Outcome.Should().Be(AutonomyOutcome.RequiresHuman);
    }

    // ── AC4 — Validation guard rails ───────────────────────────────────────

    [Test]
    public void Ac4_DeleteFamilyAt95_OverriddenTo45_RejectedWithFloorRuleAndBothNumbers()
    {
        var failure = ActionLevelOverrideValidator.ValidateWrite(
            "effect", "git.branch.delete", 45,
            CatalogDefaultShippedLevelResolver.Instance, out _);

        failure.Should().NotBeNull();
        failure!.StatusCode.Should().Be(400);
        failure.Code.Should().Be(ActionLevelOverrideValidator.CodeBelowFloor);
        failure.Error.Should().Contain("50", "must name the 50-line floor");
        failure.Error.Should().Contain("95", "must name the shipped level");
        failure.Error.Should().Contain("45", "must name the requested level");
        failure.Error.Should().ContainEquivalentOf("floor");
    }

    [TestCase(0)]
    [TestCase(1)]
    [TestCase(42)]
    [TestCase(73)]
    [TestCase(102)]
    [TestCase(-5)]
    public void Ac4_NonDetentValue_RejectedWith400(int badLevel)
    {
        var failure = ActionLevelOverrideValidator.ValidateWrite(
            "agent-action", "code-review", badLevel,
            CatalogDefaultShippedLevelResolver.Instance, out _);

        failure.Should().NotBeNull();
        failure!.StatusCode.Should().Be(400);
        failure.Code.Should().Be(ActionLevelOverrideValidator.CodeNonDetent);
    }

    [TestCase("effect", "engine.events.append")]
    [TestCase("automation", "channel-outbox-sweeper")]
    [TestCase("platform-task", "tenant.move")]
    public void Ac4_MachineryKey_RejectedWith400NamingClassification(string ns, string key)
    {
        var failure = ActionLevelOverrideValidator.ValidateWrite(
            ns, key, 50,
            CatalogDefaultShippedLevelResolver.Instance, out _);

        failure.Should().NotBeNull();
        failure!.StatusCode.Should().Be(400);
        failure.Code.Should().Be(ActionLevelOverrideValidator.CodeMachinery);
        failure.Error.Should().ContainEquivalentOf("machinery");
    }

    [Test]
    public void Ac4_UnknownKey_RejectedWith404()
    {
        var failure = ActionLevelOverrideValidator.ValidateWrite(
            "effect", "does.not.exist", 50,
            CatalogDefaultShippedLevelResolver.Instance, out _);

        failure.Should().NotBeNull();
        failure!.StatusCode.Should().Be(404);
        failure.Code.Should().Be(ActionLevelOverrideValidator.CodeUnknownAction);
    }

    [Test]
    public void Ac4_MissingLevel_RejectedWith400()
    {
        var failure = ActionLevelOverrideValidator.ValidateWrite(
            "agent-action", "code-review", null,
            CatalogDefaultShippedLevelResolver.Instance, out _);

        failure.Should().NotBeNull();
        failure!.StatusCode.Should().Be(400);
        failure.Code.Should().Be(ActionLevelOverrideValidator.CodeMissingField);
    }

    [Test]
    public void Ac4_AlwaysHuman101_AndLegalDetents_Accepted()
    {
        ActionLevelOverrideValidator.ValidateWrite(
            "agent-action", "code-review", AutonomyDial.AlwaysHuman,
            CatalogDefaultShippedLevelResolver.Instance, out var desc).Should().BeNull();
        desc.Should().NotBeNull();

        // Shipped below 50 may move freely across [5, 100] step 5:
        ActionLevelOverrideValidator.ValidateWrite(
            "agent-action", "code-review", 15,
            CatalogDefaultShippedLevelResolver.Instance, out _).Should().BeNull();
        ActionLevelOverrideValidator.ValidateWrite(
            "agent-action", "code-review", 85,
            CatalogDefaultShippedLevelResolver.Instance, out _).Should().BeNull();

        // Shipped >= 50 may move to 50 or above, including 101:
        ActionLevelOverrideValidator.ValidateWrite(
            "effect", "git.branch.delete", 50,
            CatalogDefaultShippedLevelResolver.Instance, out _).Should().BeNull();
        ActionLevelOverrideValidator.ValidateWrite(
            "effect", "git.branch.delete", AutonomyDial.AlwaysHuman,
            CatalogDefaultShippedLevelResolver.Instance, out _).Should().BeNull();
    }

    // ── AC6(c) — AcceptanceFloors reads effective shipped level ────────────

    [Test]
    public void Ac6c_AcceptanceFloors_FollowsEffectiveLevel_InBothDirections()
    {
        // document-type:design ships at 45 (automates at dial 70 → Any).
        AcceptanceFloors.ShippedFloorFor(DocumentTypeKey.Design, dial: 70)
            .Should().Be(AcceptorRequirement.Any);

        // Override design 45 → 85: at dial 70, derived acceptor flips to Human.
        var raised = new DictionaryShippedLevelResolver(
            new Dictionary<string, int>(StringComparer.Ordinal) { ["document-type:design"] = 85 });
        AcceptanceFloors.ShippedFloorFor(DocumentTypeKey.Design, dial: 70, shippedLevels: raised)
            .Should().Be(AcceptorRequirement.Human);

        // document-type:sprint-plan ships at 95 (requires Human at dial 70).
        AcceptanceFloors.ShippedFloorFor(DocumentTypeKey.SprintPlan, dial: 70)
            .Should().Be(AcceptorRequirement.Human);

        // Override sprint-plan 95 → 55: at dial 70, derived acceptor flips to Any.
        var lowered = new DictionaryShippedLevelResolver(
            new Dictionary<string, int>(StringComparer.Ordinal) { ["document-type:sprint-plan"] = 55 });
        AcceptanceFloors.ShippedFloorFor(DocumentTypeKey.SprintPlan, dial: 70, shippedLevels: lowered)
            .Should().Be(AcceptorRequirement.Any);
    }

    // ── AC8 — Stranded overrides detection ─────────────────────────────────

    [Test]
    public void Ac8_FindStrandedOverrides_FlagsUnknownAndMachineryKeysWithRemediation()
    {
        var violations = ActionLevelOverrideValidator.FindStrandedOverrides(new[]
        {
            "agent-action:code-review",           // valid dial row
            "effect:git.pull-request.merge",      // retired key
            "effect:engine.events.append",        // machinery
        });

        violations.Should().HaveCount(2);
        violations.Should().Contain(v =>
            v.ActionKey == "effect:git.pull-request.merge"
            && v.Code == ActionLevelOverrideValidator.CodeStrandedOverride
            && v.Detail.Contains("Remediation", StringComparison.OrdinalIgnoreCase));
        violations.Should().Contain(v =>
            v.ActionKey == "effect:engine.events.append"
            && v.Code == ActionLevelOverrideValidator.CodeStrandedOverride
            && v.Detail.Contains("machinery", StringComparison.OrdinalIgnoreCase));
    }

    // ── AC9 — Single-source architecture guard ─────────────────────────────

    [Test]
    public void Ac9_NoProductionFileReadsDefaultMinAutonomy_OutsideResolverAndCatalogConstruction()
    {
        var root = FindTammaElsaRoot();
        var srcDir = Path.Combine(root, "src");
        Directory.Exists(srcDir).Should().BeTrue();

        // The ONLY production files permitted to reference `.DefaultMinAutonomy`
        // in executable code: descriptor declaration, catalog construction/validation,
        // and the single resolver implementation.
        var allowedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "ActionDescriptor.cs",
            "ActionCatalog.cs",
            "ActionCatalog.Descriptors.cs",
            "ShippedLevelResolver.cs",
        };

        var offenders = new List<string>();
        var memberAccess = new Regex(@"\.DefaultMinAutonomy\b", RegexOptions.Compiled);

        foreach (var file in Directory.EnumerateFiles(srcDir, "*.cs", SearchOption.AllDirectories))
        {
            // Skip build outputs if present under src/
            if (file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)
                || file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var fileName = Path.GetFileName(file);
            if (allowedFiles.Contains(fileName))
            {
                continue;
            }

            var lines = File.ReadAllLines(file);
            var inBlockComment = false;
            for (var i = 0; i < lines.Length; i++)
            {
                var line = StripComments(lines[i], ref inBlockComment);
                if (memberAccess.IsMatch(line))
                {
                    var rel = Path.GetRelativePath(root, file);
                    offenders.Add($"{rel}:{i + 1}: {lines[i].Trim()}");
                }
            }
        }

        offenders.Should().BeEmpty(
            "Story 43-18 AC9: every production reader of shipped action levels must go through "
            + "IShippedLevelResolver instead of reading ActionDescriptor.DefaultMinAutonomy directly.");
    }

    private static string StripComments(string line, ref bool inBlockComment)
    {
        var result = new System.Text.StringBuilder(line.Length);
        var i = 0;
        var inString = false;
        while (i < line.Length)
        {
            if (inBlockComment)
            {
                if (i + 1 < line.Length && line[i] == '*' && line[i + 1] == '/')
                {
                    inBlockComment = false;
                    i += 2;
                }
                else
                {
                    i++;
                }
                continue;
            }

            if (!inString && i + 1 < line.Length && line[i] == '/' && line[i + 1] == '/')
            {
                break; // rest of line is // or /// comment
            }

            if (!inString && i + 1 < line.Length && line[i] == '/' && line[i + 1] == '*')
            {
                inBlockComment = true;
                i += 2;
                continue;
            }

            if (line[i] == '"' && (i == 0 || line[i - 1] != '\\'))
            {
                inString = !inString;
            }

            result.Append(line[i]);
            i++;
        }
        return result.ToString();
    }

    private static string FindTammaElsaRoot()
    {
        var dir = TestContext.CurrentContext.TestDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Tamma.sln")))
        {
            dir = Path.GetDirectoryName(dir);
        }
        dir.Should().NotBeNull("must locate apps/tamma-elsa root containing Tamma.sln");
        return dir!;
    }
}
