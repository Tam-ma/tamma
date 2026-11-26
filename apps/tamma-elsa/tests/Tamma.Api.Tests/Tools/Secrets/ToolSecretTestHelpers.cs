using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Secrets;
using Tamma.Api.Services.Secrets.Postgres;
using Tamma.Api.Services.Tools.Secrets;
using Tamma.Core;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;
using Tamma.Platforms.Abstractions;

namespace Tamma.Api.Tests.Tools.Secrets;

internal sealed class ManualTimeProvider : TimeProvider
{
    private DateTimeOffset _utcNow;

    public ManualTimeProvider(DateTimeOffset? initialUtcNow = null)
    {
        _utcNow = initialUtcNow ?? new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);
    }

    public override DateTimeOffset GetUtcNow() => _utcNow;

    public void Advance(TimeSpan delta) => _utcNow = _utcNow.Add(delta);
}

internal sealed class SpyPlatformCredentialReader : IPlatformCredentialReader
{
    private readonly Func<string, Guid?, string, string?> _handler;

    public List<(string Scope, Guid? TenantId, string Name)> Calls { get; } = new();

    public SpyPlatformCredentialReader(Func<string, Guid?, string, string?> handler)
    {
        _handler = handler;
    }

    public Task<string?> ReadActivePlaintextAsync(
        string scope,
        Guid? tenantId,
        string name,
        CancellationToken ct = default)
    {
        Calls.Add((scope, tenantId, name));
        return Task.FromResult(_handler(scope, tenantId, name));
    }
}

internal sealed class CapturingSecretAccessAuditor : ISecretAccessAuditor
{
    public List<SecretAuditEvent> Events { get; } = new();

    public Task EmitAsync(SecretAuditEvent auditEvent, CancellationToken ct = default)
    {
        Events.Add(auditEvent);
        return Task.CompletedTask;
    }
}

internal sealed class CapturingEventRepository : IEventRepository
{
    public List<DomainEvent> Appended { get; } = new();
    public Exception? ThrowOnAppend { get; set; }

    public Task<DomainEvent> AppendAsync(DomainEvent evt)
    {
        if (ThrowOnAppend is not null)
        {
            throw ThrowOnAppend;
        }

        Appended.Add(evt);
        return Task.FromResult(evt);
    }

    public Task<DomainEvent?> GetByIdAsync(Guid id) =>
        Task.FromResult(Appended.FirstOrDefault(e => e.Id == id));

    public Task<List<DomainEvent>> QueryAsync(Guid? tenantId, string? type, int? issueNumber, int limit) =>
        Task.FromResult(Appended.Take(limit).ToList());

    public Task<DomainEvent?> GetLastByTypeAsync(Guid tenantId, string type) =>
        Task.FromResult(Appended.LastOrDefault(e => e.TenantId == tenantId && e.Type == type));

    public Task ClearAsync(Guid tenantId)
    {
        Appended.RemoveAll(e => e.TenantId == tenantId);
        return Task.CompletedTask;
    }

    public Task<(IReadOnlyList<DomainEvent> Events, int Total)> QueryWithPaginationAsync(
        Guid? tenantId, string? type, int? issueNumber, int limit, int offset) =>
        Task.FromResult<(IReadOnlyList<DomainEvent>, int)>((Appended.Skip(offset).Take(limit).ToList(), Appended.Count));

    public Task<(IReadOnlyList<DomainEvent> Events, int Total)> ListByTenantAsync(
        Guid tenantId, string? typePrefix, int limit, int offset) =>
        Task.FromResult<(IReadOnlyList<DomainEvent>, int)>((Appended.Skip(offset).Take(limit).ToList(), Appended.Count));
}

internal sealed class CapturingLogger<T> : ILogger<T>
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

internal sealed class SingleSecretsContextFactory : IDbContextFactory<SecretsDbContext>
{
    private readonly DbContextOptions<SecretsDbContext> _options;

    public SingleSecretsContextFactory(DbContextOptions<SecretsDbContext> options)
    {
        _options = options;
    }

    public SecretsDbContext CreateDbContext() => new(_options);

    public Task<SecretsDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(new SecretsDbContext(_options));
}

/// <summary>
/// Fake external-touching <see cref="IToolExecutor"/> modeling the Story 42-4 D3/D8 contract:
/// resolves its required credential immediately before calling the vendor spy, scrubs by-value
/// at the <see cref="ExecuteAsync"/> boundary, drops the credential before returning, and never
/// throws (returns <c>ToolExecutionResult { Success = false }</c> on <see cref="TammaError"/>).
/// </summary>
internal sealed class FakeExternalToolExecutor : IToolExecutor
{
    private readonly IToolSecretProvider _secretProvider;
    private readonly Guid? _runTenantId;
    private readonly Func<string, string> _vendorCall;
    private readonly Action<string, string>? _onToolFailed;

    public int VendorCallCount { get; private set; }
    public ToolCredentialTag? LastUsedTag { get; private set; }

    public FakeExternalToolExecutor(
        IToolSecretProvider secretProvider,
        Guid? runTenantId,
        SecretRequirement requirement,
        Func<string, string> vendorCall,
        Action<string, string>? onToolFailed = null)
    {
        _secretProvider = secretProvider;
        _runTenantId = runTenantId;
        _vendorCall = vendorCall;
        _onToolFailed = onToolFailed;
        Descriptor = new ToolDescriptor(requirement, Suspends: false);
    }

    public string ToolName => "cloud_deploy_fake";
    public string Description => "Test external-touching tool executor";
    public Dictionary<string, object> InputSchema => new();
    public ToolDescriptor Descriptor { get; }

    public async Task<ToolExecutionResult> ExecuteAsync(
        string toolCallId,
        string argumentsJson,
        CancellationToken cancellationToken = default)
    {
        var req = Descriptor.RequiredSecret!;
        ToolCredential credential;
        try
        {
            credential = await _secretProvider.ResolveAsync(
                _runTenantId,
                req,
                new ToolSecretAccessContext(ToolName: ToolName, CorrelationId: toolCallId),
                cancellationToken).ConfigureAwait(false);
        }
        catch (TammaError err)
        {
            var failureMessage = $"Capability unconfigured ({err.Code}): {err.Message}";
            _onToolFailed?.Invoke(toolCallId, failureMessage);
            return new ToolExecutionResult(
                ToolCallId: toolCallId,
                ToolName: ToolName,
                Success: false,
                Output: failureMessage,
                DurationMs: 1);
        }

        // Only the tag projection is ever retained for diagnostics.
        LastUsedTag = credential.ToTag();

        try
        {
            VendorCallCount++;
            var rawResponse = _vendorCall(credential.Plaintext);
            var safeOutput = ToolSecretValueScrubber.Scrub(rawResponse, credential.Plaintext);

            return new ToolExecutionResult(
                ToolCallId: toolCallId,
                ToolName: ToolName,
                Success: true,
                Output: safeOutput,
                DurationMs: 2);
        }
        catch (Exception ex)
        {
            var safeError = ToolSecretValueScrubber.Scrub(ex.Message, credential.Plaintext);
            _onToolFailed?.Invoke(toolCallId, safeError);
            return new ToolExecutionResult(
                ToolCallId: toolCallId,
                ToolName: ToolName,
                Success: false,
                Output: safeError,
                DurationMs: 2);
        }
    }
}
