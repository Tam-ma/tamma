using Microsoft.Extensions.DependencyInjection.Extensions;
using Tamma.Api.Services.Billing;
using Tamma.Api.Services.PlatformTasks;
using Tamma.Api.Services.PromptStore;

namespace Tamma.Api.Extensions;

/// <summary>
/// Story 35-3 (AC12) — mode-gated DI registration for BYOK-aware usage metering,
/// Stripe meter-event batch flushing, and hourly Stripe reconciliation.
///
/// <para>Wired ONLY when <see cref="ITammaModeProvider.Mode"/> is
/// <see cref="TammaMode.SaaS"/>. In single-user mode NO flush or reconciliation
/// handlers and NO metering services are registered, and
/// <c>GET /api/v1/billing/usage</c> is unmapped (zero Stripe coupling).</para>
/// </summary>
public static class BillingUsageServiceCollectionExtensions
{
    public static IServiceCollection AddBillingUsageMetering(
        this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddOptions<BillingUsageOptions>()
            .Configure(opts =>
                configuration.GetSection(BillingUsageOptions.SectionName).Bind(opts));

        var mode = ResolveMode(services, configuration);
        if (mode != TammaMode.SaaS)
        {
            // AC12 — single-user registers no flush/reconcile handlers and no
            // metering services (zero Stripe calls).
            return services;
        }

        services.TryAddSingleton<TimeProvider>(TimeProvider.System);
        services.TryAddScoped<IUsageMeteringService, UsageMeteringService>();
        services.AddPlatformTaskHandler<MeterEventFlushTaskHandler>();
        services.AddPlatformTaskHandler<UsageReconciliationTaskHandler>();

        return services;
    }

    private static TammaMode ResolveMode(
        IServiceCollection services, IConfiguration configuration)
    {
        var registered = services
            .FirstOrDefault(d => d.ServiceType == typeof(ITammaModeProvider))?
            .ImplementationInstance as ITammaModeProvider;
        return registered?.Mode ?? TammaModeProvider.Resolve(configuration);
    }
}
