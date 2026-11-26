using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Activities.Security;
using Tamma.Activities.ToolExecution;
using Tamma.Api.Services.Agents;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Agents.ToolAudit;

internal sealed class RecordingAuditEventRepository : IEventRepository
{
    public List<DomainEvent> Events { get; } = new();
    public Exception? ThrowOnAppend { get; set; }

    public Task<DomainEvent> AppendAsync(DomainEvent evt)
    {
        if (ThrowOnAppend is not null)
        {
            throw ThrowOnAppend;
        }

        Events.Add(evt);
        return Task.FromResult(evt);
    }

    public Task<DomainEvent?> GetByIdAsync(Guid id) =>
        Task.FromResult(Events.FirstOrDefault(e => e.Id == id));

    public Task<List<DomainEvent>> QueryAsync(Guid? tenantId, string? type, int? issueNumber, int limit) =>
        Task.FromResult(Events.Take(limit).ToList());

    public Task<DomainEvent?> GetLastByTypeAsync(Guid tenantId, string type) =>
        Task.FromResult(Events.LastOrDefault(e => e.TenantId == tenantId && e.Type == type));

    public Task ClearAsync(Guid tenantId)
    {
        Events.RemoveAll(e => e.TenantId == tenantId);
        return Task.CompletedTask;
    }

    public Task<(IReadOnlyList<DomainEvent> Events, int Total)> QueryWithPaginationAsync(
        Guid? tenantId, string? type, int? issueNumber, int limit, int offset) =>
        Task.FromResult<(IReadOnlyList<DomainEvent>, int)>((Events.Skip(offset).Take(limit).ToList(), Events.Count));

    public Task<(IReadOnlyList<DomainEvent> Events, int Total)> ListByTenantAsync(
        Guid tenantId, string? typePrefix, int limit, int offset) =>
        Task.FromResult<(IReadOnlyList<DomainEvent>, int)>((Events.Skip(offset).Take(limit).ToList(), Events.Count));
}

internal sealed class CapturingAuditLogger<T> : ILogger<T>
{
    public ConcurrentQueue<(LogLevel Level, string Message, Exception? Exception)> Entries { get; } = new();

    public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;
    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        Entries.Enqueue((logLevel, formatter(state, exception), exception));
    }

    private sealed class NullScope : IDisposable
    {
        public static readonly NullScope Instance = new();
        public void Dispose() { }
    }
}

internal sealed class SequencedAnthropicHandler : HttpMessageHandler
{
    private readonly Queue<string> _responses;

    public SequencedAnthropicHandler(params string[] responses)
    {
        _responses = new Queue<string>(responses);
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = _responses.Count > 0
            ? _responses.Dequeue()
            : ToolAuditTestFixtures.AnthropicEndTurn("done");

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        });
    }
}

internal sealed class LambdaToolExecutor : IToolExecutor
{
    private readonly Func<string, string, CancellationToken, Task<ToolExecutionResult>> _handler;

    public LambdaToolExecutor(
        string toolName,
        Func<string, string, CancellationToken, Task<ToolExecutionResult>> handler,
        ToolDescriptor? descriptor = null)
    {
        ToolName = toolName;
        _handler = handler;
        Descriptor = descriptor ?? ToolDescriptor.Default;
    }

    public string ToolName { get; }
    public string Description => $"Test executor for {ToolName}";
    public Dictionary<string, object> InputSchema => new();
    public ToolDescriptor Descriptor { get; }

    public Task<ToolExecutionResult> ExecuteAsync(
        string toolCallId,
        string argumentsJson,
        CancellationToken cancellationToken = default) =>
        _handler(toolCallId, argumentsJson, cancellationToken);
}

internal static class ToolAuditTestFixtures
{
    public const string Model = "claude-sonnet-4-20250514";

    public static LlmProviderConfig ProviderConfig() => new()
    {
        Name = "anthropic",
        BaseUrl = "https://api.anthropic.com",
        ApiKey = "test-api-key",
        TimeoutSeconds = 30,
    };

    public static AgentTrailContext SampleTrailContext(Guid? tenantId = null, string? issueId = "TAM-425") => new()
    {
        TenantId = tenantId ?? Guid.NewGuid(),
        AgentId = Guid.NewGuid(),
        AgentVersion = 2,
        Role = "developer",
        Provider = "anthropic",
        Model = Model,
        IssueId = issueId,
        Iteration = 0,
        CorrelationId = "corr-42-5",
        CredentialSource = "platform",
    };

    public static string AnthropicToolUse(params (string Id, string Name, object Input)[] calls)
    {
        var blocks = calls.Select(c => new
        {
            type = "tool_use",
            id = c.Id,
            name = c.Name,
            input = c.Input,
        }).ToArray();

        return JsonSerializer.Serialize(new
        {
            id = "msg_1",
            type = "message",
            role = "assistant",
            stop_reason = "tool_use",
            content = blocks,
            usage = new { input_tokens = 25, output_tokens = 15 },
        });
    }

    public static string AnthropicEndTurn(string text = "all done") =>
        JsonSerializer.Serialize(new
        {
            id = "msg_2",
            type = "message",
            role = "assistant",
            stop_reason = "end_turn",
            content = new[] { new { type = "text", text } },
            usage = new { input_tokens = 20, output_tokens = 10 },
        });

    public static IHttpClientFactory HttpFactoryFor(HttpMessageHandler handler)
    {
        var mock = new Mock<IHttpClientFactory>();
        mock.Setup(f => f.CreateClient(It.IsAny<string>()))
            .Returns(() => new HttpClient(handler, disposeHandler: false));
        return mock.Object;
    }

    public static IToolLoopAutonomyGate AllowAllGate()
    {
        var gate = new Mock<IToolLoopAutonomyGate>();
        gate.Setup(g => g.Evaluate(It.IsAny<string>(), It.IsAny<string?>()))
            .Returns(new ToolLoopGateDecision(ToolLoopGateOutcome.Allowed, null, null, 100, "test-allow"));
        return gate.Object;
    }

    public static InlineToolLoopRunner CreateRunner(
        HttpMessageHandler handler,
        IToolExecutorRegistry? registry,
        IToolAuditEmitter auditEmitter,
        IToolCallValidator? validator = null,
        ToolLoopEventEmitter? sseEmitter = null,
        ParallelToolExecutor? parallelExecutor = null) =>
        new(
            NullLogger<InlineToolLoopRunner>.Instance,
            HttpFactoryFor(handler),
            configuration: null,
            sanitizer: null,
            autonomyGate: AllowAllGate(),
            toolRegistry: registry,
            toolCallValidator: validator,
            eventEmitter: sseEmitter,
            parallelExecutor: parallelExecutor ?? new ParallelToolExecutor(NullLogger<ParallelToolExecutor>.Instance),
            toolAuditEmitter: auditEmitter);
}
