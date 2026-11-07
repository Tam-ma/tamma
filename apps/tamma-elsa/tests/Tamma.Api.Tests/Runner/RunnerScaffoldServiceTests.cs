using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Git;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Services.Runner;
using Tamma.Api.Tests.AgentDispatch;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;
using Tamma.Platforms.Abstractions;
using Tamma.Platforms.Abstractions.Models;
using CreateBranchRequest = Tamma.Platforms.Abstractions.Models.CreateBranchRequest;

namespace Tamma.Api.Tests.Runner;

/// <summary>
/// Story 40-1 AC7 — <see cref="RunnerScaffoldService"/> over a Moq'd platform
/// client + authorizer: the D5 state matrix (mirroring install-runner.sh), the
/// no-clobber rule, the opt-in upgrade/force paths, idempotency, the per-mode
/// no-op, and exactly one RUNNER.SCAFFOLD.* event per install.
/// </summary>
[TestFixture]
public class RunnerScaffoldServiceTests
{
    private const string Repo = "acme/widgets";
    private const string Version = "1.0.0";
    private const string Wf = ".github/workflows/runner.yml";
    private const string ScriptA = ".github/tamma/scripts/a.sh";
    private const string ScriptB = ".github/tamma/scripts/b.sh";
    private readonly Guid _tenant = Guid.NewGuid();

    private Mock<IGitRepoAuthorizer> _authorizer = null!;
    private Mock<IPlatformResolver> _resolver = null!;
    private Mock<IGitPlatformClient> _client = null!;
    private Mock<IEventRepository> _events = null!;
    private Mock<ITammaModeProvider> _mode = null!;
    private List<DomainEvent> _appended = null!;
    private FakeTemplate _template = null!;
    private Dictionary<(string Path, string Ref), byte[]> _repoFiles = null!;
    private FakePlatformDriver _driver = null!;
    private RunnerScaffoldService _sut = null!;

    private static byte[] Bytes(string s) => Encoding.UTF8.GetBytes(s);
    private static string Marked(string version, string body) => $"#!/usr/bin/env bash\n# tamma-runner-version: {version}\n{body}\n";

    private sealed class FakeTemplate : IRunnerTemplate
    {
        public string Version { get; init; } = RunnerScaffoldServiceTests.Version;
        public IReadOnlyList<RunnerTemplateFile> Files { get; init; } = [];
    }

