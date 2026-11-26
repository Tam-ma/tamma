using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using NUnit.Framework;
using Stripe;
using Tamma.Api.Services.Billing;
using Tamma.Api.Services.Billing.Handlers;
using TammaInvoiceService = Tamma.Api.Services.Billing.InvoiceService;
using Tamma.Core.Billing;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Billing;

/// <summary>
/// Story 35-8 (AC3, AC8, AC9, AC11, AC14) — verifies the Story 35-5 webhook
/// handler wiring (<see cref="InvoiceWebhookHandler"/> &amp;
/// <see cref="DisputeWebhookHandler"/>) and the Story 35-6
/// <see cref="QuotaService"/> suspension hard-block seam (including BYOK
/// token exemption and instant lift on reinstatement).
/// </summary>
[TestFixture]
public class InvoiceWebhookAndSuspensionTests
{
    private static readonly DateTime FixedNow = new(2026, 6, 15, 12, 0, 0, DateTimeKind.Utc);

    private ControlPlaneDbContext _cp = null!;
    private StubTimeProvider _clock = null!;
    private List<DomainEvent> _emitted = null!;
    private Mock<IEventRepository> _events = null!;
    private Mock<IPlatformQueuedTaskRepository> _tasks = null!;
    private QuotaService _quotaService = null!;
    private TammaInvoiceService _invoiceService = null!;
    private DunningStateMachine _dunning = null!;
    private InvoiceWebhookHandler _invoiceHandler = null!;
    private DisputeWebhookHandler _disputeHandler = null!;

