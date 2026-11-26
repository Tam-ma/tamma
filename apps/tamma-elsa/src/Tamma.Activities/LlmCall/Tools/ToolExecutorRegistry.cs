using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Tamma.Activities.LlmCall.Tools;

/// <summary>
/// Default registry populated via DI (<c>IEnumerable&lt;IToolExecutor&gt;</c>) as an immutable
/// built-in base layer, with a thread-safe dynamic registration layer on top (Story 42-1 D4/D5).
/// Tool names are case-insensitive (<see cref="StringComparer.OrdinalIgnoreCase"/>).
/// </summary>
public class ToolExecutorRegistry : IToolExecutorRegistry
{
    private readonly IReadOnlyDictionary<string, IToolExecutor> _builtInExecutors;
    private readonly ConcurrentDictionary<string, IToolExecutor> _dynamicExecutors;
    private readonly ILogger<ToolExecutorRegistry> _logger;

    public ToolExecutorRegistry(
        IEnumerable<IToolExecutor> executors,
        ILogger<ToolExecutorRegistry> logger)
    {
        _logger = logger;
        var builtIns = new Dictionary<string, IToolExecutor>(StringComparer.OrdinalIgnoreCase);

        foreach (var executor in executors)
        {
            if (builtIns.ContainsKey(executor.ToolName))
            {
                _logger.LogWarning(
                    "Duplicate tool executor registration for '{ToolName}', keeping first",
                    executor.ToolName);
                continue;
            }

            builtIns[executor.ToolName] = executor;
            _logger.LogDebug("Registered tool executor: {ToolName}", executor.ToolName);
        }

        _builtInExecutors = builtIns;
        _dynamicExecutors = new ConcurrentDictionary<string, IToolExecutor>(StringComparer.OrdinalIgnoreCase);

        _logger.LogInformation(
            "ToolExecutorRegistry initialized with {RegisteredToolCount} tools: {ToolNames}",
            _builtInExecutors.Count,
            string.Join(", ", _builtInExecutors.Keys));
    }

    /// <inheritdoc/>
    public IToolExecutor? GetExecutor(string toolName)
    {
        if (_builtInExecutors.TryGetValue(toolName, out var builtIn))
            return builtIn;

        if (_dynamicExecutors.TryGetValue(toolName, out var dynamicExecutor))
            return dynamicExecutor;

        _logger.LogWarning(
            "Tool executor not found: {ToolName}. Registered count: {RegisteredToolCount}",
            toolName, _builtInExecutors.Count + _dynamicExecutors.Count);
        return null;
    }

    /// <inheritdoc/>
    public bool IsAllowed(string toolName, string[]? allowlist)
    {
        if (allowlist is null || allowlist.Length == 0)
            return true;

        return allowlist.Any(a => string.Equals(a, toolName, StringComparison.OrdinalIgnoreCase));
    }

    /// <inheritdoc/>
    public IReadOnlyList<IToolExecutor> GetAll()
    {
        var snapshot = new List<IToolExecutor>(_builtInExecutors.Count + _dynamicExecutors.Count);
        snapshot.AddRange(_builtInExecutors.Values);
        snapshot.AddRange(_dynamicExecutors.Values);
        return snapshot.AsReadOnly();
    }

    /// <inheritdoc/>
    public IReadOnlyList<IToolExecutor> GetAllowed(string[]? allowlist)
    {
        if (allowlist is null || allowlist.Length == 0)
            return GetAll();

        return GetAll()
            .Where(e => allowlist.Any(a =>
                string.Equals(a, e.ToolName, StringComparison.OrdinalIgnoreCase)))
            .ToList()
            .AsReadOnly();
    }

    /// <inheritdoc/>
    public void Register(IToolExecutor executor)
    {
        ArgumentNullException.ThrowIfNull(executor);

        if (string.IsNullOrWhiteSpace(executor.ToolName))
            throw new ArgumentException("ToolName must be non-empty.", nameof(executor));

        if (executor is IPrincipalScopedToolExecutor)
            throw new PrincipalScopedToolRegistrationException(executor.ToolName);

        if (_builtInExecutors.ContainsKey(executor.ToolName))
        {
            throw new InvalidOperationException(
                $"Tool '{executor.ToolName}' is already registered as a built-in DI-seeded tool and cannot be overridden dynamically.");
        }

        if (!_dynamicExecutors.TryAdd(executor.ToolName, executor))
        {
            throw new InvalidOperationException(
                $"Tool '{executor.ToolName}' is already registered. Call Unregister('{executor.ToolName}') before registering a replacement.");
        }

        _logger.LogInformation(
            "Dynamically registered tool executor '{ToolName}' (Suspends={Suspends}, RequiresSecret={RequiresSecret})",
            executor.ToolName,
            ToolDescriptor.Coalesce(executor.Descriptor).Suspends,
            ToolDescriptor.Coalesce(executor.Descriptor).RequiredSecret is not null);
    }

    /// <inheritdoc/>
    public bool Unregister(string toolName)
    {
        if (string.IsNullOrWhiteSpace(toolName))
            throw new ArgumentException("Tool name must be non-empty.", nameof(toolName));

        if (_builtInExecutors.ContainsKey(toolName))
        {
            throw new InvalidOperationException(
                $"Built-in DI-seeded tool '{toolName}' cannot be unregistered.");
        }

        if (!_dynamicExecutors.TryRemove(toolName, out _))
            return false;

        _logger.LogInformation("Unregistered dynamic tool executor '{ToolName}'", toolName);
        return true;
    }
}
