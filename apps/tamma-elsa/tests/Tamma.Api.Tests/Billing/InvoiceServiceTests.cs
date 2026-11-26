using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using NUnit.Framework;
using Stripe;
using Tamma.Api.Services.Billing;
using TammaInvoiceService = Tamma.Api.Services.Billing.InvoiceService;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Billing;

/// <summary>
/// Story 35-8 (AC1, AC2, AC4, AC10, AC14) — unit tests for
/// <see cref="InvoiceService"/>: Stripe invoice projection, idempotent upsert
/// on replay, pure line-item classification (<c>base</c> / <c>metered_overage</c>
/// / <c>credit</c>), status transitions + DCB emission, paging, and tenant isolation.
/// </summary>
[TestFixture]
public class InvoiceServiceTests
{
    private static readonly DateTime FixedNow = new(2026, 6, 15, 12, 0, 0, DateTimeKind.Utc);

    private ControlPlaneDbContext _cp = null!;
    private List<DomainEvent> _emitted = null!;
    private Mock<IEventRepository> _events = null!;
    private StubTimeProvider _clock = null!;
    private TammaInvoiceService _sut = null!;

    [SetUp]
    public void SetUp()
    {
        var opts = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"invoice-svc-{Guid.NewGuid():N}")
            .Options;
        _cp = new ControlPlaneDbContext(opts);
        _emitted = [];
        _events = new Mock<IEventRepository>();
        _events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(e => _emitted.Add(e))
            .ReturnsAsync((DomainEvent e) => e);
        _clock = new StubTimeProvider(new DateTimeOffset(FixedNow, TimeSpan.Zero));
        _sut = new TammaInvoiceService(_cp, _events.Object, _clock, Mock.Of<ILogger<TammaInvoiceService>>());
    }

    [TearDown]
    public void TearDown() => _cp?.Dispose();

    [Test]
    public void ClassifyLine_Categorizes_Base_MeteredOverage_And_Credit_With_NegativeWinning()
    {
        // Negative amount ALWAYS wins as credit, even on a base price id.
        var creditOnBase = new InvoiceLineItem
        {
            Amount = -500,
            Description = "Proration credit",
            Pricing = new InvoiceLineItemPricing
            {
                PriceDetails = new InvoiceLineItemPricingPriceDetails
                {
                    Price = new Price { Id = "price_team_base" },
                },
            },
        };
        TammaInvoiceService.ClassifyLine(creditOnBase).Should().Be(TammaInvoiceService.LineKindCredit);

        // Metered via Stripe Price.Recurring.UsageType == "metered"
        var meteredRecurring = new InvoiceLineItem
        {
            Amount = 1250,
            Description = "Platform tokens overage",
            Pricing = new InvoiceLineItemPricing
            {
                PriceDetails = new InvoiceLineItemPricingPriceDetails
                {
                    Price = new Price
                    {
                        Id = "price_tokens_in",
                        Recurring = new PriceRecurring { UsageType = "metered" },
                    },
                },
            },
        };
        TammaInvoiceService.ClassifyLine(meteredRecurring).Should().Be(TammaInvoiceService.LineKindMeteredOverage);

        // Metered via Story 35-3 metadata tamma_meter=true
        var meteredMeta = new InvoiceLineItem
        {
            Amount = 400,
            Description = "Metered usage",
            Metadata = new Dictionary<string, string> { ["tamma_meter"] = "true" },
        };
        TammaInvoiceService.ClassifyLine(meteredMeta).Should().Be(TammaInvoiceService.LineKindMeteredOverage);

        // Regular base recurring subscription line
        var baseLine = new InvoiceLineItem
        {
            Amount = 2900,
            Description = "Team plan (5 seats)",
            Pricing = new InvoiceLineItemPricing
            {
                PriceDetails = new InvoiceLineItemPricingPriceDetails
                {
                    Price = new Price
                    {
                        Id = "price_team_seat",
                        Recurring = new PriceRecurring { UsageType = "licensed" },
                    },
                },
            },
        };
        TammaInvoiceService.ClassifyLine(baseLine).Should().Be(TammaInvoiceService.LineKindBase);
    }

    [Test]
    public async Task ProjectAsync_Projects_Mixed_Lines_Reconciles_Totals_And_Is_Idempotent_On_Replay()
    {
        var tenantId = Guid.NewGuid();
        var stripeInvoice = new Invoice
        {
            Id = "in_mix_001",
            Status = "open",
            AmountDue = 3650,
            AmountPaid = 0,
            AmountRemaining = 3650,
            Currency = "usd",
            HostedInvoiceUrl = "https://invoice.stripe.com/i/acct_1/in_mix_001",
            InvoicePdf = "https://pay.stripe.com/invoice/acct_1/in_mix_001/pdf",
            PeriodStart = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
            PeriodEnd = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc),
            AttemptCount = 0,
            Created = FixedNow,
            StatusTransitions = new InvoiceStatusTransitions { FinalizedAt = FixedNow },
            Lines = new StripeList<InvoiceLineItem>
            {
                Data =
                [
                    new InvoiceLineItem { Description = "Team Base", Quantity = 1, Amount = 2900, Currency = "usd" },
                    new InvoiceLineItem
                    {
                        Description = "Token Overage",
                        Quantity = 10,
                        Amount = 1250,
                        Currency = "usd",
                        Metadata = new Dictionary<string, string> { ["tamma_meter"] = "true" },
                    },
                    new InvoiceLineItem { Description = "Promo credit", Quantity = 1, Amount = -500, Currency = "usd" },
                ],
            },
        };

        var first = await _sut.ProjectAsync(stripeInvoice, tenantId);
        var replay = await _sut.ProjectAsync(stripeInvoice, tenantId);

        first.Id.Should().Be(replay.Id, "upsert keyed on StripeInvoiceId reuses the same row");
        (await _cp.BillingInvoices.CountAsync()).Should().Be(1);
        first.Lines.Should().HaveCount(3);
        first.Lines.Sum(l => l.Amount).Should().Be(first.AmountDue);
        first.Lines.Select(l => l.Kind).Should().BeEquivalentTo(["base", "metered_overage", "credit"]);

        // Finalized DCB emitted exactly once despite replay
        _emitted.Should().ContainSingle(e => e.Type == BillingInvoiceEvents.InvoiceFinalized && e.TenantId == tenantId);

        // Now transition open -> paid
        stripeInvoice.Status = "paid";
        stripeInvoice.AmountPaid = 3650;
        stripeInvoice.AmountRemaining = 0;
        stripeInvoice.StatusTransitions = new InvoiceStatusTransitions
        {
            FinalizedAt = FixedNow,
            PaidAt = FixedNow.AddHours(1),
        };

        var paid = await _sut.ProjectAsync(stripeInvoice, tenantId);
        var paidReplay = await _sut.ProjectAsync(stripeInvoice, tenantId);

        paid.Status.Should().Be("paid");
        paid.PaidAt.Should().Be(FixedNow.AddHours(1));
        paidReplay.Id.Should().Be(paid.Id);
        _emitted.Should().ContainSingle(e => e.Type == BillingInvoiceEvents.InvoicePaid && e.TenantId == tenantId);
    }

    [Test]
    public async Task ListAsync_And_GetAsync_Enforce_Tenant_Isolation_And_NewestFirst_Paging()
    {
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        var invA1 = await _sut.ProjectAsync(new Invoice
        {
            Id = "in_a1", Status = "paid", AmountDue = 1000, AmountPaid = 1000, Created = FixedNow.AddDays(-2),
        }, tenantA);
        var invA2 = await _sut.ProjectAsync(new Invoice
        {
            Id = "in_a2", Status = "open", AmountDue = 2000, AmountRemaining = 2000, Created = FixedNow.AddDays(-1),
        }, tenantA);
        var invB1 = await _sut.ProjectAsync(new Invoice
        {
            Id = "in_b1", Status = "paid", AmountDue = 3000, AmountPaid = 3000, Created = FixedNow,
        }, tenantB);

        var (itemsA, totalA) = await _sut.ListAsync(tenantA, limit: 1, offset: 0);
        totalA.Should().Be(2);
        itemsA.Should().ContainSingle().Which.Id.Should().Be(invA2.Id, "newest first");

        (await _sut.GetAsync(tenantA, invA1.Id)).Should().NotBeNull();
        (await _sut.GetAsync(tenantA, invB1.Id)).Should().BeNull("cross-tenant reads return null");
        (await _sut.GetAsync(tenantB, invA2.Id)).Should().BeNull();
    }
}
