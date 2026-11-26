namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-8 (AC12) — configuration-driven failed-payment dunning retry
/// cadence and grace window, bound from <c>Billing:Dunning</c>.
/// </summary>
public sealed class DunningOptions
{
    public const string SectionName = "Billing:Dunning";

    /// <summary>
    /// Retry delays (hours) before escalating to <c>grace</c>.
    /// Default <c>[24, 72, 120]</c> (1 day, 3 days, 5 days).
    /// </summary>
    public int[] RetryDelaysHours { get; set; } = [24, 72, 120];

    /// <summary>
    /// Grace window duration (hours) after retries are exhausted before
    /// transitioning <c>grace → suspended</c>. Default <c>168</c> (7 days).
    /// </summary>
    public int GraceHours { get; set; } = 168;

    /// <summary>Platform admin notification email for <c>dispute-opened</c> outbox rows.</summary>
    public string AdminNotificationEmail { get; set; } = "billing-alerts@tamma.dev";

    /// <summary>Sender address stamped on dunning and dispute outbox rows.</summary>
    public string FromAddress { get; set; } = "billing@tamma.dev";
}
