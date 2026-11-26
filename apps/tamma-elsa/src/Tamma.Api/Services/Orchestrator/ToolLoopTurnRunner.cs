using Microsoft.Extensions.Logging;
using Tamma.Activities.LlmCall.Credentials;
using Tamma.Activities.LlmCall.Models;
using Tamma.Api.Services.Agents;
using Tamma.Api.Services.Providers;
using Tamma.Api.Services.Security;
using Tamma.Core;

namespace Tamma.Api.Services.Orchestrator;

/// <summary>
/// Story 39-17 (D2 / D4) — production <see cref="IOrchestratorTurnRunner"/>.
/// Mirrors <see cref="ManagedAgent"/>'s composition sequence for a persistent
/// conversation session:
/// <list type="number">
///   <item>SaaS provider gate (<see cref="ISaaSProviderGate"/>)</item>
///   <item>Server-side budget guard (<see cref="IBudgetGuard"/>)</item>
///   <item>Credential resolution (<see cref="IProviderCredentialResolver"/> — BYOK → platform)</item>
///   <item>Conversation tool loop (<see cref="IInlineToolLoopRunner.RunConversationAsync"/> with the per-tenant <c>AuditedToolRegistry</c>)</item>
///   <item>Cost accounting (<see cref="IProviderPricingService"/>)</item>
/// </list>
///
/// <para><b>Mediation allowlist authority (Story 39-17 D2):</b> alongside
/// <see cref="ManagedAgent"/>, this class is the ONLY other constructor in
/// <c>Tamma.Api</c> permitted to consume <see cref="IInlineToolLoopRunner"/>,
/// pinned by <c>OrchestratorMediationPinTests</c>.</para>
/// </summary>
public sealed class ToolLoopTurnRunner : IOrchestratorTurnRunner
{
    private readonly ISaaSProviderGate _gate;
    private readonly IBudgetGuard _budget;
    private readonly IProviderCredentialResolver _credentials;
    private readonly IInlineToolLoopRunner _runner;
    private readonly IProviderPricingService _pricing;
    private readonly ILogger<ToolLoopTurnRunner> _logger;

    public ToolLoopTurnRunner(
        ISaaSProviderGate gate,
        IBudgetGuard budget,
        IProviderCredentialResolver credentials,
        IInlineToolLoopRunner runner,
        IProviderPricingService pricing,
        ILogger<ToolLoopTurnRunner> logger)
    {
        _gate = gate ?? throw new ArgumentNullException(nameof(gate));
        _budget = budget ?? throw new ArgumentNullException(nameof(budget));
        _credentials = credentials ?? throw new ArgumentNullException(nameof(credentials));
        _runner = runner ?? throw new ArgumentNullException(nameof(runner));
        _pricing = pricing ?? throw new ArgumentNullException(nameof(pricing));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<OrchestratorTurnResult> RunTurnAsync(
        OrchestratorTurnRequest request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var config = request.Config;
        var provider = config.Provider;
        var model = string.IsNullOrWhiteSpace(config.Model)
            ? _runner.GetDefaultModel(provider, request.TenantId)
            : config.Model;

        // 1. Provider gate (fail-closed in SaaS for disallowed providers / un-entitled tenants).
        var gateDecision = await _gate.InspectAsync(
            new ProviderGateContext(provider, Role: "orchestrator", Action: "orchestrate", TenantId: request.TenantId),
            ct).ConfigureAwait(false);
        if (!gateDecision.Allowed)
        {
            return new OrchestratorTurnResult(
                false, string.Empty, 0, 0, 0m,
                ErrorCode: gateDecision.Outcome.ToString(),
                ErrorMessage: gateDecision.Reason ?? "Provider denied by SaaS provider gate.");
        }

        // 2. Budget guard (fail-closed).
        var withinBudget = await _budget.IsWithinBudgetAsync(request.TenantId, config.MaxUsdPerDay, ct)
            .ConfigureAwait(false);
        if (!withinBudget)
        {
            return new OrchestratorTurnResult(
                false, string.Empty, 0, 0, 0m,
                ErrorCode: "BUDGET_EXCEEDED",
                ErrorMessage: "Orchestrator turn denied: tenant budget exhausted.");
        }

        // 3. Credential resolution (BYOK → platform).
        ProviderCredential credential;
        try
        {
            credential = await _credentials.ResolveAsync(request.TenantId, provider, ct)
                .ConfigureAwait(false);
        }
        catch (TammaError te)
        {
            return new OrchestratorTurnResult(
                false, string.Empty, 0, 0, 0m,
                ErrorCode: te.Code,
                ErrorMessage: te.Message);
        }

        // 4. Execute persistent conversation loop against the per-tenant AuditedToolRegistry.
        var descriptor = ProviderCatalog.HttpProviders.FirstOrDefault(
            p => string.Equals(p.Key, provider, StringComparison.OrdinalIgnoreCase));
        var providerConfig = new LlmProviderConfig
        {
            ApiKey = credential.ApiKey,
            BaseUrl = descriptor?.DefaultBaseUrl ?? string.Empty,
            DefaultModel = model,
            TimeoutSeconds = 120,
        };

        var loopConfig = new ToolLoopConfig
        {
            MaxSteps = config.MaxToolSteps,
            ContextWindowTokens = config.MaxSessionTokens,
            EnableParallelTools = false,
            EnableStreaming = false,
            AllowedTools = request.Tools.Select(t => t.Name).ToArray(),
        };

        var loopResult = await _runner.RunConversationAsync(
            provider,
            providerConfig,
            model,
            request.Messages,
            config.MaxTokensPerDecision,
            config.Temperature,
            request.Tools,
            loopConfig,
            registryOverride: request.Registry,
            correlationId: request.CorrelationId,
            trailContext: request.TrailContext,
            ct: ct).ConfigureAwait(false);

        var costUsd = _pricing.Compute(provider, model, loopResult.InputTokens, loopResult.OutputTokens);

        if (!loopResult.Response.Success)
        {
            _logger.LogWarning(
                "Orchestrator turn failed for tenant={TenantId} correlation={CorrelationId}: {Error}",
                request.TenantId, request.CorrelationId, loopResult.Response.ErrorMessage);
            return new OrchestratorTurnResult(
                false,
                loopResult.Response.ResponseText ?? string.Empty,
                loopResult.InputTokens,
                loopResult.OutputTokens,
                costUsd,
                ErrorCode: "PROVIDER_ERROR",
                ErrorMessage: loopResult.Response.ErrorMessage);
        }

        return new OrchestratorTurnResult(
            true,
            loopResult.Response.ResponseText ?? string.Empty,
            loopResult.InputTokens,
            loopResult.OutputTokens,
            costUsd);
    }
}
