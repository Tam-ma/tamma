using Microsoft.Extensions.DependencyInjection.Extensions;
using Tamma.Api.Services.Billing;
using Tamma.Api.Services.PromptStore;

namespace Tamma.Api.Extensions;

/// <summary>
/// Story 35-6 (AC10) — mode-aware DI registration for plan quota enforcement.
/// In SaaS mode wires <see cref="QuotaService"/> (backed by CP/tenant rollups +
/// singleton <see cref="QuotaCache"/>); in single-user mode wires
/// <see cref="NullQuotaService"/> (every check Allowed, zero DB/Stripe calls).
/// </summary>
public static class QuotaServiceCollectionExtensions
{
    public static IServiceCollection AddTammaQuota(
        this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddOptions<QuotaOptions>()
            .Configure(opts =>
                configuration.GetSection(QuotaOptions.SectionName).Bind(opts));

        services.TryAddSingleton<TimeProvider>(TimeProvider.System);
        services.TryAddSingleton<QuotaCache>();

        var mode = ResolveMode(services, configuration);
        if (mode == TammaMode.SaaS)
        {
            services.TryAddScoped<QuotaResolver>();
            services.TryAddScoped<QuotaNotifier>();
            services.AddScoped<IQuotaService, QuotaService>();
        }
        else
        {
            services.AddSingleton<IQuotaService, NullQuotaService>();
        }

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
