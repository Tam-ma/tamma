using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.AgentDispatch;
using Tamma.Api.Services.GitHub;
using Tamma.Data;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.GitHub;

/// <summary>
/// Story 40-3 (AC2, AC6) — <c>workflow_run.completed</c> drives the durable
/// <see cref="IAgentRunResumer"/> with the payload's (installation, repo, head_branch) key,
/// with NO in-memory registry wired and NO ambient tenant (the webhook path is tenant-free).
/// </summary>
[TestFixture]
public class InstallationRouterWorkflowRunResumeTests
{
    private Mock<IAgentRunResumer> _resumer = null!;
    private AgentRunCompletion? _seen;

    private const string Payload = """
        {
          "action": "completed",
          "workflow_run": {
            "id": 77777777,
            "status": "completed",
            "conclusion": "success",
            "html_url": "https://github.com/acme/widgets/actions/runs/77777777",
            "artifacts_url": "https://api.github.com/repos/acme/widgets/actions/runs/77777777/artifacts",
            "head_branch": "tamma/issue-42",
            "created_at": "2026-04-18T10:00:00Z",
            "updated_at": "2026-04-18T10:05:00Z"
          },
          "repository": { "full_name": "acme/widgets" },
          "installation": { "id": 4242 }
        }
        """;

    [SetUp]
    public void SetUp()
    {
        _seen = null;
        _resumer = new Mock<IAgentRunResumer>();
        _resumer.Setup(r => r.ResumeFromWorkflowRunAsync(It.IsAny<AgentRunCompletion>(), It.IsAny<CancellationToken>()))
            .Callback<AgentRunCompletion, CancellationToken>((c, _) => _seen = c)
            .ReturnsAsync(AgentRunResumeOutcome.Resumed);
    }

    private InstallationRouterService Router() => new(
        Mock.Of<IInstallationRepository>(), Mock.Of<IEventRepository>(), Mock.Of<ITenantRepository>(),
        Mock.Of<IUserRepository>(), new MemoryCache(new MemoryCacheOptions()),
        Mock.Of<Tamma.Platforms.GitHub.IGitHubAppInstallationReader>(), Mock.Of<IInstallationSecretsPusher>(),
        Mock.Of<IApiKeyRepository>(), NullLogger<InstallationRouterService>.Instance,
        webhookSignals: null, installationBridge: null, agentRunResumer: _resumer.Object);

    [Test]
    public async Task Completed_run_resumes_durably_with_no_registry_and_no_ambient_tenant()
    {
        ITenantContext ambient = new TenantContext();
        ambient.TenantId.Should().BeNull("the webhook path binds no tenant");

        var result = await Router().HandleWebhookAsync("workflow_run", JsonDocument.Parse(Payload).RootElement);

        result.Skipped.Should().BeFalse("the durable path matched without the in-memory registry");
        _seen.Should().NotBeNull();
        _seen!.InstallationId.Should().Be(4242);
        _seen.Repository.Should().Be("acme/widgets");
        _seen.HeadBranch.Should().Be("tamma/issue-42");
        _seen.WorkflowRunId.Should().Be(77777777);
        _seen.Conclusion.Should().Be("success");
        _seen.ArtifactsUrl.Should().EndWith("/artifacts");
        (_seen.UpdatedAt - _seen.CreatedAt).Should().Be(TimeSpan.FromMinutes(5));
    }

    [TestCase(AgentRunResumeOutcome.NoMatch, true)]
    [TestCase(AgentRunResumeOutcome.Ambiguous, true)]
    [TestCase(AgentRunResumeOutcome.Refused, true)]
    [TestCase(AgentRunResumeOutcome.EngineError, true)]
    [TestCase(AgentRunResumeOutcome.Buffered, false)]
    [TestCase(AgentRunResumeOutcome.AlreadyResumed, false)]
    public async Task Skipped_reflects_the_durable_outcome(AgentRunResumeOutcome outcome, bool skipped)
    {
        _resumer.Setup(r => r.ResumeFromWorkflowRunAsync(It.IsAny<AgentRunCompletion>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(outcome);

        var result = await Router().HandleWebhookAsync("workflow_run", JsonDocument.Parse(Payload).RootElement);

        result.Skipped.Should().Be(skipped);
    }

    [Test]
    public async Task In_progress_run_never_reaches_the_resumer()
    {
        var payload = Payload.Replace("\"action\": \"completed\"", "\"action\": \"in_progress\"");

        var result = await Router().HandleWebhookAsync("workflow_run", JsonDocument.Parse(payload).RootElement);

        result.Skipped.Should().BeTrue();
        _resumer.VerifyNoOtherCalls();
    }
}
