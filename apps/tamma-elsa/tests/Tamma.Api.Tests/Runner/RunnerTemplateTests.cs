using System.Text;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Moq;
using NUnit.Framework;
using Tamma.Api.Endpoints;
using Tamma.Api.Services.Runner;
using Tamma.Data;

namespace Tamma.Api.Tests.Runner;

/// <summary>
/// Story 40-1 AC7 — the EMBEDDED runner set is the SHIPPED runner set (bytes the
/// scaffold commits = bytes in apps/tamma-elsa/runner/github-actions), the version
/// marker parses exactly like install-runner.sh, and the endpoint maps failure
/// codes to the right HTTP status.
/// </summary>
[TestFixture]
public class RunnerTemplateTests
{
    private static string RunnerDir()
    {
        var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Tamma.sln")))
            dir = dir.Parent;
        dir.Should().NotBeNull("the test must run from within the apps/tamma-elsa tree");
        return Path.Combine(dir!.FullName, "runner", "github-actions");
    }

    [Test]
    public void EmbeddedTemplate_IsByteIdenticalToTheShippedRunner_AtTheInstallerPaths()
    {
        var template = new EmbeddedRunnerTemplate();
        var dir = RunnerDir();

        // The same three install paths install-runner.sh writes.
        var expected = Directory.EnumerateFiles(dir, "*.yml")
            .Select(f => (Path: ".github/workflows/" + Path.GetFileName(f), Source: f, Exec: false))
            .Concat(Directory.EnumerateFiles(Path.Combine(dir, "scripts"), "*.sh").OrderBy(f => f, StringComparer.Ordinal)
                .Select(f => (Path: ".github/tamma/scripts/" + Path.GetFileName(f), Source: f, Exec: true)))
            .ToList();

        template.Files.Select(f => (f.RepoPath, f.Executable))
            .Should().BeEquivalentTo(expected.Select(e => (e.Path, e.Exec)));
        foreach (var e in expected)
            template.Files.Single(f => f.RepoPath == e.Path).Content
                .Should().Equal(File.ReadAllBytes(e.Source), $"{e.Path} must embed the shipped bytes verbatim");

        template.Files[0].RepoPath.Should().StartWith(".github/workflows/", "the workflow comes first");
    }

    [Test]
    public void EmbeddedTemplate_Version_IsTheWorkflowsMarker_AndEveryFileCarriesIt()
    {
        var template = new EmbeddedRunnerTemplate();

        template.Version.Should().MatchRegex(@"^\d+\.\d+\.\d+$");
        template.Files.Should().OnlyContain(f => RunnerVersionMarker.Parse(f.Content) == template.Version,
            "the workflow refuses to run against scripts with a different marker — the set moves together");
    }

    [Test]
    public void EmbeddedTemplate_FromAnAssemblyWithoutTheRunner_FailsLoud()
    {
        var act = () => new EmbeddedRunnerTemplate(typeof(FluentAssertions.AssertionExtensions).Assembly);

        act.Should().Throw<InvalidOperationException>().WithMessage("*40-1*");
    }

    [TestCase("# tamma-runner-version: 1.2.3\n", "1.2.3")]
    [TestCase("#!/bin/sh\n# tamma-runner-version: 2.0.0\n# tamma-runner-version: 9.9.9\n", "2.0.0")]
    [TestCase("# tamma-runner-version: 1.0.0\r\nrest", "1.0.0\r")]
    [TestCase("  # tamma-runner-version: 1.0.0\n", null)]
    [TestCase("no marker here\n", null)]
    public void VersionMarker_ParsesLikeTheInstallerSed(string content, string? expected)
    {
        RunnerVersionMarker.Parse(Encoding.UTF8.GetBytes(content)).Should().Be(expected);
    }

    // ===================================================================
    // Endpoints
    // ===================================================================

    private static int StatusOf(IResult result) =>
        result.GetType().GetProperty("StatusCode")?.GetValue(result) is int code ? code : 200;

    [TestCase(RunnerScaffoldFailureCodes.RepoNotAuthorized, 403)]
    [TestCase(RunnerScaffoldFailureCodes.InvalidRepo, 400)]
    [TestCase(RunnerScaffoldFailureCodes.NeedsUpgrade, 409)]
    [TestCase(RunnerScaffoldFailureCodes.NeedsForce, 409)]
    [TestCase(RunnerScaffoldFailureCodes.PlatformUnsupported, 422)]
    [TestCase(RunnerScaffoldFailureCodes.PlatformNotConfigured, 503)]
    [TestCase(RunnerScaffoldFailureCodes.PlatformError, 502)]
    public void StatusFor_MapsEachFailureCode(string code, int status)
    {
        RunnerScaffoldEndpoints.StatusFor(code).Should().Be(status);
    }

    [Test]
    public async Task Install_UsesTheTenantFromContext_NotTheBody_AndDefaultsAnEmptyBody()
    {
        var tenant = Guid.NewGuid();
        var ctx = new Mock<ITenantContext>();
        ctx.SetupGet(c => c.TenantId).Returns(tenant);
        var scaffold = new Mock<IRunnerScaffoldService>(MockBehavior.Strict);
        scaffold.Setup(s => s.InstallAsync(tenant, "acme/widgets", new RunnerInstallRequest(false, false), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RunnerInstallResult
            {
                Success = false, Outcome = RunnerInstallOutcomes.Refused, Mode = RunnerScaffoldModes.SaaS,
                Repo = "acme/widgets", ShippedVersion = "1.0.0", FailureCode = RunnerScaffoldFailureCodes.NeedsForce,
            });

        var result = await RunnerScaffoldEndpoints.Install("acme", "widgets", null, ctx.Object, scaffold.Object, CancellationToken.None);

        StatusOf(result).Should().Be(409);
        scaffold.VerifyAll();
    }

    [Test]
    public async Task GetStatus_Success_Is200()
    {
        var ctx = new Mock<ITenantContext>();
        var scaffold = new Mock<IRunnerScaffoldService>();
        scaffold.Setup(s => s.GetStatusAsync(It.IsAny<Guid?>(), "acme/widgets", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RunnerStatusResult
            {
                Success = true, Mode = RunnerScaffoldModes.SaaS, Repo = "acme/widgets", ShippedVersion = "1.0.0", State = "current",
            });

        var result = await RunnerScaffoldEndpoints.GetStatus("acme", "widgets", ctx.Object, scaffold.Object, CancellationToken.None);

        StatusOf(result).Should().Be(200);
    }
}
