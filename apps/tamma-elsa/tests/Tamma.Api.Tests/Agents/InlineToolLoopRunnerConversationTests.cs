using System.Net;
using System.Text;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Agents;
using Tamma.Api.Services.Orchestrator;
using Tamma.Api.Services.Orchestrator.Tools;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Agents;

/// <summary>
/// Story 39-17 (D3) — verifies <see cref="IInlineToolLoopRunner.RunConversationAsync"/>:
/// appends turns in-place to the caller's persistent <see cref="ConversationMessage"/>
/// list and routes tool calls exclusively through <c>registryOverride</c> (never
/// falling back to the global DI tool registry), while preserving legacy
/// <see cref="IInlineToolLoopRunner.RunAsync"/> behavior.
/// </summary>
[TestFixture]
public class InlineToolLoopRunnerConversationTests
{
    private sealed class SequencedHttpHandler(Queue<string> responses) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = responses.Dequeue();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });
        }
    }

    private sealed class StubHttpClientFactory(HttpClient client) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => client;
    }

    private sealed class TrackingTool(string name, List<string> calls) : IToolExecutor
    {
        public string ToolName => name;
        public string Description => "tracking tool";
        public Dictionary<string, object> InputSchema => new() { ["type"] = "object" };
        public ToolDescriptor Descriptor => ToolDescriptor.Default;

        public Task<ToolExecutionResult> ExecuteAsync(string toolCallId, string argumentsJson, CancellationToken cancellationToken = default)
        {
            calls.Add($"{name}:{argumentsJson}");
            return Task.FromResult(new ToolExecutionResult(toolCallId, name, true, """{"status":"ok"}""", 1));
        }
    }

    [Test]
    public async Task RunConversationAsync_uses_registryOverride_and_mutates_messages_in_place()
    {
        var globalCalls = new List<string>();
        var overrideCalls = new List<string>();

        var globalRegistry = new ToolExecutorRegistry(
            new[] { new TrackingTool("global_only_tool", globalCalls) },
            NullLogger<ToolExecutorRegistry>.Instance);

        var emittedEvents = new List<DomainEvent>();
        var eventRepo = new Mock<IEventRepository>();
        eventRepo.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(ev => emittedEvents.Add(ev))
            .ReturnsAsync((DomainEvent ev) => ev);

        var ctx = new OrchestratorToolContext(Guid.NewGuid(), null, null, null, "corr-loop-1");
        var auditedOverride = new AuditedToolRegistry(
            new[] { new TrackingTool("document_get", overrideCalls) },
            ctx,
            eventRepo.Object);

        // Step 1: OpenAI-format tool call to document_get; Step 2: final answer
        var responses = new Queue<string>(new[]
        {
            """
            {
              "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                  "role": "assistant",
                  "content": null,
                  "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": { "name": "document_get", "arguments": "{\"documentId\":\"11111111-1111-1111-1111-111111111111\"}" }
                  }]
                }
              }],
              "usage": { "prompt_tokens": 20, "completion_tokens": 10 }
            }
            """,
            """
            {
              "choices": [{
                "finish_reason": "stop",
                "message": {
                  "role": "assistant",
                  "content": "Completed via override registry."
                }
              }],
              "usage": { "prompt_tokens": 35, "completion_tokens": 8 }
            }
            """,
        });

        using var httpClient = new HttpClient(new SequencedHttpHandler(responses));
        var runner = new InlineToolLoopRunner(
            logger: NullLogger<InlineToolLoopRunner>.Instance,
            httpClientFactory: new StubHttpClientFactory(httpClient),
            configuration: new ConfigurationBuilder().Build(),
            sanitizer: null,
            autonomyGate: new CatalogDefaultToolLoopAutonomyGate(),
            toolRegistry: globalRegistry);

        var messages = new List<ConversationMessage>
        {
            new() { Role = "system", Content = "You are the orchestrator." },
            new() { Role = "user", Content = "Inspect the document." },
        };

        var result = await runner.RunConversationAsync(
            provider: "openai",
            providerConfig: new LlmProviderConfig
            {
                ApiKey = "sk-test",
                BaseUrl = "https://api.openai.com",
                DefaultModel = "gpt-4o-mini",
            },
            model: "gpt-4o-mini",
            messages: messages,
            maxTokens: 256,
            temperature: 0.1,
            tools: OrchestratorToolCatalog.ToResolvedTools(auditedOverride),
            loopConfig: new ToolLoopConfig { MaxSteps = 5, AllowedTools = new[] { "document_get" } },
            registryOverride: auditedOverride,
            correlationId: "corr-loop-1",
            trailContext: null,
            ct: default);

        result.Response.Success.Should().BeTrue(result.Response.ErrorMessage);
        result.Response.ResponseText.Should().Be("Completed via override registry.");
        overrideCalls.Should().ContainSingle();
        globalCalls.Should().BeEmpty();
        emittedEvents.Should().ContainSingle(e => e.Type == OrchestratorEvents.ToolInvoked);

        // Messages list was mutated in place with assistant tool_call, tool result, and final assistant turn
        messages.Count.Should().BeGreaterThan(2);
        messages.Last().Role.Should().Be("assistant");
        messages.Last().Content.Should().Be("Completed via override registry.");
    }
}
