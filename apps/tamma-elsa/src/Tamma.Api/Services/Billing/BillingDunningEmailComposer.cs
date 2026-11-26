using Tamma.Data.Entities;

namespace Tamma.Api.Services.Billing;

/// <summary>
/// Story 35-8 (AC7, AC11) — pure composer for escalating dunning emails and
/// platform-admin dispute notifications. Produces store-and-forward outbox rows
/// ONLY (<see cref="EmailOutboxMessage"/> / <see cref="PlatformEmailOutboxMessage"/>);
/// never invokes any SMTP or HTTP mail transport directly.
/// </summary>
public static class BillingDunningEmailComposer
{
    public const string TemplatePastDue = "dunning-past-due";
    public const string TemplateGrace = "dunning-grace";
    public const string TemplateSuspended = "dunning-suspended";
    public const string TemplateRecovered = "dunning-recovered";
    public const string TemplateDisputeOpened = "dispute-opened";

    public sealed record ComposedEmail(
        string Template,
        string Subject,
        string HtmlBody,
        string TextBody);

    public static ComposedEmail ComposeForStage(
        string stage,
        int attemptCount,
        DateTime? nextRetryUtc,
        long amountDueCents,
        string currency)
    {
        var amountFormatted = $"{amountDueCents / 100.0m:F2} {(currency ?? "usd").ToUpperInvariant()}";
        var retryText = nextRetryUtc.HasValue
            ? $"Next automatic retry is scheduled for {nextRetryUtc.Value:yyyy-MM-dd HH:mm} UTC."
            : "Please update your payment method in the billing portal.";

        return stage switch
        {
            DunningStages.PastDue => new ComposedEmail(
                Template: TemplatePastDue,
                Subject: $"Action required: payment attempt #{attemptCount} failed ({amountFormatted})",
                HtmlBody: $"<p>Payment attempt #{attemptCount} for {amountFormatted} failed.</p><p>{retryText}</p>",
                TextBody: $"Payment attempt #{attemptCount} for {amountFormatted} failed. {retryText}"),

            DunningStages.Grace => new ComposedEmail(
                Template: TemplateGrace,
                Subject: $"Final grace period notice: invoice unpaid after {attemptCount} attempts ({amountFormatted})",
                HtmlBody: $"<p>Your account has entered its final grace period after {attemptCount} failed payment attempts for {amountFormatted}.</p><p>{retryText}</p>",
                TextBody: $"Your account has entered its final grace period after {attemptCount} failed payment attempts for {amountFormatted}. {retryText}"),

            DunningStages.Suspended => new ComposedEmail(
                Template: TemplateSuspended,
                Subject: $"Service suspended: unpaid invoice ({amountFormatted})",
                HtmlBody: $"<p>Platform-provided usage has been suspended after {attemptCount} failed payment attempts for {amountFormatted}.</p><p>Pay your open invoice to reinstate service immediately.</p>",
                TextBody: $"Platform-provided usage has been suspended after {attemptCount} failed payment attempts for {amountFormatted}. Pay your open invoice to reinstate service immediately."),

            DunningStages.Active => new ComposedEmail(
                Template: TemplateRecovered,
                Subject: $"Payment received — account reinstated ({amountFormatted})",
                HtmlBody: $"<p>Thank you! Your payment of {amountFormatted} succeeded and your account is active.</p>",
                TextBody: $"Thank you! Your payment of {amountFormatted} succeeded and your account is active."),

            _ => new ComposedEmail(
                Template: TemplatePastDue,
                Subject: $"Billing notice ({amountFormatted})",
                HtmlBody: $"<p>Billing status update ({stage}) for {amountFormatted}.</p>",
                TextBody: $"Billing status update ({stage}) for {amountFormatted}."),
        };
    }

    public static ComposedEmail ComposeDisputeAdminAlert(
        Guid tenantId,
        string? stripeDisputeId,
        string? stripeInvoiceId,
        string? reason)
    {
        var safeReason = string.IsNullOrWhiteSpace(reason) ? "unspecified" : reason;
        var invPart = string.IsNullOrWhiteSpace(stripeInvoiceId) ? "n/a" : stripeInvoiceId;
        var dispPart = string.IsNullOrWhiteSpace(stripeDisputeId) ? "n/a" : stripeDisputeId;
        return new ComposedEmail(
            Template: TemplateDisputeOpened,
            Subject: $"[Billing Dispute] Tenant {tenantId:D} flagged for operator review",
            HtmlBody: $"<p>A payment dispute ({dispPart}) was opened for tenant <code>{tenantId:D}</code> (invoice <code>{invPart}</code>, reason: {safeReason}). Account flagged for review — not auto-suspended.</p>",
            TextBody: $"A payment dispute ({dispPart}) was opened for tenant {tenantId:D} (invoice {invPart}, reason: {safeReason}). Account flagged for review — not auto-suspended.");
    }

    public static EmailOutboxMessage ToTenantOutboxRow(
        Guid tenantId,
        string toAddress,
        string fromAddress,
        ComposedEmail email,
        DateTime nowUtc) =>
        new()
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            Template = email.Template,
            ToAddress = toAddress,
            FromAddress = fromAddress,
            Subject = email.Subject,
            HtmlBody = email.HtmlBody,
            TextBody = email.TextBody,
            Status = "pending",
            Attempts = 0,
            MaxAttempts = 5,
            NextAttemptAt = nowUtc,
            CreatedAt = nowUtc,
            UpdatedAt = nowUtc,
        };

    public static PlatformEmailOutboxMessage ToPlatformOutboxRow(
        Guid? tenantId,
        string toAddress,
        string fromAddress,
        ComposedEmail email,
        DateTime nowUtc) =>
        new()
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            Template = email.Template,
            ToAddress = toAddress,
            FromAddress = fromAddress,
            Subject = email.Subject,
            HtmlBody = email.HtmlBody,
            TextBody = email.TextBody,
            Status = "pending",
            Attempts = 0,
            MaxAttempts = 5,
            NextAttemptAt = nowUtc,
            CreatedAt = nowUtc,
            UpdatedAt = nowUtc,
        };
}
