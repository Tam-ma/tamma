using Elsa.Workflows;
using Elsa.Workflows.Models;
using Elsa.Workflows.Runtime;
using Elsa.Workflows.Runtime.Messages;
using Elsa.Workflows.State;
using NUnit.Framework;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Tamma.Activities.Tests.Workflows;

/// <summary>
/// What the Elsa runtime host does at startup, for tests that build a bare
/// <see cref="ServiceProvider"/>: populate the registries (so
/// <c>WorkflowDefinitionHandle.ByDefinitionId</c> resolves coded workflows — without
/// it every run throws <c>WorkflowGraphNotFoundException</c>) and start the hosted
/// services (so the background dispatcher drains <c>DispatchWorkflow</c> children and
/// the background activity invoker runs <c>Kind=Task</c> activities).
/// </summary>
internal static class ElsaRuntimeHarness
{
    /// <summary>
    /// NUnit category of the full-runtime workflow suites. CI runs them in their own
    /// <c>workflow-exec</c> slice (.github/scripts/dotnet-test-run.sh) so the <c>other</c>
    /// slice stays under ~5 min; a plain local <c>dotnet test</c> runs them too.
    /// </summary>
    public const string Category = "WorkflowExecution";

    public static ServiceProvider Start(ServiceProvider provider)
    {
        StartAsync(provider).GetAwaiter().GetResult();
        return provider;
    }

    public static async Task StartAsync(IServiceProvider provider)
    {
        await provider.GetRequiredService<IRegistriesPopulator>().PopulateAsync(CancellationToken.None);
        foreach (var hosted in provider.GetServices<IHostedService>())
            await hosted.StartAsync(CancellationToken.None);
    }

    /// <summary>
    /// Creates and runs an instance, then waits (bounded) until it leaves the
    /// Running state. <c>DispatchWorkflow</c> children run on the background
    /// dispatcher, so the parent is usually still suspended on them when
    /// <c>CreateAndRunInstanceAsync</c> returns — reading its output at that point
    /// sees an empty dictionary, which reads as a failure in every assertion.
    /// </summary>
    public static async Task<WorkflowState> RunUntilDoneAsync(
        IServiceProvider provider, string definitionId, IDictionary<string, object> input,
        TimeSpan? timeout = null, Func<WorkflowState, bool>? done = null)
    {
        var runtime = provider.GetRequiredService<IWorkflowRuntime>();
        var client = await runtime.CreateClientAsync();
        await client.CreateAndRunInstanceAsync(new CreateAndRunWorkflowInstanceRequest
        {
            WorkflowDefinitionHandle = WorkflowDefinitionHandle.ByDefinitionId(definitionId),
            Input = input,
        });

        return await WaitAsync(client, done ?? IsFinished, definitionId, timeout);
    }

    public static bool IsFinished(WorkflowState s) => s.Status == WorkflowStatus.Finished;

    /// <summary>Waits until the instance behind <paramref name="instanceId"/> finishes.</summary>
    public static async Task<WorkflowState> WaitForFinishedAsync(
        IServiceProvider provider, string instanceId, TimeSpan? timeout = null)
    {
        var client = await provider.GetRequiredService<IWorkflowRuntime>().CreateClientAsync(instanceId);
        return await WaitAsync(client, IsFinished, instanceId, timeout);
    }

    /// <summary>
    /// Polls the instance until <paramref name="done"/> holds; fails with its status and
    /// incidents if it never does.
    /// </summary>
    public static async Task<WorkflowState> WaitAsync(
        IWorkflowClient client, Func<WorkflowState, bool> done, string what, TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(20));
        WorkflowState state;
        while (!done(state = await client.ExportStateAsync()) && DateTime.UtcNow < deadline)
            await Task.Delay(50);

        if (!done(state))
            Assert.Fail($"'{what}' did not reach the expected state in time: {state.Status}/{state.SubStatus}, " +
                        $"incidents: [{string.Join("; ", state.Incidents.Select(i => $"{i.ActivityId}: {i.Exception?.Message}"))}]");
        return state;
    }

    /// <summary>
    /// The DCB events in a list of captured engine→API HTTP bodies. Only event-batch
    /// bodies (<c>{"events":[...]}</c>) count; other mediated calls (document persist,
    /// git, …) share the same handler and are skipped.
    /// </summary>
    public static List<System.Text.Json.JsonElement> EventsIn(IEnumerable<string> bodies) =>
        bodies
            .Select(b => System.Text.Json.JsonDocument.Parse(b).RootElement)
            .Where(r => r.ValueKind == System.Text.Json.JsonValueKind.Object
                        && r.TryGetProperty("events", out var e) && e.ValueKind == System.Text.Json.JsonValueKind.Array)
            .SelectMany(r => r.GetProperty("events").EnumerateArray())
            .ToList();

    /// <summary>Polls <paramref name="condition"/> until it holds; fails naming <paramref name="what"/> if it never does.</summary>
    public static async Task UntilAsync(Func<Task<bool>> condition, string what, TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(20));
        while (!await condition())
        {
            if (DateTime.UtcNow >= deadline) Assert.Fail($"Timed out waiting for {what}.");
            await Task.Delay(50);
        }
    }

    public static Task UntilAsync(Func<bool> condition, string what, TimeSpan? timeout = null)
        => UntilAsync(() => Task.FromResult(condition()), what, timeout);

    /// <summary>
    /// Waits until a document-decision bookmark for <paramref name="session"/> exists (any
    /// tenant). The AcceptanceRequest is published one step BEFORE the gate activity
    /// creates its bookmark, so a resume sent the moment the request lands can find
    /// nothing to resume. Tenant-agnostic on purpose: a wrong-tenant resume must still
    /// reach the endpoint and get its 404.
    /// </summary>
    public static Task WaitForDecisionBookmarkAsync(IServiceProvider provider, Guid session)
    {
        var store = provider.GetRequiredService<Elsa.Workflows.Runtime.IBookmarkStore>();
        var suffix = "-" + session;
        return UntilAsync(async () =>
            (await store.FindManyAsync(new Elsa.Workflows.Runtime.Filters.BookmarkFilter(), CancellationToken.None))
                .Any(b => b.Name is { } n && n.StartsWith("document-decision-", StringComparison.Ordinal)
                                         && n.EndsWith(suffix, StringComparison.Ordinal)),
            $"the decision bookmark for session {session}");
    }
}
