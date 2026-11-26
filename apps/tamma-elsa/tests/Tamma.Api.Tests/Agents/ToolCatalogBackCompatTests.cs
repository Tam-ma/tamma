using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Activities.ToolExecution;
using Tamma.Api.Services.Agents;
using Tamma.Core.Actions;

namespace Tamma.Api.Tests.Agents;

/// <summary>
/// Story 42-1 AC5 / D7: proves that with an empty allowlist an unrestricted caller resolves and
/// executes all six DI-registered built-in tool names through <see cref="InlineToolLoopRunner"/>
/// on BOTH execution branches (<c>EnableParallelTools = false</c> default, and <c>true</c>).
/// </summary>
[TestFixture]
public class ToolCatalogBackCompatTests
{
    private const string Model = "claude-sonnet-4-20250514";

    private static readonly string[] SixBuiltInNames =
    [
        "file_read",
        "file_write",
        "search_code",
        "shell_execute",
        "git_operations",
        "run_tests",
    ];

    [TestCase(false)]
    [TestCase(true)]
    public async Task UnrestrictedCaller_ResolvesAndExecutesAllSixBuiltIns_OnBothBranches(bool enableParallelTools)
    {
        var executed = new List<string>();
        var executors = SixBuiltInNames.Select(n => (IToolExecutor)new RecordingTool(n, executed)).ToArray();
        var registry = new ToolExecutorRegistry(executors, NullLogger<ToolExecutorRegistry>.Instance);

        registry.GetAll().Select(t => t.ToolName).Should().BeEquivalentTo(SixBuiltInNames);
        registry.GetAllowed(allowlist: null).Select(t => t.ToolName).Should().BeEquivalentTo(SixBuiltInNames);
        registry.GetAllowed(allowlist: Array.Empty<string>()).Select(t => t.ToolName).Should().BeEquivalentTo(SixBuiltInNames);

        var calls = SixBuiltInNames
            .Select((name, i) => ($"call-{i}", name, "{}"))
            .ToArray();

        using var handler = new SequencedHandler(
            ToolUse(calls),
            EndTurn("all six executed"));

        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient(It.IsAny<string>()))
            .Returns(() => new HttpClient(handler, disposeHandler: false));

        var allowAllGate = new Mock<IToolLoopAutonomyGate>();
        allowAllGate.Setup(g => g.Evaluate(It.IsAny<string>(), It.IsAny<string?>()))
            .Returns((string name, string? _) => new ToolLoopGateDecision(
                ToolLoopGateOutcome.Allowed,
                new ActionKey(ActionNamespace.Tool, name),
                MinAutonomy: 0,
                Dial: 70,
                Reason: "allowed"));

        var parallelExecutor = new ParallelToolExecutor(NullLogger<ParallelToolExecutor>.Instance);
        var runner = new InlineToolLoopRunner(
            NullLogger<InlineToolLoopRunner>.Instance,
            factory.Object,
            configuration: null,
            sanitizer: null,
            autonomyGate: allowAllGate.Object,
            toolRegistry: registry,
            parallelExecutor: parallelExecutor);

        var loopConfig = new ToolLoopConfig
        {
            EnableParallelTools = enableParallelTools,
            AllowedTools = null,
            MaxSteps = 4,
            ToolTimeoutMs = 5000,
        };

        var result = await runner.RunAsync(
            provider: "anthropic",
            providerConfig: new LlmProviderConfig
            {
                Name = "anthropic",
                BaseUrl = "https://api.anthropic.com",
                ApiKey = "test-key",
                TimeoutSeconds = 120,
            },
            model: Model,
            systemPrompt: "test",
            userPrompt: "run all six built-ins",
            maxTokens: 1024,
            temperature: 0.0,
            tools: null,
            enableToolLoop: true,
            loopConfig: loopConfig,
            correlationId: "story-42-1-backcompat",
            repair: null,
            trailContext: null,
            ct: CancellationToken.None);

        result.Response.Success.Should().BeTrue();
        result.Response.ResponseText.Should().Be("all six executed");
        executed.Should().BeEquivalentTo(SixBuiltInNames);
    }

    private sealed class RecordingTool(string name, List<string> executed) : IToolExecutor
    {
        public string ToolName => name;
        public string Description => $"Built-in stub {name}";
        public Dictionary<string, object> InputSchema => new();
        public ToolDescriptor Descriptor => ToolDescriptor.Default;

        public Task<ToolExecutionResult> ExecuteAsync(
            string toolCallId, string argumentsJson, CancellationToken cancellationToken = default)
        {
            lock (executed)
            {
                executed.Add(name);
            }

            return Task.FromResult(new ToolExecutionResult(toolCallId, name, true, $"{name} ok", 1));
        }
    }

    private static string EndTurn(string text) =>
        JsonSerializer.Serialize(new
        {
            content = new[] { new { type = "text", text } },
            stop_reason = "end_turn",
            usage = new { input_tokens = 10, output_tokens = 5 },
            model = Model,
        });

    private static string ToolUse(params (string Id, string Name, string ArgsJson)[] calls) =>
        JsonSerializer.Serialize(new
        {
            content = calls.Select(c => new
            {
                type = "tool_use",
                id = c.Id,
                name = c.Name,
                input = JsonSerializer.Deserialize<JsonElement>(c.ArgsJson),
            }).ToArray<object>(),
            stop_reason = "tool_use",
            usage = new { input_tokens = 10, output_tokens = 5 },
            model = Model,
        });

    private sealed class SequencedHandler(params string[] bodies) : HttpMessageHandler
    {
        private int _index;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = _index < bodies.Length ? bodies[_index] : bodies[^1];
            _index++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });
        }
    }
}
