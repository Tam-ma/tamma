using Tamma.Api.Services.Billing;
using Tamma.Api.Services.PromptStore;
using Tamma.Data;

namespace Tamma.Api.Endpoints.Billing;

/// <summary>
/// Story 35-8 (AC4, AC13) — tenant-scoped read-only invoice history and detail
/// endpoints under <c>MemberAccess</c>:
/// <list type="bullet">
///   <item><c>GET /api/v1/billing/invoices</c> — paged newest-first invoice list
///     (default 50, max 200).</item>
///   <item><c>GET /api/v1/billing/invoices/{id:guid}</c> — single invoice detail
///     with line items and current dunning summary; foreign/unknown id → 404.</item>
/// </list>
/// In single-user mode both routes short-circuit with a "Billing is SaaS-only"
/// response without touching any billing tables (AC13).
/// </summary>
public static class InvoiceEndpoints
{
    public static IEndpointRouteBuilder MapInvoiceEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/billing/invoices", ListInvoices)
            .RequireAuthorization("MemberAccess");

        app.MapGet("/api/v1/billing/invoices/{id:guid}", GetInvoice)
            .RequireAuthorization("MemberAccess");

        return app;
    }

    internal static async Task<IResult> ListInvoices(
        int? limit,
        int? offset,
        ITammaModeProvider mode,
        ITenantContext tenantContext,
        HttpContext httpContext,
        CancellationToken ct)
    {
        if (mode.Mode != TammaMode.SaaS)
        {
            return Results.NotFound(new
            {
                error = "billing_saas_only",
                message = "Billing is SaaS-only.",
            });
        }

        if (tenantContext.TenantId is not Guid tenantId || tenantId == Guid.Empty)
        {
            return Results.NotFound(new { error = "no_active_tenant" });
        }

        var invoiceService = httpContext.RequestServices.GetService<IInvoiceService>();
        if (invoiceService is null)
        {
            return Results.NotFound(new
            {
                error = "billing_saas_only",
                message = "Billing is SaaS-only.",
            });
        }

        var (items, total) = await invoiceService
            .ListAsync(tenantId, limit ?? 50, offset ?? 0, ct)
            .ConfigureAwait(false);

        return Results.Ok(new
        {
            items = items.Select(i => new
            {
                id = i.Id,
                stripeInvoiceId = i.StripeInvoiceId,
                status = i.Status,
                amountDue = i.AmountDue,
                amountPaid = i.AmountPaid,
                amountRemaining = i.AmountRemaining,
                currency = i.Currency,
                periodStart = i.PeriodStart,
                periodEnd = i.PeriodEnd,
                attemptCount = i.AttemptCount,
                nextPaymentAttempt = i.NextPaymentAttempt,
                isDisputed = i.IsDisputed,
                hostedInvoiceUrl = i.HostedInvoiceUrl,
                pdfUrl = i.PdfUrl,
                createdAt = i.CreatedAt,
                finalizedAt = i.FinalizedAt,
                paidAt = i.PaidAt,
            }),
            total,
        });
    }

    internal static async Task<IResult> GetInvoice(
        Guid id,
        ITammaModeProvider mode,
        ITenantContext tenantContext,
        HttpContext httpContext,
        CancellationToken ct)
    {
        if (mode.Mode != TammaMode.SaaS)
        {
            return Results.NotFound(new
            {
                error = "billing_saas_only",
                message = "Billing is SaaS-only.",
            });
        }

        if (tenantContext.TenantId is not Guid tenantId || tenantId == Guid.Empty)
        {
            return Results.NotFound(new { error = "no_active_tenant" });
        }

        var invoiceService = httpContext.RequestServices.GetService<IInvoiceService>();
        if (invoiceService is null)
        {
            return Results.NotFound(new
            {
                error = "billing_saas_only",
                message = "Billing is SaaS-only.",
            });
        }

        var invoice = await invoiceService.GetAsync(tenantId, id, ct).ConfigureAwait(false);
        if (invoice is null)
        {
            return Results.NotFound(new { error = "invoice_not_found" });
        }

        var dunningService = httpContext.RequestServices.GetService<IDunningStateMachine>();
        var dunning = dunningService is not null
            ? await dunningService.GetStateAsync(tenantId, ct).ConfigureAwait(false)
            : null;

        return Results.Ok(new
        {
            id = invoice.Id,
            stripeInvoiceId = invoice.StripeInvoiceId,
            status = invoice.Status,
            amountDue = invoice.AmountDue,
            amountPaid = invoice.AmountPaid,
            amountRemaining = invoice.AmountRemaining,
            currency = invoice.Currency,
            periodStart = invoice.PeriodStart,
            periodEnd = invoice.PeriodEnd,
            attemptCount = invoice.AttemptCount,
            nextPaymentAttempt = invoice.NextPaymentAttempt,
            isDisputed = invoice.IsDisputed,
            hostedInvoiceUrl = invoice.HostedInvoiceUrl,
            pdfUrl = invoice.PdfUrl,
            createdAt = invoice.CreatedAt,
            finalizedAt = invoice.FinalizedAt,
            paidAt = invoice.PaidAt,
            lines = invoice.Lines.Select(l => new
            {
                id = l.Id,
                kind = l.Kind,
                description = l.Description,
                quantity = l.Quantity,
                unitAmount = l.UnitAmount,
                amount = l.Amount,
                currency = l.Currency,
            }),
            dunning = dunning is null
                ? new { stage = DunningStages.Active, failedAttempts = 0, nextAdvanceAt = (DateTime?)null }
                : new { stage = dunning.Stage, failedAttempts = dunning.FailedAttempts, nextAdvanceAt = dunning.NextAdvanceAt },
        });
    }
}
