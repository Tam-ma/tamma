using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NUnit.Framework;
using Tamma.Activities.ADL;
using Tamma.Activities.Core;

namespace Tamma.Activities.Tests.ADL;

/// <summary>
/// Story 40-4 — the rules behind CYCLE.ENDED (the re-entry attempt boundary). The end-to-end
/// proof that a finished cycle writes it is in <c>SingleIssueCycleCrashReEntryTests</c>.
/// </summary>
[TestFixture]
[NonParallelizable]
public class CycleEndedNotificationHandlerTests
{
    private const string SavedTenant = "4e4e4e4e-4040-4040-4040-4e4e4e4e4e4e";

    // ── The tenant reaches the drain (real Elsa runner + real TammaApiClient) ──

    /// <summary>
    /// The workflow has NO TenantId variable — exactly what a finished cycle looks like to the
    /// drain's variable read — so the only source of the tenant is what the cycle saved on the
    /// instance. The fake API does not fill a tenant in; it records the X-Tenant-Id it received.
    /// </summary>
    [Test]
    public async Task The_end_row_is_sent_with_the_tenant_saved_on_the_instance()
    {
        var (api, logs) = await RunFinishedCycleAsync(SavedTenant);

        var ended = api.Received.Where(r => r.Types.Contains(CycleEvents.Ended)).ToList();
        ended.Should().ContainSingle("the finished cycle writes exactly one CYCLE.ENDED");
        ended[0].TenantHeader.Should().Be(SavedTenant,
            "the re-entry read is tenant-scoped; an end row without the tenant would leave the attempt open");
        logs.Entries.Should().NotContain(e => e.Level == LogLevel.Warning && e.Message.Contains("has no tenant"));
    }

    [Test]
    public async Task Without_a_saved_tenant_the_end_row_is_still_sent_and_a_warning_is_logged()
    {
        Func<Task> act = async () =>
        {
            var (api, logs) = await RunFinishedCycleAsync(tenant: null);

            var ended = api.Received.Where(r => r.Types.Contains(CycleEvents.Ended)).ToList();
            ended.Should().ContainSingle();
            ended[0].TenantHeader.Should().BeNull();
            logs.Entries.Should().Contain(e => e.Level == LogLevel.Warning && e.Message.Contains("has no tenant")
                                               && e.Message.Contains("acme/widgets#42"));
        };

        await act.Should().NotThrowAsync();
    }

    private static async Task<(RecordingApi Api, CapturingLoggerProvider Logs)> RunFinishedCycleAsync(string? tenant)
    {
        var api = new RecordingApi();
        var logs = new CapturingLoggerProvider();
        var services = new ServiceCollection();
        services.AddLogging(b => b.AddProvider(logs));
        services.AddElsa(elsa =>
        {
            elsa.AddActivity<RememberCycleActivity>();
            elsa.UseWorkflows(w => w.UseTammaEventPersistence());
        });
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Tamma:ApiUrl"] = "http://tamma.test" })
            .Build();
        services.AddSingleton(_ => new Tamma.Activities.LlmCall.TammaApiClient(
            new HttpClient(api), NullLogger<Tamma.Activities.LlmCall.TammaApiClient>.Instance, config));

        await using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        RememberCycleActivity.Tenant = tenant;
        await scope.ServiceProvider.GetRequiredService<IWorkflowRunner>().RunAsync<FinishedCycle>();
        return (api, logs);
    }

    /// <summary>A stand-in cycle: same definition id, saves its identity the way EmitCycleEventActivity does.</summary>
    private sealed class FinishedCycle : WorkflowBase
    {
        protected override void Build(IWorkflowBuilder builder)
        {
            builder.DefinitionId = CycleEndedNotificationHandler.CycleDefinitionId;
            builder.Root = new Sequence { Activities = { new RememberCycleActivity() } };
        }
    }

    [Elsa.Workflows.Attributes.Activity("Tamma.Tests", "Remember Cycle", "Test-only: saves the cycle identity")]
    public sealed class RememberCycleActivity : CodeActivity
    {
        public static string? Tenant;

        protected override void Execute(ActivityExecutionContext context)
            => CycleEndedNotificationHandler.RememberCycle(context.WorkflowExecutionContext.Properties, 42, "acme/widgets", Tenant);
    }

    /// <summary>Plays POST /api/engine/events: records the tenant header and event types it received.</summary>
    private sealed class RecordingApi : HttpMessageHandler
    {
        public ConcurrentQueue<(string? TenantHeader, List<string> Types)> Received { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/api/engine/events", StringComparison.Ordinal) && request.Content is not null)
            {
                var types = JsonDocument.Parse(await request.Content.ReadAsStringAsync(ct)).RootElement
                    .GetProperty("events").EnumerateArray().Select(e => e.GetProperty("eventType").GetString()!).ToList();
                var header = request.Headers.TryGetValues("X-Tenant-Id", out var v) ? v.Single() : null;
                Received.Enqueue((header, types));
            }
            return new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("{\"ok\":true}") };
        }
    }

    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        public ConcurrentQueue<(LogLevel Level, string Message)> Entries { get; } = new();
        public ILogger CreateLogger(string categoryName) => new Logger(this);
        public void Dispose() { }

        private sealed class Logger(CapturingLoggerProvider owner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
                => owner.Entries.Enqueue((logLevel, formatter(state, exception)));
        }
    }

    // ── Pure rules ──

    [Test]
    public void Only_a_normally_finished_cycle_is_an_end()
    {
        CycleEndedNotificationHandler.IsCleanEnd("single-issue-cycle", WorkflowStatus.Finished, WorkflowSubStatus.Finished)
            .Should().BeTrue();
        CycleEndedNotificationHandler.IsCleanEnd("single-issue-cycle", WorkflowStatus.Finished, WorkflowSubStatus.Cancelled)
            .Should().BeFalse("the orphan sweep cancels crash-stranded cycles; those are crashes");
        CycleEndedNotificationHandler.IsCleanEnd("single-issue-cycle", WorkflowStatus.Finished, WorkflowSubStatus.Faulted)
            .Should().BeFalse();
        CycleEndedNotificationHandler.IsCleanEnd("single-issue-cycle", WorkflowStatus.Running, WorkflowSubStatus.Suspended)
            .Should().BeFalse();
        CycleEndedNotificationHandler.IsCleanEnd("merge-approval", WorkflowStatus.Finished, WorkflowSubStatus.Finished)
            .Should().BeFalse("only the coding cycle has a task loop to re-enter");
    }

    [Test]
    public void The_cycle_identity_round_trips_through_the_instance_properties()
    {
        var props = new Dictionary<string, object>();
        CycleEndedNotificationHandler.RememberCycle(props, 42, "acme/widgets", "t-1");

        // As stored and reloaded by the workflow store: values come back as JSON strings.
        var reloaded = JsonSerializer.Deserialize<Dictionary<string, object>>(JsonSerializer.Serialize(props))!;

        foreach (var bag in new[] { props, reloaded })
        {
            CycleEndedNotificationHandler.TryReadCycle(bag, out var issue, out var repo, out var tenant).Should().BeTrue();
            issue.Should().Be(42);
            repo.Should().Be("acme/widgets");
            tenant.Should().Be("t-1");
        }
    }

    [Test]
    public void No_identity_means_no_end_row()
    {
        var props = new Dictionary<string, object>();
        CycleEndedNotificationHandler.RememberCycle(props, 0, "acme/widgets", null);
        CycleEndedNotificationHandler.TryReadCycle(props, out _, out _, out _).Should().BeFalse();
    }
}