    [SetUp]
    public void SetUp()
    {
        _template = new FakeTemplate
        {
            Files =
            [
                new RunnerTemplateFile(Wf, Bytes(Marked(Version, "name: tamma")), Executable: false),
                new RunnerTemplateFile(ScriptA, Bytes(Marked(Version, "echo a")), Executable: true),
                new RunnerTemplateFile(ScriptB, Bytes(Marked(Version, "echo b")), Executable: true),
            ],
        };

        _authorizer = new Mock<IGitRepoAuthorizer>(MockBehavior.Strict);
        _authorizer.Setup(a => a.AuthorizeAsync(It.IsAny<Guid?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(GitRepoAuthorization.Allow());

        _client = new Mock<IGitPlatformClient>(MockBehavior.Loose);
        _client.Setup(c => c.GetRepoAsync("acme", "widgets", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<Repo>.FromOk(new Repo("github.com", "acme", "widgets", "main", true, null, "", "")));

        _repoFiles = new Dictionary<(string, string), byte[]>();
        _client.Setup(c => c.GetFileContentAsync(It.IsAny<GetFileContentRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((GetFileContentRequest r, CancellationToken _) =>
                _repoFiles.TryGetValue((r.Path, r.Ref), out var b)
                    ? PlatformResult<byte[]>.FromOk(b)
                    : PlatformResult<byte[]>.FromError(new PlatformError.NotFound()));

        // Write path defaults: install branch absent, default branch tip readable,
        // branch create / commit / PR open all succeed, no open PR yet.
        _client.Setup(c => c.GetBranchAsync("acme", "widgets", "tamma/runner-1.0.0", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<Branch>.FromError(new PlatformError.NotFound()));
        _client.Setup(c => c.GetBranchAsync("acme", "widgets", "main", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<Branch>.FromOk(new Branch("main", "tipsha", true)));
        _client.Setup(c => c.CreateBranchAsync(It.IsAny<CreateBranchRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<Branch>.FromOk(new Branch("tamma/runner-1.0.0", "tipsha", false)));
        _client.Setup(c => c.CommitFilesAsync(It.IsAny<CommitFilesRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<FileCommit>.FromOk(new FileCommit("newsha", null)));
        _client.Setup(c => c.ListOpenPullRequestsForBranchAsync("acme", "widgets", "tamma/runner-1.0.0", "main", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<IReadOnlyList<PullRequest>>.FromOk([]));
        _client.Setup(c => c.OpenPullRequestAsync(It.IsAny<OpenPullRequestRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<PullRequest>.FromOk(Pr("12")));

        _driver = new FakePlatformDriver(_client.Object)
        {
            Capabilities = new HashSet<PlatformCapability> { PlatformCapability.Actions, PlatformCapability.FileWrites },
        };
        _resolver = new Mock<IPlatformResolver>(MockBehavior.Loose);
        UseDriver(_driver);

        _appended = [];
        _events = new Mock<IEventRepository>(MockBehavior.Loose);
        _events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(_appended.Add)
            .ReturnsAsync((DomainEvent e) => e);

        _mode = new Mock<ITammaModeProvider>();
        _mode.SetupGet(m => m.Mode).Returns(TammaMode.SaaS);

        Build();
    }

    private void Build() => _sut = new RunnerScaffoldService(
        _authorizer.Object, _resolver.Object, Mock.Of<IInstallationRepository>(), _events.Object,
        _template, _mode.Object, NullLogger<RunnerScaffoldService>.Instance);

    private void UseDriver(IGitPlatformDriver? driver) => _resolver
        .Setup(r => r.ResolveForMediationAsync(It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
        .ReturnsAsync(driver is null ? null : new MediationDriverResolution(driver, MediationCredentialSource.TenantInstallation));

    private static PullRequest Pr(string number) => new(
        number, "Tamma agent runner 1.0.0", null, "tamma/runner-1.0.0", "main", PullRequestState.Open, false,
        $"https://github.com/acme/widgets/pull/{number}", "tamma[bot]", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);

    /// <summary>Put every shipped file on the default branch, byte-identical.</summary>
    private void InstallCurrentSet(string @ref = "main")
    {
        foreach (var f in _template.Files) _repoFiles[(f.RepoPath, @ref)] = f.Content;
    }

    private void VerifyNoWrites()
    {
        _client.Verify(c => c.CreateBranchAsync(It.IsAny<CreateBranchRequest>(), It.IsAny<CancellationToken>()), Times.Never);
        _client.Verify(c => c.CommitFilesAsync(It.IsAny<CommitFilesRequest>(), It.IsAny<CancellationToken>()), Times.Never);
        _client.Verify(c => c.OpenPullRequestAsync(It.IsAny<OpenPullRequestRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private DomainEvent SingleEvent(string type)
    {
        _appended.Should().ContainSingle("exactly one terminal RUNNER.SCAFFOLD.* event per install call");
        var evt = _appended.Single();
        evt.Type.Should().Be(type);
        evt.TenantId.Should().Be(_tenant);
        return evt;
    }

    private static JsonElement Tags(DomainEvent e) => JsonDocument.Parse(e.Tags!).RootElement;

    // ===================================================================
    // Status — the D5 state matrix (mirrors install-runner.sh)
    // ===================================================================

    [Test]
    public async Task Status_NothingInstalled_IsAbsent()
    {
        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.Success.Should().BeTrue();
        status.Mode.Should().Be(RunnerScaffoldModes.SaaS);
        status.State.Should().Be("absent");
        status.DefaultBranch.Should().Be("main");
        status.ShippedVersion.Should().Be(Version);
        status.Files.Should().OnlyContain(f => f.State == "absent" && f.InstalledVersion == null);
        _appended.Should().BeEmpty("a status read changes nothing and emits nothing");
        VerifyNoWrites();
    }

    [Test]
    public async Task Status_ByteIdenticalSet_IsCurrent()
    {
        InstallCurrentSet();

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.State.Should().Be("current");
        status.Files.Should().OnlyContain(f => f.State == "current" && f.InstalledVersion == Version);
    }

    [Test]
    public async Task Status_DifferentVersionMarker_IsDrifted()
    {
        InstallCurrentSet();
        _repoFiles[(Wf, "main")] = Bytes(Marked("0.9.0", "name: tamma (old)"));

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.State.Should().Be("drifted");
        status.Files.Single(f => f.Path == Wf).Should().Be(new RunnerFileStatus(Wf, "drifted", "0.9.0"));
    }

    [Test]
    public async Task Status_MarkerRemoved_IsDrifted_LikeTheScript()
    {
        // install-runner.sh: `version_of` prints '' for an unmarked file, which
        // differs from the shipped version ⇒ drifted (not customized).
        InstallCurrentSet();
        _repoFiles[(ScriptA, "main")] = Bytes("#!/usr/bin/env bash\necho a\n");

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.State.Should().Be("drifted");
        status.Files.Single(f => f.Path == ScriptA).InstalledVersion.Should().BeNull();
    }

    [Test]
    public async Task Status_SameMarkerDifferentBytes_IsCustomized()
    {
        InstallCurrentSet();
        _repoFiles[(ScriptA, "main")] = Bytes(Marked(Version, "echo a --my-flag"));

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.State.Should().Be("customized");
    }

    [Test]
    public async Task Status_WorstStateWins_CustomizedOverDriftedOverAbsent()
    {
        // workflow drifted, script A customized, script B absent ⇒ customized.
        _repoFiles[(Wf, "main")] = Bytes(Marked("0.9.0", "old"));
        _repoFiles[(ScriptA, "main")] = Bytes(Marked(Version, "edited"));

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.State.Should().Be("customized");
        status.Files.Select(f => f.State).Should().Equal("drifted", "customized", "absent");
    }

    [Test]
    public async Task Status_WorkflowCurrent_ScriptsMissing_IsAbsent_NotCurrent()
    {
        // The installer bug fixed 2026-08-18: reading only the workflow said
        // "current" while the run hard-failed on missing scripts.
        _repoFiles[(Wf, "main")] = _template.Files[0].Content;

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.State.Should().Be("absent");
    }

    [Test]
    public async Task Status_ReadsFromTheDefaultBranch()
    {
        InstallCurrentSet("some-feature-branch");

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.State.Should().Be("absent", "only the default branch's copy is what workflow_dispatch runs");
    }

    [Test]
    public async Task Status_FileReadError_IsPlatformError_NotAbsent()
    {
        _client.Setup(c => c.GetFileContentAsync(It.IsAny<GetFileContentRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<byte[]>.FromError(new PlatformError.Unknown("boom")));

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.Success.Should().BeFalse();
        status.FailureCode.Should().Be(RunnerScaffoldFailureCodes.PlatformError,
            "an unreadable file must not be reported as absent (that would invite a clobbering install)");
    }

    // ===================================================================
    // Status — guard, parse, driver, mode
    // ===================================================================

    [Test]
    public async Task Status_GuardDenied_IsRepoNotAuthorized_DriverNeverResolved()
    {
        _authorizer.Setup(a => a.AuthorizeAsync(_tenant, Repo, It.IsAny<CancellationToken>()))
            .ReturnsAsync(GitRepoAuthorization.Deny("not your repo"));

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.Success.Should().BeFalse();
        status.FailureCode.Should().Be(RunnerScaffoldFailureCodes.RepoNotAuthorized);
        _resolver.Verify(r => r.ResolveForMediationAsync(It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
        _client.Verify(c => c.GetFileContentAsync(It.IsAny<GetFileContentRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task Status_MalformedRepo_IsInvalidRepo()
    {
        var status = await _sut.GetStatusAsync(_tenant, "no-slash");

        status.FailureCode.Should().Be(RunnerScaffoldFailureCodes.InvalidRepo);
    }

    [Test]
    public async Task Status_NoDriver_IsPlatformNotConfigured()
    {
        UseDriver(null);

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.FailureCode.Should().Be(RunnerScaffoldFailureCodes.PlatformNotConfigured);
    }

    [Test]
    public async Task Status_GitLab_IsUnsupported()
    {
        UseDriver(new FakePlatformDriver(_client.Object)
        {
            Kind = PlatformKind.GitLab,
            Capabilities = new HashSet<PlatformCapability> { PlatformCapability.FileWrites },
        });

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.FailureCode.Should().Be(RunnerScaffoldFailureCodes.PlatformUnsupported);
    }

    [Test]
    public async Task Status_SingleUser_IsNotApplicable_NoPlatformCall()
    {
        _mode.SetupGet(m => m.Mode).Returns(TammaMode.SingleUser);

        var status = await _sut.GetStatusAsync(_tenant, Repo);

        status.Success.Should().BeTrue();
        status.Mode.Should().Be(RunnerScaffoldModes.SingleUser);
        status.State.Should().BeNull();
        status.Message.Should().Contain("locally");
        _authorizer.Verify(a => a.AuthorizeAsync(It.IsAny<Guid?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ===================================================================
    // Install — absent → branch + one commit (exec bits) + PR
    // ===================================================================

    [Test]
    public async Task Install_Absent_CreatesBranch_CommitsTheSetOnce_OpensPr_EmitsInstalled()
    {
        CommitFilesRequest? committed = null;
        _client.Setup(c => c.CommitFilesAsync(It.IsAny<CommitFilesRequest>(), It.IsAny<CancellationToken>()))
            .Callback<CommitFilesRequest, CancellationToken>((r, _) => committed = r)
            .ReturnsAsync(PlatformResult<FileCommit>.FromOk(new FileCommit("newsha", null)));
        OpenPullRequestRequest? opened = null;
        _client.Setup(c => c.OpenPullRequestAsync(It.IsAny<OpenPullRequestRequest>(), It.IsAny<CancellationToken>()))
            .Callback<OpenPullRequestRequest, CancellationToken>((r, _) => opened = r)
            .ReturnsAsync(PlatformResult<PullRequest>.FromOk(Pr("12")));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest());

        result.Success.Should().BeTrue();
        result.Outcome.Should().Be(RunnerInstallOutcomes.Installed);
        result.PriorState.Should().Be("absent");
        result.Branch.Should().Be("tamma/runner-1.0.0");
        result.CommitSha.Should().Be("newsha");
        result.PullRequestNumber.Should().Be("12");
        result.PullRequestUrl.Should().Be("https://github.com/acme/widgets/pull/12");

        _client.Verify(c => c.CreateBranchAsync(
            new CreateBranchRequest("acme", "widgets", "tamma/runner-1.0.0", "tipsha"), It.IsAny<CancellationToken>()), Times.Once);
        _client.Verify(c => c.CommitFilesAsync(It.IsAny<CommitFilesRequest>(), It.IsAny<CancellationToken>()), Times.Once,
            "the set lands as ONE commit — a half-installed set fails the workflow's version check");
        committed!.Branch.Should().Be("tamma/runner-1.0.0", "never a direct push to the default branch");
        committed.Files.Select(f => (f.Path, f.Executable)).Should().Equal((Wf, false), (ScriptA, true), (ScriptB, true));
        committed.Files.Select(f => f.Content).Should().Equal(_template.Files.Select(f => f.Content), "the shipped bytes, verbatim");
        opened!.SourceBranch.Should().Be("tamma/runner-1.0.0");
        opened.TargetBranch.Should().Be("main");

        var evt = SingleEvent(RunnerScaffoldEventTypes.Installed);
        Tags(evt).GetProperty("repo").GetString().Should().Be(Repo);
        Tags(evt).GetProperty("runnerVersion").GetString().Should().Be(Version);
        Tags(evt).GetProperty("tenantId").GetString().Should().Be(_tenant.ToString());
        evt.Data.Should().Contain("\"pullRequestNumber\":\"12\"");
    }

    [Test]
    public async Task Install_Current_WritesNothing_EmitsSkipped()
    {
        InstallCurrentSet();

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest(Upgrade: true, Force: true));

        result.Success.Should().BeTrue();
        result.Outcome.Should().Be(RunnerInstallOutcomes.AlreadyCurrent);
        VerifyNoWrites();
        Tags(SingleEvent(RunnerScaffoldEventTypes.Skipped)).GetProperty("reason").GetString().Should().Be("already_current");
    }

    // ===================================================================
    // Install — never silently clobber (D5)
    // ===================================================================

    [Test]
    public async Task Install_Drifted_WithoutUpgrade_IsRefused_NeedsUpgrade_NoWrite()
    {
        InstallCurrentSet();
        _repoFiles[(Wf, "main")] = Bytes(Marked("0.9.0", "old"));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest());

        result.Success.Should().BeFalse();
        result.Outcome.Should().Be(RunnerInstallOutcomes.Refused);
        result.FailureCode.Should().Be(RunnerScaffoldFailureCodes.NeedsUpgrade);
        result.FailureReason.Should().Contain(Wf).And.Contain("upgrade");
        VerifyNoWrites();
        Tags(SingleEvent(RunnerScaffoldEventTypes.Skipped)).GetProperty("reason").GetString().Should().Be("needs_upgrade");
    }

    [Test]
    public async Task Install_Customized_WithUpgradeOnly_IsRefused_NeedsForce_NoWrite()
    {
        InstallCurrentSet();
        _repoFiles[(ScriptA, "main")] = Bytes(Marked(Version, "my edits"));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest(Upgrade: true));

        result.FailureCode.Should().Be(RunnerScaffoldFailureCodes.NeedsForce,
            "a customized copy needs force — upgrade alone must not overwrite local edits");
        result.FailureReason.Should().Contain(ScriptA);
        VerifyNoWrites();
        Tags(SingleEvent(RunnerScaffoldEventTypes.Skipped)).GetProperty("reason").GetString().Should().Be("needs_force");
    }

    [Test]
    public async Task Install_Drifted_WithUpgrade_OpensUpgradePr_EmitsUpgraded()
    {
        InstallCurrentSet();
        _repoFiles[(Wf, "main")] = Bytes(Marked("0.9.0", "old"));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest(Upgrade: true));

        result.Success.Should().BeTrue();
        result.Outcome.Should().Be(RunnerInstallOutcomes.Upgraded);
        result.PriorState.Should().Be("drifted");
        _client.Verify(c => c.CommitFilesAsync(It.IsAny<CommitFilesRequest>(), It.IsAny<CancellationToken>()), Times.Once);
        Tags(SingleEvent(RunnerScaffoldEventTypes.Upgraded)).GetProperty("priorState").GetString().Should().Be("drifted");
    }

    [Test]
    public async Task Install_Customized_WithForce_OpensReplacementPr_WarningInBody_EmitsUpgraded()
    {
        InstallCurrentSet();
        _repoFiles[(ScriptA, "main")] = Bytes(Marked(Version, "my edits"));
        OpenPullRequestRequest? opened = null;
        _client.Setup(c => c.OpenPullRequestAsync(It.IsAny<OpenPullRequestRequest>(), It.IsAny<CancellationToken>()))
            .Callback<OpenPullRequestRequest, CancellationToken>((r, _) => opened = r)
            .ReturnsAsync(PlatformResult<PullRequest>.FromOk(Pr("13")));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest(Force: true));

        result.Outcome.Should().Be(RunnerInstallOutcomes.Upgraded);
        opened!.Body.Should().Contain("REPLACES").And.Contain(ScriptA, "the reviewer must see what is overwritten");
        Tags(SingleEvent(RunnerScaffoldEventTypes.Upgraded)).GetProperty("priorState").GetString().Should().Be("customized");
    }

    // ===================================================================
    // Install — idempotency
    // ===================================================================

    [Test]
    public async Task Install_Repeat_BranchAlreadyCarriesSet_AndPrOpen_NoNewCommit_NoNewPr()
    {
        _client.Setup(c => c.GetBranchAsync("acme", "widgets", "tamma/runner-1.0.0", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<Branch>.FromOk(new Branch("tamma/runner-1.0.0", "s", false)));
        InstallCurrentSet("tamma/runner-1.0.0");
        _client.Setup(c => c.ListOpenPullRequestsForBranchAsync("acme", "widgets", "tamma/runner-1.0.0", "main", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<IReadOnlyList<PullRequest>>.FromOk([Pr("12")]));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest());

        result.Success.Should().BeTrue();
        result.PullRequestNumber.Should().Be("12");
        result.CommitSha.Should().BeNull("the branch already carried the shipped bytes");
        VerifyNoWrites();
        SingleEvent(RunnerScaffoldEventTypes.Installed).Data.Should().Contain("\"reusedCommit\":true");
    }

    [Test]
    public async Task Install_BranchExistsWithStaleFiles_AndPrOpen_CommitsOntoIt_WithoutRecreating()
    {
        _client.Setup(c => c.GetBranchAsync("acme", "widgets", "tamma/runner-1.0.0", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<Branch>.FromOk(new Branch("tamma/runner-1.0.0", "s", false)));
        _client.Setup(c => c.ListOpenPullRequestsForBranchAsync("acme", "widgets", "tamma/runner-1.0.0", "main", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<IReadOnlyList<PullRequest>>.FromOk([Pr("12")]));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest());

        result.CommitSha.Should().Be("newsha");
        result.PullRequestNumber.Should().Be("12");
        _client.Verify(c => c.CreateBranchAsync(It.IsAny<CreateBranchRequest>(), It.IsAny<CancellationToken>()), Times.Never);
        _client.Verify(c => c.DeleteBranchAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        _client.Verify(c => c.OpenPullRequestAsync(It.IsAny<OpenPullRequestRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>
    /// Audit fix (PR #519): install → PR merged → branch kept → files edited on
    /// default → force re-install. The kept branch already carries the shipped
    /// bytes but has no commits ahead of default, so reusing it would skip the
    /// commit and open a PR with nothing in it (GitHub 422). With no open PR the
    /// branch is stale: it is reset to the default tip and the set recommitted.
    /// </summary>
    [Test]
    public async Task Install_BranchExists_PrAlreadyMerged_NoOpenPr_ResetsBranchToDefaultTip_RecommitsAndOpensPr()
    {
        // Default branch: workflow edited locally (same marker, different bytes) → Customized.
        InstallCurrentSet();
        _repoFiles[(Wf, "main")] = Bytes(Marked(Version, "name: edited"));
        // The kept install branch still carries the shipped set from the merged PR.
        _client.Setup(c => c.GetBranchAsync("acme", "widgets", "tamma/runner-1.0.0", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<Branch>.FromOk(new Branch("tamma/runner-1.0.0", "oldsha", false)));
        InstallCurrentSet("tamma/runner-1.0.0");
        _client.Setup(c => c.DeleteBranchAsync("acme", "widgets", "tamma/runner-1.0.0", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<bool>.FromOk(true));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest(Force: true));

        result.Success.Should().BeTrue();
        result.CommitSha.Should().Be("newsha", "the stale branch is recommitted, not reused");
        result.PullRequestNumber.Should().Be("12");
        _client.Verify(c => c.DeleteBranchAsync("acme", "widgets", "tamma/runner-1.0.0", It.IsAny<CancellationToken>()), Times.Once);
        _client.Verify(c => c.CreateBranchAsync(
            new CreateBranchRequest("acme", "widgets", "tamma/runner-1.0.0", "tipsha"), It.IsAny<CancellationToken>()), Times.Once);
        _client.Verify(c => c.CommitFilesAsync(It.IsAny<CommitFilesRequest>(), It.IsAny<CancellationToken>()), Times.Once);
        _client.Verify(c => c.OpenPullRequestAsync(It.IsAny<OpenPullRequestRequest>(), It.IsAny<CancellationToken>()), Times.Once);
        SingleEvent(RunnerScaffoldEventTypes.Upgraded).Data.Should().Contain("\"reusedCommit\":false");
    }

    [Test]
    public async Task Install_StaleBranch_DeleteFails_IsPlatformError_NoCommit_NoPr()
    {
        _client.Setup(c => c.GetBranchAsync("acme", "widgets", "tamma/runner-1.0.0", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<Branch>.FromOk(new Branch("tamma/runner-1.0.0", "oldsha", false)));
        _client.Setup(c => c.DeleteBranchAsync("acme", "widgets", "tamma/runner-1.0.0", It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<bool>.FromError(new PlatformError.ServiceUnavailable()));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest());

        result.Success.Should().BeFalse();
        result.FailureCode.Should().Be(RunnerScaffoldFailureCodes.PlatformError);
        VerifyNoWrites();
    }

    // ===================================================================
    // Install — failures (typed, one FAILED event, no partial PR)
    // ===================================================================

    [Test]
    public async Task Install_GuardDenied_NoDriver_NoWrite_EmitsFailed()
    {
        _authorizer.Setup(a => a.AuthorizeAsync(_tenant, Repo, It.IsAny<CancellationToken>()))
            .ReturnsAsync(GitRepoAuthorization.Deny("not your repo"));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest(Force: true));

        result.Success.Should().BeFalse();
        result.FailureCode.Should().Be(RunnerScaffoldFailureCodes.RepoNotAuthorized);
        _resolver.Verify(r => r.ResolveForMediationAsync(It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
        VerifyNoWrites();
        Tags(SingleEvent(RunnerScaffoldEventTypes.Failed)).GetProperty("failureCode").GetString()
            .Should().Be(RunnerScaffoldFailureCodes.RepoNotAuthorized);
    }

    [Test]
    public async Task Install_DriverWithoutFileWrites_IsUnsupported()
    {
        UseDriver(new FakePlatformDriver(_client.Object) { Kind = PlatformKind.Gitea });

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest());

        result.FailureCode.Should().Be(RunnerScaffoldFailureCodes.PlatformUnsupported);
        VerifyNoWrites();
        SingleEvent(RunnerScaffoldEventTypes.Failed);
    }

    [Test]
    public async Task Install_CommitFails_IsPlatformError_NoPrOpened_EmitsFailed()
    {
        _client.Setup(c => c.CommitFilesAsync(It.IsAny<CommitFilesRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(PlatformResult<FileCommit>.FromError(new PlatformError.PermissionDenied()));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest());

        result.Success.Should().BeFalse();
        result.FailureCode.Should().Be(RunnerScaffoldFailureCodes.PlatformError);
        result.FailureReason.Should().Contain("commit runner files");
        _client.Verify(c => c.OpenPullRequestAsync(It.IsAny<OpenPullRequestRequest>(), It.IsAny<CancellationToken>()), Times.Never);
        SingleEvent(RunnerScaffoldEventTypes.Failed);
    }

    [Test]
    public async Task Install_UnexpectedThrow_IsPlatformError_NeverEscapes()
    {
        _client.Setup(c => c.GetRepoAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("socket"));

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest());

        result.FailureCode.Should().Be(RunnerScaffoldFailureCodes.PlatformError);
        SingleEvent(RunnerScaffoldEventTypes.Failed);
    }

    [Test]
    public async Task Install_SingleUser_IsNoOp_EmitsSkipped()
    {
        _mode.SetupGet(m => m.Mode).Returns(TammaMode.SingleUser);

        var result = await _sut.InstallAsync(_tenant, Repo, new RunnerInstallRequest(Force: true));

        result.Success.Should().BeTrue();
        result.Outcome.Should().Be(RunnerInstallOutcomes.NotApplicable);
        result.Mode.Should().Be(RunnerScaffoldModes.SingleUser);
        VerifyNoWrites();
        _authorizer.Verify(a => a.AuthorizeAsync(It.IsAny<Guid?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        Tags(SingleEvent(RunnerScaffoldEventTypes.Skipped)).GetProperty("reason").GetString().Should().Be("single_user_mode");
    }
}
