using System.Text.Json;
using System.Text.Json.Serialization;
using Tamma.Core;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (AC6 / D8) — per-principal configuration for the tenant's
/// Orchestrator Agent (provider binding, model, context budget, spend caps, and
/// idle-eviction timeout). Stored as JSONB in <c>orchestrator_agent_configs</c>.
///
/// <para><b>Per-mode ownership:</b> single-user mode — the sole user owns the
/// single agent + config (keyed <c>user_id</c>); SaaS mode — the tenant owns the
/// agent + config (keyed <c>tenant_id</c>), editable by tenant admin/owner
/// (<c>orchestrator:manage</c>), readable by members.</para>
/// </summary>
public sealed record OrchestratorAgentConfig
{
    [JsonPropertyName("provider")]
    public string Provider { get; init; } = OrchestratorAgentDefaults.DefaultProvider;

    [JsonPropertyName("model")]
    public string Model { get; init; } = OrchestratorAgentDefaults.DefaultModel;

    [JsonPropertyName("maxSessionTokens")]
    public int MaxSessionTokens { get; init; } = OrchestratorAgentDefaults.DefaultMaxSessionTokens;

    [JsonPropertyName("compactAfterTurns")]
    public int CompactAfterTurns { get; init; } = OrchestratorAgentDefaults.DefaultCompactAfterTurns;

    [JsonPropertyName("maxTokensPerDecision")]
    public int MaxTokensPerDecision { get; init; } = OrchestratorAgentDefaults.DefaultMaxTokensPerDecision;

    [JsonPropertyName("maxUsdPerDay")]
    public decimal MaxUsdPerDay { get; init; } = OrchestratorAgentDefaults.DefaultMaxUsdPerDay;

    [JsonPropertyName("idleEvictAfterMinutes")]
    public int IdleEvictAfterMinutes { get; init; } = OrchestratorAgentDefaults.DefaultIdleEvictAfterMinutes;

    [JsonPropertyName("maxToolSteps")]
    public int MaxToolSteps { get; init; } = OrchestratorAgentDefaults.DefaultMaxToolSteps;

    [JsonPropertyName("temperature")]
    public double Temperature { get; init; } = OrchestratorAgentDefaults.DefaultTemperature;

    /// <summary>
    /// Fail-loud validation against conservative safety bounds (D8). Throws
    /// <see cref="TammaError"/> (<c>ORCHESTRATOR.CONFIG.INVALID</c>) on any
    /// out-of-range knob or blank provider/model.
    /// </summary>
    public void Validate()
    {
        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(Provider) || Provider.Trim().Length > 64)
            errors.Add("provider is required (1–64 characters).");
        if (string.IsNullOrWhiteSpace(Model) || Model.Trim().Length > 128)
            errors.Add("model is required (1–128 characters).");
        if (MaxSessionTokens is < OrchestratorAgentDefaults.MinSessionTokens or > OrchestratorAgentDefaults.MaxSessionTokensLimit)
            errors.Add($"maxSessionTokens must be between {OrchestratorAgentDefaults.MinSessionTokens} and {OrchestratorAgentDefaults.MaxSessionTokensLimit}.");
        if (CompactAfterTurns is < OrchestratorAgentDefaults.MinCompactAfterTurns or > OrchestratorAgentDefaults.MaxCompactAfterTurnsLimit)
            errors.Add($"compactAfterTurns must be between {OrchestratorAgentDefaults.MinCompactAfterTurns} and {OrchestratorAgentDefaults.MaxCompactAfterTurnsLimit}.");
        if (MaxTokensPerDecision is < OrchestratorAgentDefaults.MinTokensPerDecision or > OrchestratorAgentDefaults.MaxTokensPerDecisionLimit)
            errors.Add($"maxTokensPerDecision must be between {OrchestratorAgentDefaults.MinTokensPerDecision} and {OrchestratorAgentDefaults.MaxTokensPerDecisionLimit}.");
        if (MaxTokensPerDecision > MaxSessionTokens)
            errors.Add("maxTokensPerDecision cannot exceed maxSessionTokens.");
        if (MaxUsdPerDay is <= 0m or > OrchestratorAgentDefaults.MaxUsdPerDayLimit)
            errors.Add($"maxUsdPerDay must be > 0 and <= {OrchestratorAgentDefaults.MaxUsdPerDayLimit}.");
        if (IdleEvictAfterMinutes is < OrchestratorAgentDefaults.MinIdleEvictMinutes or > OrchestratorAgentDefaults.MaxIdleEvictMinutes)
            errors.Add($"idleEvictAfterMinutes must be between {OrchestratorAgentDefaults.MinIdleEvictMinutes} and {OrchestratorAgentDefaults.MaxIdleEvictMinutes}.");
        if (MaxToolSteps is < 1 or > OrchestratorAgentDefaults.MaxToolStepsLimit)
            errors.Add($"maxToolSteps must be between 1 and {OrchestratorAgentDefaults.MaxToolStepsLimit}.");
        if (Temperature is < 0.0 or > 1.0 || double.IsNaN(Temperature))
            errors.Add("temperature must be between 0.0 and 1.0.");

        if (errors.Count > 0)
        {
            throw new TammaError(
                "ORCHESTRATOR.CONFIG.INVALID",
                "Invalid orchestrator agent configuration: " + string.Join(" ", errors),
                new Dictionary<string, object?> { ["errors"] = errors.ToArray() },
                retryable: false,
                severity: TammaErrorSeverity.Medium);
        }
    }
}

/// <summary>
/// Story 39-17 (D8) — conservative, drift-pinned safe defaults and hard bounds
/// for <see cref="OrchestratorAgentConfig"/>.
/// </summary>
public static class OrchestratorAgentDefaults
{
    public const string DefaultProvider = "anthropic";
    public const string DefaultModel = "claude-sonnet-4-20250514";
    public const int DefaultMaxSessionTokens = 64_000;
    public const int DefaultCompactAfterTurns = 24;
    public const int DefaultMaxTokensPerDecision = 4_096;
    public const decimal DefaultMaxUsdPerDay = 25.00m;
    public const int DefaultIdleEvictAfterMinutes = 30;
    public const int DefaultMaxToolSteps = 12;
    public const double DefaultTemperature = 0.2;

    public const int MinSessionTokens = 2_048;
    public const int MaxSessionTokensLimit = 200_000;
    public const int MinCompactAfterTurns = 4;
    public const int MaxCompactAfterTurnsLimit = 200;
    public const int MinTokensPerDecision = 256;
    public const int MaxTokensPerDecisionLimit = 32_768;
    public const decimal MaxUsdPerDayLimit = 10_000m;
    public const int MinIdleEvictMinutes = 1;
    public const int MaxIdleEvictMinutes = 1_440;
    public const int MaxToolStepsLimit = 40;

    public static readonly OrchestratorAgentConfig Config = new();

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}

/// <summary>Resolved config plus provenance for GET / PUT /api/orchestrator/config.</summary>
public sealed record ResolvedOrchestratorConfig(
    OrchestratorAgentConfig Config,
    string Source,
    int Version,
    DateTimeOffset UpdatedAt);
