using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Billing;
using Tamma.Data;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Billing;

/// <summary>
/// Story 35-8 (AC5–AC12, AC14) — unit tests for <see cref="DunningStateMachine"/>,
/// <see cref="DunningAdvanceTaskHandler"/>, and <see cref="BillingDunningEmailComposer"/>:
/// pure transition table, custom config cadence, outbox-only email enqueue
/// (zero direct transport calls), grace-to-suspended progression, recovery from
/// every stage including <c>suspended</c>, quota invalidation, and dispute flagging.
/// </summary>
[TestFixture]
public class DunningStateMachineTests
{
    private static readonly DateTime FixedNow = new(2026, 6, 15, 12, 0, 0, DateTimeKind.Utc);

    private ControlPlaneDbContext _cp = null!;
    private List<PlatformQueuedTask> _enqueuedTasks = null!;
    private List<(Guid Id, string Reason)> _cancelledTasks = null!;
    private Mock<IPlatformQueuedTaskRepository> _taskRepo = null!;
    private List<DomainEvent> _emitted = null!;
    private Mock<IEventRepository> _events = null!;
    private Mock<IQuotaService> _quota = null!;
    private StubTimeProvider _clock = null!;
    private DunningOptions _opts = null!;
    private DunningStateMachine _sut = null!;

    [SetUp]
    public void SetUp()
    {
        var dbOpts = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"dunning-sm-{Guid.NewGuid():N}")
            .Options;
        _cp = new ControlPlaneDbContext(dbOpts);

        _enqueuedTasks = [];
        _cancelledTasks = [];
        _taskRepo = new Mock<IPlatformQueuedTaskRepository>();
        _taskRepo.Setup(r => r.EnqueueAsync(It.IsAny<PlatformQueuedTask>(), It.IsAny<CancellationToken>()))
            .Callback<PlatformQueuedTask, CancellationToken>((t, _) => _enqueuedTasks.Add(t))
            .ReturnsAsync((PlatformQueuedTask t, CancellationToken _) => t);
        _taskRepo.Setup(r => r.DeadLetterAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<Guid, string, CancellationToken>((id, reason, _) => _cancelledTasks.Add((id, reason)))
            .Returns(Task.CompletedTask);

        _emitted = [];
        _events = new Mock<IEventRepository>();
        _events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(e => _emitted.Add(e))
            .ReturnsAsync((DomainEvent e) => e);

        _quota = new Mock<IQuotaService>();
        _clock = new StubTimeProvider(new DateTimeOffset(FixedNow, TimeSpan.Zero));
        _opts = new DunningOptions
        {
            RetryDelaysHours = [24, 72, 120],
            GraceHours = 168,
            AdminNotificationEmail = "ops@tamma.dev",
            FromAddress = "billing@tamma.dev",
        };

        _sut = new DunningStateMachine(
            _cp,
            _taskRepo.Object,
            _events.Object,
            Options.Create(_opts),
            _clock,
            Mock.Of<ILogger<DunningStateMachine>>(),
            _quota.Object);
    }

    [TearDown]
    public void TearDown() => _cp?.Dispose();

