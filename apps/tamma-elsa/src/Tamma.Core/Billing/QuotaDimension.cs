namespace Tamma.Core.Billing;

/// <summary>
/// Story 35-6 — quota dimensions enforced across the SaaS control plane.
/// BYOK tenants are exempt from <see cref="PlatformTokens"/> volume limits but
/// remain subject to <see cref="Seats"/>, <see cref="ConcurrentWorkflows"/>,
/// and <see cref="ConnectedRepos"/>.
/// </summary>
public enum QuotaDimension
{
    PlatformTokens,
    ConcurrentWorkflows,
    Seats,
    ConnectedRepos,
}

public static class QuotaDimensionExtensions
{
    /// <summary>Canonical wire name used in API responses, dedup rows, and DCB tags.</summary>
    public static string ToWire(this QuotaDimension dimension) => dimension switch
    {
        QuotaDimension.PlatformTokens => "platform_tokens",
        QuotaDimension.ConcurrentWorkflows => "concurrent_workflows",
        QuotaDimension.Seats => "seats",
        QuotaDimension.ConnectedRepos => "connected_repos",
        _ => throw new ArgumentOutOfRangeException(nameof(dimension), dimension, null),
    };
}
