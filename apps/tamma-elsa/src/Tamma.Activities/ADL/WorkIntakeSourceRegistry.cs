using Microsoft.Extensions.Configuration;
using Tamma.Core;
using Tamma.Core.Tracking;

namespace Tamma.Activities.ADL;

/// <summary>
/// Story 44-7 AC3 (D4) — fail-loud keyed registry of <see cref="IWorkIntakeSource"/>
/// implementations, mirroring <c>IPlatformTaskHandlerRegistry</c>'s startup
/// duplicate guard and ordinal vocabulary validation.
/// </summary>
public sealed class WorkIntakeSourceRegistry
{
    private readonly Dictionary<WorkIntakeSourceKind, IWorkIntakeSource> _sources = new();

    public WorkIntakeSourceRegistry(IEnumerable<IWorkIntakeSource> sources)
    {
        ArgumentNullException.ThrowIfNull(sources);
        foreach (var source in sources)
        {
            ArgumentNullException.ThrowIfNull(source);
            if (!_sources.TryAdd(source.Kind, source))
            {
                throw new InvalidOperationException(
                    $"Duplicate work intake source registered for kind '{source.Kind.ToWire()}'. "
                    + "Each WorkIntakeSourceKind may have at most one registered IWorkIntakeSource.");
            }
        }
    }

    public IReadOnlyCollection<WorkIntakeSourceKind> RegisteredKinds => _sources.Keys;

    /// <summary>
    /// Resolve the ordered list of configured sources. Throws loudly on any
    /// unknown source name (naming the accepted set) or unregistered kind.
    /// Defaults to <c>platform-issue</c> when <paramref name="configuredNames"/>
    /// is null or empty.
    /// </summary>
    public IReadOnlyList<IWorkIntakeSource> ResolveConfigured(IEnumerable<string>? configuredNames)
    {
        var names = configuredNames?
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Select(n => n.Trim())
            .ToList();

        if (names is null || names.Count == 0)
        {
            if (_sources.TryGetValue(WorkIntakeSourceKind.PlatformIssue, out var defaultSource))
                return [defaultSource];
            return _sources.Values.ToList();
        }

        var resolved = new List<IWorkIntakeSource>(names.Count);
        var seen = new HashSet<WorkIntakeSourceKind>();
        foreach (var name in names)
        {
            // Fail-loud ordinal parse naming the accepted vocabulary (AC3 / D4).
            var kind = WorkIntakeSourceKindExtensions.Parse(name);
            if (!_sources.TryGetValue(kind, out var source))
            {
                var registered = string.Join(", ", _sources.Keys.Select(k => k.ToWire()));
                throw new TammaError(
                    "TRACKER.UNKNOWN_INTAKE_SOURCE",
                    $"Work intake source '{name}' is not registered. Registered sources: [{registered}].",
                    new Dictionary<string, object?> { ["input"] = name },
                    retryable: false,
                    severity: TammaErrorSeverity.High);
            }
            if (seen.Add(kind))
                resolved.Add(source);
        }

        return resolved;
    }

    public static IReadOnlyList<string> ReadConfiguredSourceNames(IConfiguration? configuration)
    {
        if (configuration is null)
            return [];

        var section = configuration.GetSection("Intake:Sources");
        var children = section.GetChildren()
            .Select(c => c.Value)
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Select(v => v!.Trim())
            .ToList();
        if (children.Count > 0)
            return children;

        var csv = configuration["Intake:Sources"];
        if (string.IsNullOrWhiteSpace(csv))
            return [];

        return csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }
}