    private async Task<(Guid TenantId, BillingInvoice Invoice)> SeedTenantAndInvoiceAsync(int attemptCount = 1)
    {
        var tenantId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        _cp.Tenants.Add(new Tenant { Id = tenantId, Name = "Acme", Slug = $"acme-{tenantId:N}"[..16] });
        _cp.Users.Add(new User
        {
            Id = userId,
            Email = $"owner-{tenantId:N}@acme.test",
            DisplayName = "Owner",
            TenantId = tenantId,
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        });
        _cp.TenantMemberships.Add(new TenantMembership
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            UserId = userId,
            Role = "owner",
            JoinedAt = FixedNow,
        });
        var invoice = new BillingInvoice
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            StripeInvoiceId = $"in_{tenantId:N}"[..16],
            Status = "open",
            AmountDue = 4900,
            AmountRemaining = 4900,
            Currency = "usd",
            AttemptCount = attemptCount,
            PeriodStart = FixedNow.AddDays(-30),
            PeriodEnd = FixedNow,
            CreatedAt = FixedNow,
            UpdatedAt = FixedNow,
        };
        _cp.BillingInvoices.Add(invoice);
        await _cp.SaveChangesAsync();
        return (tenantId, invoice);
    }

    [Test]
    public void Next_Honors_ConfigDriven_RetryDelays_And_GraceHours()
    {
        var custom = new DunningOptions { RetryDelaysHours = [12, 48], GraceHours = 96 };

        _sut.Next(DunningStages.Active, 1, custom)
            .Should().Be(new DunningTransition(DunningStages.PastDue, TimeSpan.FromHours(12), false));

        _sut.Next(DunningStages.PastDue, 2, custom)
            .Should().Be(new DunningTransition(DunningStages.PastDue, TimeSpan.FromHours(48), false));

        _sut.Next(DunningStages.PastDue, 3, custom)
            .Should().Be(new DunningTransition(DunningStages.Grace, TimeSpan.FromHours(96), false));

        _sut.Next(DunningStages.Grace, 4, custom)
            .Should().Be(new DunningTransition(DunningStages.Suspended, null, true));

        _sut.Next(DunningStages.Suspended, 5, custom)
            .Should().Be(new DunningTransition(DunningStages.Suspended, null, true));
    }

    [Test]
    public async Task Full_Lifecycle_Advances_Active_To_PastDue_To_Grace_To_Suspended_And_Recovers()
    {
        var (tenantId, invoice) = await SeedTenantAndInvoiceAsync(attemptCount: 1);

        // Attempt 1: active -> past_due (+24h)
        var s1 = await _sut.OnPaymentFailedAsync(tenantId, invoice);
        s1.Stage.Should().Be(DunningStages.PastDue);
        s1.FailedAttempts.Should().Be(1);
        s1.NextAdvanceAt.Should().Be(FixedNow.AddHours(24));
        _enqueuedTasks.Should().ContainSingle(t => t.Type == DunningAdvanceTaskHandler.TaskTypeName && t.VisibleAt == FixedNow.AddHours(24));
        _emitted.Should().Contain(e => e.Type == BillingInvoiceEvents.PaymentFailed && e.TenantId == tenantId);
        _emitted.Should().Contain(e => e.Type == BillingInvoiceEvents.DunningEscalated && e.TenantId == tenantId);

        // Replay of exact same attempt 1 is idempotent (no double-advance)
        var s1Replay = await _sut.OnPaymentFailedAsync(tenantId, invoice);
        s1Replay.FailedAttempts.Should().Be(1);
        _enqueuedTasks.Should().HaveCount(1);

        // Advance through retries 2 (+72h), 3 (+120h), then grace (+168h) -> suspended
        _clock.Advance(TimeSpan.FromHours(24));
        var s2 = await _sut.AdvanceAsync(tenantId);
        s2!.Stage.Should().Be(DunningStages.PastDue);
        s2.FailedAttempts.Should().Be(2);
        s2.NextAdvanceAt.Should().Be(_clock.GetUtcNow().UtcDateTime.AddHours(72));

        _clock.Advance(TimeSpan.FromHours(72));
        var s3 = await _sut.AdvanceAsync(tenantId);
        s3!.Stage.Should().Be(DunningStages.PastDue);
        s3.FailedAttempts.Should().Be(3);

        _clock.Advance(TimeSpan.FromHours(120));
        var sGrace = await _sut.AdvanceAsync(tenantId);
        sGrace!.Stage.Should().Be(DunningStages.Grace);
        sGrace.NextAdvanceAt.Should().Be(_clock.GetUtcNow().UtcDateTime.AddHours(168));
        sGrace.SuspendedAt.Should().BeNull();

        // Calling AdvanceAsync BEFORE GraceHours elapses is a safe no-op
        _clock.Advance(TimeSpan.FromHours(100));
        var stillGrace = await _sut.AdvanceAsync(tenantId);
        stillGrace!.Stage.Should().Be(DunningStages.Grace);

        // Exactly at GraceHours -> suspended!
        _clock.Advance(TimeSpan.FromHours(68));
        var handler = new DunningAdvanceTaskHandler(_sut, Mock.Of<ILogger<DunningAdvanceTaskHandler>>());
        await handler.HandleAsync(new PlatformQueuedTask { Id = Guid.NewGuid(), Type = DunningAdvanceTaskHandler.TaskTypeName, TenantId = tenantId }, CancellationToken.None);

        var suspended = await _cp.BillingDunningStates.SingleAsync(d => d.TenantId == tenantId);
        suspended.Stage.Should().Be(DunningStages.Suspended);
        suspended.SuspendedAt.Should().NotBeNull();
        _emitted.Should().ContainSingle(e => e.Type == BillingInvoiceEvents.TenantSuspended && e.TenantId == tenantId);
        _quota.Verify(q => q.Invalidate(tenantId), Times.Once);

        // Outbox-only emails were queued for past_due, grace, and suspended
        var outboxTemplates = await _cp.PlatformEmailOutbox
            .Where(m => m.TenantId == tenantId)
            .Select(m => m.Template)
            .ToListAsync();
        outboxTemplates.Should().Contain(BillingDunningEmailComposer.TemplatePastDue);
        outboxTemplates.Should().Contain(BillingDunningEmailComposer.TemplateGrace);
        outboxTemplates.Should().Contain(BillingDunningEmailComposer.TemplateSuspended);

        // Now recover from suspended on invoice.paid!
        invoice.Status = "paid";
        invoice.AmountPaid = 4900;
        invoice.AmountRemaining = 0;
        var recovered = await _sut.OnPaymentRecoveredAsync(tenantId, invoice);

        recovered.Stage.Should().Be(DunningStages.Active);
        recovered.FailedAttempts.Should().Be(0);
        recovered.SuspendedAt.Should().BeNull();
        _quota.Verify(q => q.Invalidate(tenantId), Times.Exactly(2));
        _emitted.Should().ContainSingle(e => e.Type == BillingInvoiceEvents.TenantReinstated && e.TenantId == tenantId);
        (await _cp.PlatformEmailOutbox.AnyAsync(m => m.Template == BillingDunningEmailComposer.TemplateRecovered)).Should().BeTrue();
    }

    [Test]
    public async Task OnPaymentRecoveredAsync_From_PastDue_Cancels_Pending_AdvanceTask()
    {
        var (tenantId, invoice) = await SeedTenantAndInvoiceAsync(attemptCount: 1);

        var pastDue = await _sut.OnPaymentFailedAsync(tenantId, invoice);
        var scheduledId = pastDue.PendingAdvanceTaskId;
        scheduledId.Should().NotBeNull();

        var active = await _sut.OnPaymentRecoveredAsync(tenantId, invoice);

        active.Stage.Should().Be(DunningStages.Active);
        active.PendingAdvanceTaskId.Should().BeNull();
        _cancelledTasks.Should().Contain(c => c.Id == scheduledId!.Value && c.Reason == "recovered_by_payment");
        _emitted.Should().ContainSingle(e => e.Type == BillingInvoiceEvents.TenantReinstated);
    }

    [Test]
    public async Task OnDisputeCreatedAsync_Flags_Tenant_And_Notifies_Admin_Without_AutoSuspending()
    {
        var (tenantId, invoice) = await SeedTenantAndInvoiceAsync(attemptCount: 0);

        var flagged = await _sut.OnDisputeCreatedAsync(tenantId, "dp_123", invoice.StripeInvoiceId, "fraudulent");

        flagged.Stage.Should().Be(DunningStages.Flagged, "disputes never auto-suspend");
        flagged.SuspendedAt.Should().BeNull();

        var updatedInvoice = await _cp.BillingInvoices.SingleAsync(i => i.Id == invoice.Id);
        updatedInvoice.IsDisputed.Should().BeTrue();

        _emitted.Should().ContainSingle(e => e.Type == BillingInvoiceEvents.InvoiceDisputed && e.TenantId == tenantId);
        _emitted.Should().NotContain(e => e.Type == BillingInvoiceEvents.TenantSuspended);

        var adminMail = await _cp.PlatformEmailOutbox.SingleAsync(m => m.Template == BillingDunningEmailComposer.TemplateDisputeOpened);
        adminMail.ToAddress.Should().Be("ops@tamma.dev");
        adminMail.TenantId.Should().Be(tenantId);
        adminMail.Status.Should().Be("pending");
    }
}
