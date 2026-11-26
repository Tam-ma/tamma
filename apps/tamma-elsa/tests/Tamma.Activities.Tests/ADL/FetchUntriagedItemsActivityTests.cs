using System.Text.Json;
using Elsa.Extensions;
using Elsa.Workflows;
using Elsa.Workflows.Activities;
using Elsa.Workflows.Management.Activities.SetOutput;
using Elsa.Workflows.Models;
using Elsa.Workflows.Options;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NUnit.Framework;
using Tamma.Activities.ADL;

namespace Tamma.Activities.Tests.ADL;

/// <summary>
/// Story 44-7 AC1 (Test 2) — verifies <see cref="FetchUntriagedItemsActivity"/>
/// deserializes the real <c>{ issues, total }</c> envelope, maps string/int
/// platform numbers &amp; <c>html_url</c>, and filters already-triaged issues.
/// </summary>
[TestFixture]
public class FetchUntriagedItemsActivityTests
{
    [Test]
    public async Task Parses_the_real_envelope_shape()
    {
        var handler = new SelectWorkItemActivityTests.StubHttpMessageHandler(req =>
        {
            if (req.RequestUri!.AbsolutePath.EndsWith("/api/engine/issues"))
            {
                return SelectWorkItemActivityTests.JsonResponse("""
                    {
                      "issues": [
                        {
                          "number": "101",
                          "title": "Untriaged raw issue",
                          "body": "Needs triage",
                          "html_url": "https://github.com/Tam-ma/tamma/issues/101",
                          "labels": []
                        },
                        {
                          "number": 102,
                          "title": "Already triaged bug",
                          "html_url": "https://github.com/Tam-ma/tamma/issues/102",
                          "labels": [{ "name": "bug" }, { "name": "priority-high" }]
                        }
                      ],
                      "total": 2
                    }
                    """);
            }
            return SelectWorkItemActivityTests.JsonResponse("[]");
        });

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Anthropic:UseMock"] = "false",
                ["Engine:CallbackUrl"] = "http://engine-callback.test",
            })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddElsa(elsa => elsa.AddActivity<FetchUntriagedItemsActivity>());
        services.AddSingleton<IConfiguration>(config);
        services.AddSingleton<IHttpClientFactory>(
            new SelectWorkItemActivityTests.SingleHandlerHttpClientFactory(handler));

        await using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var runner = scope.ServiceProvider.GetRequiredService<IWorkflowRunner>();

        var result = await runner.RunAsync(
            new FetchUntriagedProbeWorkflow("Tam-ma/tamma"),
            new RunWorkflowOptions(),
            CancellationToken.None);

        result.WorkflowState.Status.Should().Be(WorkflowStatus.Finished);
        result.WorkflowState.Output["totalCount"].Should().Be(1);

        var itemsJson = (string)result.WorkflowState.Output["itemsJson"];
        var items = JsonSerializer.Deserialize<List<TriageItem>>(itemsJson)!;
        items.Should().ContainSingle();
        items[0].Number.Should().Be(101);
        items[0].Title.Should().Be("Untriaged raw issue");
        items[0].Url.Should().Be("https://github.com/Tam-ma/tamma/issues/101");
    }

    private sealed class FetchUntriagedProbeWorkflow(string repo) : WorkflowBase
    {
        protected override void Build(IWorkflowBuilder builder)
        {
            var itemsVar = builder.WithVariable<string>("ItemsJson", "[]");
            var totalVar = builder.WithVariable<int>("TotalCount", 0);

            builder.Root = new Sequence
            {
                Activities =
                {
                    new FetchUntriagedItemsActivity
                    {
                        Id = "FetchUntriaged",
                        Repository = new Input<string>(repo),
                        ItemsJson = new Output<string>(itemsVar),
                        TotalCount = new Output<int>(totalVar),
                    },
                    new SetOutput { Id = "OutItems", OutputName = new("itemsJson"), OutputValue = new(ctx => (object)itemsVar.Get(ctx)) },
                    new SetOutput { Id = "OutTotal", OutputName = new("totalCount"), OutputValue = new(ctx => (object)totalVar.Get(ctx)) },
                }
            };
        }
    }
}
