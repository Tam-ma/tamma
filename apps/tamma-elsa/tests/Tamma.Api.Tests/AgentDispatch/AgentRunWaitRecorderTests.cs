using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.Documents;
using Tamma.Api.Services.Actions;
using Tamma.Api.Services.AgentDispatch;
using Tamma.Api.Services.PromptStore;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.AgentDispatch;

/// <summary>
/// Story 40-3 (AC1) — the pending <c>agent_run_waits</c> row is written API-side on a
/// successful mediated dispatch, on the plane the mode names, and only for a bookmark
/// name the API can recompute for the dispatching principal.
/// </summary>
[TestFixture]
public class AgentRunWaitRecorderTests
{
    private const string Repo = "acme/widgets";
    private const string Branch = "tamma/issue-7";
    private const string Session = "adl-7-task-0";
    private static readonly DateTime At = new(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);

    private Mock<IAgentRunWaitRepository> _waits = null!;
    private Mock<IInstallationRepository> _installations = null!;
    private Mock<ISoleUserProvider> _soleUser = null!;
    private Guid _tenantId;
    private Guid _userId;

    [SetUp]
    public void SetUp()
    {
        _waits = new Mock<IAgentRunWaitRepository>();
        _installations = new Mock<IInstallationRepository>();
        _soleUser = new Mock<ISoleUserProvider>();
        _tenantId = Guid.NewGuid();
        _userId = Guid.NewGuid();
        _soleUser.Setup(s => s.GetSoleUserIdAsync(It.IsAny<CancellationToken>())).ReturnsAsync(_userId);
        _installations.Setup(i => i.GetByRepoFullNameAsync(Repo))
            .ReturnsAsync(new GitHubInstallation { InstallationId = 4242, TenantId = _tenantId, AccountLogin = "acme", AccountType = "Organization" });
        _waits.Setup(w => w.UpsertPendingByTenantAsync(It.IsAny<Guid>(), It.IsAny<AgentRunWaitRegistration>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AgentRunWait());
        _waits.Setup(w => w.UpsertPendingByUserAsync(It.IsAny<Guid>(), It.IsAny<AgentRunWaitRegistration>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AgentRunWait());
    }

    private AgentRunWaitRecorder Sut(TammaMode mode) => new(
        _waits.Object, _installations.Object, new AgentRunResumerTests.StubMode(mode), _soleUser.Object,
        NullLogger<AgentRunWaitRecorder>.Instance);

    private static DispatchAgentRunRequest Body(string? bookmarkTenant, string? bookmarkName = null) => new()
    {
        Ref = Branch,
        CorrelationId = Session,
        WorkflowInstanceId = "wf-1",
        BookmarkTenantId = bookmarkTenant,
        BookmarkName = bookmarkName ?? LifecycleBookmarks.ForAgentRun(bookmarkTenant, Repo, Branch, Session),
    };

    [Test]
    public async Task SaaS_writes_a_tenant_row_with_the_installation_id()
    {
        var written = await Sut(TammaMode.SaaS).RecordAsync(_tenantId, Repo, Body(_tenantId.ToString()), At);

        written.Should().BeTrue();
        _waits.Verify(w => w.UpsertPendingByTenantAsync(_tenantId, It.Is<AgentRunWaitRegistration>(r =>
            r.Repository == Repo && r.BranchName == Branch && r.SessionId == Session
            && r.InstallationId == 4242 && r.WorkflowInstanceId == "wf-1"
            && r.BookmarkTenantId == _tenantId && r.DispatchedAt == At
            && r.BookmarkName == LifecycleBookmarks.ForAgentRun(_tenantId.ToString(), Repo, Branch, Session)),
            It.IsAny<CancellationToken>()), Times.Once);
        _waits.Verify(w => w.UpsertPendingByUserAsync(It.IsAny<Guid>(), It.IsAny<AgentRunWaitRegistration>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task Single_user_writes_a_user_row_with_a_null_tenant()
    {
        var written = await Sut(TammaMode.SingleUser).RecordAsync(null, Repo, Body(bookmarkTenant: null), At);

        written.Should().BeTrue("single-user mode must not need a tenant id");
        _waits.Verify(w => w.UpsertPendingByUserAsync(_userId, It.Is<AgentRunWaitRegistration>(r =>
            r.BookmarkTenantId == null && r.InstallationId == 4242), It.IsAny<CancellationToken>()), Times.Once);
        _waits.Verify(w => w.UpsertPendingByTenantAsync(It.IsAny<Guid>(), It.IsAny<AgentRunWaitRegistration>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Test]
    public async Task SaaS_refuses_a_bookmark_folded_with_another_tenant()
    {
        var other = Guid.NewGuid().ToString();

        var written = await Sut(TammaMode.SaaS).RecordAsync(_tenantId, Repo, Body(other), At);

        written.Should().BeFalse("tenant A's dispatch may not register a resume for tenant B's bookmark");
        _waits.VerifyNoOtherCalls();
    }

    [Test]
    public async Task A_name_the_API_cannot_recompute_is_refused()
    {
        var written = await Sut(TammaMode.SaaS).RecordAsync(_tenantId, Repo, Body(_tenantId.ToString(), bookmarkName: "agent-run-forged"), At);

        written.Should().BeFalse();
        _waits.VerifyNoOtherCalls();
    }

    [Test]
    public async Task SaaS_does_not_record_another_tenants_installation_id()
    {
        _installations.Setup(i => i.GetByRepoFullNameAsync(Repo))
            .ReturnsAsync(new GitHubInstallation { InstallationId = 9999, TenantId = Guid.NewGuid(), AccountLogin = "x", AccountType = "User" });

        await Sut(TammaMode.SaaS).RecordAsync(_tenantId, Repo, Body(_tenantId.ToString()), At);

        _waits.Verify(w => w.UpsertPendingByTenantAsync(_tenantId,
            It.Is<AgentRunWaitRegistration>(r => r.InstallationId == null), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Test]
    public async Task No_bookmark_name_means_no_row()
    {
        var body = Body(_tenantId.ToString()) with { BookmarkName = null };

        var written = await Sut(TammaMode.SaaS).RecordAsync(_tenantId, Repo, body, At);

        written.Should().BeFalse("a non-suspending caller (legacy ExecuteAgent path) never registers a wait");
        _waits.VerifyNoOtherCalls();
    }

    [Test]
    public async Task SaaS_without_a_tenant_is_refused()
    {
        var written = await Sut(TammaMode.SaaS).RecordAsync(null, Repo, Body(bookmarkTenant: null), At);

        written.Should().BeFalse();
        _waits.VerifyNoOtherCalls();
    }

    [Test]
    public async Task Store_failure_is_swallowed_so_the_dispatch_still_succeeds()
    {
        _waits.Setup(w => w.UpsertPendingByTenantAsync(It.IsAny<Guid>(), It.IsAny<AgentRunWaitRegistration>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("db down"));

        var written = await Sut(TammaMode.SaaS).RecordAsync(_tenantId, Repo, Body(_tenantId.ToString()), At);

        written.Should().BeFalse();
    }
}
