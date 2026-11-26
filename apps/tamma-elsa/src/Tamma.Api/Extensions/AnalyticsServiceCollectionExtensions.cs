using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Tamma.Api.Services.Analytics;

namespace Tamma.Api.Extensions;

/// <summary>
/// Story 36-7 — DI registrations for the cost-basis vs margin analytics read view.
/// </summary>
public static class AnalyticsServiceCollectionExtensions
{
    /// <summary>
    /// Registers <see cref="IMarginAnalyticsService"/> (scoped) for tenant-scope
    /// and platform-aggregate margin reads.
    /// </summary>
    public static IServiceCollection AddMarginAnalytics(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddScoped<IMarginAnalyticsService, MarginAnalyticsService>();
        return services;
    }
}
