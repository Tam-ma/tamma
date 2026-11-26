namespace Tamma.Api.Services.Pricing;

/// <summary>
/// Story 34-10 (AC10) — platform-event type constants for the idempotent
/// pricing backfill. All constants match the 3-segment
/// <c>AGGREGATE.ACTION.STATUS</c> naming ratchet.
/// </summary>
public static class PricingBackfillEventTypes
{
    public const string Started = "PRICING.BACKFILL.STARTED";
    public const string Completed = "PRICING.BACKFILL.COMPLETED";
    public const string Skipped = "PRICING.BACKFILL.SKIPPED";
}
