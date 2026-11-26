namespace Tamma.Data.Entities;

/// <summary>
/// Story 35-3 — control-plane outbox/buffer row for a pending Stripe Billing
/// Meter event. Only <c>billing_mode = platform</c> token usage (and seat
/// gauges) are written here; BYOK token usage is explicitly excluded.
///
/// <para>A deterministic unique <see cref="IdempotencyKey"/> guarantees retries
/// after a partial flush or Stripe transient failure never double-bill. Flushed
/// in bounded batches by <c>MeterEventFlushTaskHandler</c>.</para>
/// </summary>
public class BillingMeterEventBuffer
{
    /// <summary>Stable surrogate PK (server default <c>gen_random_uuid()</c>).</summary>
    public Guid Id { get; set; }

    /// <summary>Owning tenant — FK to <c>tenants.Id</c> (cascade on tenant purge).</summary>
    public Guid TenantId { get; set; }

    /// <summary>Target Stripe customer id (<c>cus_...</c>).</summary>
    public string StripeCustomerId { get; set; } = null!;

    /// <summary>Stripe meter event name (e.g. <c>tamma.platform_tokens_input</c>).</summary>
    public string EventName { get; set; } = null!;

    /// <summary>
    /// Canonical billing-mode wire token (<c>platform</c> | <c>byok</c>), pinned
    /// by a CHECK constraint. Token meter rows are always <c>platform</c>.
    /// </summary>
    public string BillingMode { get; set; } = "platform";

    /// <summary>Whole-number string value per Stripe Billing Meters API.</summary>
    public string Value { get; set; } = "0";

    /// <summary>
    /// Deterministic idempotency key (also passed as Stripe meter-event
    /// <c>Identifier</c> and <c>RequestOptions.IdempotencyKey</c>). Unique index
    /// prevents duplicate buffering on replay.
    /// </summary>
    public string IdempotencyKey { get; set; } = null!;

    /// <summary>UTC billing-period start this buffered usage belongs to.</summary>
    public DateTime PeriodStart { get; set; }

    /// <summary>UTC timestamp stamped on the Stripe meter event.</summary>
    public DateTime EventTimestamp { get; set; }

    /// <summary>True once Stripe has acknowledged the meter event.</summary>
    public bool ReportedToStripe { get; set; }

    /// <summary>Stripe meter-event identifier echoed back on acknowledgement.</summary>
    public string? StripeEventId { get; set; }

    /// <summary>UTC creation timestamp.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>UTC timestamp of the most recent flush attempt (null until tried).</summary>
    public DateTime? LastAttemptAt { get; set; }

    /// <summary>Number of flush attempts made for this row.</summary>
    public int AttemptCount { get; set; }

    /// <summary>Last sanitized error summary if a flush failed (never holds secrets).</summary>
    public string? LastError { get; set; }

    /// <summary>Navigation to the owning tenant.</summary>
    public Tenant? Tenant { get; set; }
}