    [SetUp]
    public void SetUp()
    {
        var opts = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"inv-webhook-susp-{Guid.NewGuid():N}")
            .Options;
        _cp = new ControlPlaneDbContext(opts);
        _clock = new StubTimeProvider(new DateTimeOffset(FixedNow, TimeSpan.Zero));
        _emitted = [];
        _events = new Mock<IEventRepository>();
        _events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(e => _emitted.Add(e))
            .ReturnsAsync((DomainEvent e) => e);
        _tasks = new Mock<IPlatformQueuedTaskRepository>();
        _tasks.Setup(t => t.EnqueueAsync(It.IsAny<PlatformQueuedTask>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((PlatformQueuedTask t, CancellationToken _) => t);
        _tasks.Setup(t => t.DeadLetterAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var cache = new QuotaCache();
        var resolver = new QuotaResolver(
            _cp, cache, Options.Create(new QuotaOptions()), _clock, Mock.Of<ILogger<QuotaResolver>>());
        var notifier = new QuotaNotifier(_cp, _events.Object, _clock, Mock.Of<ILogger<QuotaNotifier>>());
        _quotaService = new QuotaService(_cp, resolver, notifier, _clock, Mock.Of<ILogger<QuotaService>>());

        _invoiceService = new TammaInvoiceService(_cp, _events.Object, _clock, Mock.Of<ILogger<TammaInvoiceService>>());
        _dunning = new DunningStateMachine(
            _cp,
            _tasks.Object,
            _events.Object,
            Options.Create(new DunningOptions { RetryDelaysHours = [1], GraceHours = 2 }),
            _clock,
            Mock.Of<ILogger<DunningStateMachine>>(),
            _quotaService);

        _invoiceHandler = new InvoiceWebhookHandler(_events.Object, _invoiceService, _dunning);
        _disputeHandler = new DisputeWebhookHandler(_events.Object, _dunning);
    }

    [TearDown]
    public void TearDown() => _cp?.Dispose();

    [Test]
    public async Task PaymentFailed_To_Suspended_HardBlocks_Platform_Allows_Byok_And_InvoicePaid_Reinstates()
    {
        var tenantId = Guid.NewGuid();
        _cp.Tenants.Add(new Tenant { Id = tenantId, Name = "TeamCo", Slug = "teamco", Plan = "team" });
        _cp.Plans.Add(new Tamma.Data.Entities.Plan
        {
            Id = Guid.NewGuid(),
            Slug = "team",
            DisplayName = "Team",
            Version = 1,
            Status = "active",
            Quotas = """{"llmTokensPerMonth":5000000,"overageBehavior":"allow_with_overage"}""",
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        await _cp.SaveChangesAsync();

        // 1. Feed invoice.payment_failed through InvoiceWebhookHandler (attempt 1 -> past_due)
        var stripeInv = new Invoice
        {
            Id = "in_susp_1",
            Status = "open",
            AmountDue = 2900,
            AmountRemaining = 2900,
            Currency = "usd",
            AttemptCount = 1,
            Created = FixedNow,
            PeriodStart = FixedNow.AddDays(-30),
            PeriodEnd = FixedNow,
        };
        var failCtx = new BillingWebhookContext(
            new Event { Id = "evt_fail_1", Type = BillingWebhookEventTypes.InvoicePaymentFailed, Data = new EventData { Object = stripeInv } },
            tenantId,
            BillingWebhookEventTypes.InvoicePaymentFailed,
            "evt_fail_1",
            stripeInv.Id,
            "{}");

        var followup = await _invoiceHandler.HandleAsync(failCtx, CancellationToken.None);
        followup.Should().NotBeNull();
        followup!.Subtype.Should().Be(DunningAdvanceTaskHandler.TaskTypeName);

        // 2. Advance past retry (1h -> grace) and grace (2h -> suspended)
        _clock.Advance(TimeSpan.FromHours(1));
        (await _dunning.AdvanceAsync(tenantId))!.Stage.Should().Be(DunningStages.Grace);
        _clock.Advance(TimeSpan.FromHours(2));
        (await _dunning.AdvanceAsync(tenantId))!.Stage.Should().Be(DunningStages.Suspended);

        // 3. AC8 + AC9: QuotaService hard-blocks platform-provided calls with reason="billing_suspended",
        //    while BYOK token calls remain ALLOWED!
        var platformDecision = await _quotaService.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform);
        platformDecision.Allowed.Should().BeFalse();
        platformDecision.HttpStatus.Should().Be(StatusCodes.Status402PaymentRequired);
        platformDecision.Reason.Should().Be("billing_suspended");

        var byokDecision = await _quotaService.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Byok);
        byokDecision.Allowed.Should().BeTrue("BYOK token volume stays exempt even when suspended");

        // 4. Feed invoice.paid through InvoiceWebhookHandler -> reinstates & lifts hard-block immediately!
        stripeInv.Status = "paid";
        stripeInv.AmountPaid = 2900;
        stripeInv.AmountRemaining = 0;
        var paidCtx = new BillingWebhookContext(
            new Event { Id = "evt_paid_1", Type = BillingWebhookEventTypes.InvoicePaid, Data = new EventData { Object = stripeInv } },
            tenantId,
            BillingWebhookEventTypes.InvoicePaid,
            "evt_paid_1",
            stripeInv.Id,
            "{}");

        await _invoiceHandler.HandleAsync(paidCtx, CancellationToken.None);

        var afterReinstatement = await _quotaService.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform);
        afterReinstatement.Allowed.Should().BeTrue("reinstatement lifts the billing_suspended hard-block immediately");
        _emitted.Should().Contain(e => e.Type == BillingInvoiceEvents.TenantReinstated && e.TenantId == tenantId);
    }

    [Test]
    public async Task DisputeWebhookHandler_Flags_Tenant_And_Never_Blocks_Quota()
    {
        var tenantId = Guid.NewGuid();
        _cp.Tenants.Add(new Tenant { Id = tenantId, Name = "DispCo", Slug = "dispco", Plan = "team" });
        await _cp.SaveChangesAsync();

        var dispute = new Dispute
        {
            Id = "dp_999",
            Reason = "duplicate",
            Metadata = new Dictionary<string, string> { ["stripeInvoiceId"] = "in_disp_999" },
        };
        var ctx = new BillingWebhookContext(
            new Event { Id = "evt_dp_1", Type = BillingWebhookEventTypes.ChargeDisputeCreated, Data = new EventData { Object = dispute } },
            tenantId,
            BillingWebhookEventTypes.ChargeDisputeCreated,
            "evt_dp_1",
            "dp_999",
            "{}");

        var followup = await _disputeHandler.HandleAsync(ctx, CancellationToken.None);
        followup.Should().NotBeNull();

        var state = await _dunning.GetStateAsync(tenantId);
        state!.Stage.Should().Be(DunningStages.Flagged);

        // Flagged is NOT suspended — platform calls continue while operator reviews
        var decision = await _quotaService.CheckTokenQuotaAsync(tenantId, BillingModeTokens.Platform);
        decision.Allowed.Should().BeTrue();
    }
}
