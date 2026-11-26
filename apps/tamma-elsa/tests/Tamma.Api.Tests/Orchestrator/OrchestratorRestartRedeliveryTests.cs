using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Documents;
using Tamma.Api.Services.Orchestrator;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Channels;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (AC1 / AC7 / D9 / D10) — verifies restart recovery:
/// <list type="bullet">
///   <item>Unacked inbox item is redelivered to a restarted subscriber and acked on completion.</item>
///   <item>Already-answered <c>GateNotFound</c> response from 39-8 acks cleanly without duplicate decision events.</item>
///   <item><see cref="OrchestratorAgentInstance.StartOrRehydrateAsync"/> re-hydrates bootstrap context from the DCB stream and emits <c>ORCHESTRATOR.SESSION.REHYDRATED</c>.</item>
/// </list>
/// </summary>
[TestFixture]
public class OrchestratorRestartRedeliveryTests
{
    [Test]
    public async Task Unacked_inbox_item_is_redelivered_on_restart_and_removed_after_ack()
    {
        var inbox = new InMemoryOrchestratorInbox();
        var tenantId = Guid.NewGuid();
        var itemId = Guid.NewGuid();
        var req = OrchestratorTestHarness.MakeRequest();
        var item = new OrchestratorInboxItem(itemId, tenantId, new AcceptanceRequested(req), DateTimeOffset.UtcNow);

        await inbox.EnqueueAsync(item);

        // First consumer crashes before Ack
        using (var cts1 = new CancellationTokenSource())
        {
            await foreach (var delivered in inbox.SubscribeAsync(tenantId, cts1.Token))
            {
                delivered.ItemId.Should().Be(itemId);
                cts1.Cancel();
                break;
            }
        }

        (await inbox.GetTenantsWithPendingItemsAsync()).Should().Contain(tenantId);

        // Second consumer restarts -> receives the exact unacked item, then acks
        using (var cts2 = new CancellationTokenSource())
        {
            await foreach (var redelivered in inbox.SubscribeAsync(tenantId, cts2.Token))
            {
                redelivered.ItemId.Should().Be(itemId);
                await inbox.AckAsync(tenantId, itemId);
                cts2.Cancel();
                break;
            }
        }

        (await inbox.GetTenantsWithPendingItemsAsync()).Should().NotContain(tenantId);
    }

    [Test]
    public async Task GateNotFound_treats_request_as_already_answered_without_duplicate_decision_event()
    {
        var rig = new OrchestratorTestHarness.Rig(gateNotFound: true);
        var req = OrchestratorTestHarness.MakeRequest(docType: DocumentTypeKey.Findings, autonomyLevel: 100);

        rig.Runner.Enqueue(new ScriptedTurnRunner.ScriptedTurn(
            """{"routing":"decide-self","decision":{"kind":"accept","note":"Done."},"reasoningSummary":"Accepting."}"""));

        var res = await rig.Instance.HandleAcceptanceRequestAsync(req);

        res.AlreadyAnswered.Should().BeTrue();
        rig.EmittedEvents.Should().NotContain(e => e.Type == OrchestratorEvents.DecisionMade,
            "an already-answered gate (GateNotFound) must not emit a duplicate ORCHESTRATOR.DECISION.MADE event");
    }

    [Test]
    public async Task StartOrRehydrateAsync_populates_BootstrapContext_and_emits_SESSION_REHYDRATED_when_history_exists()
    {
        var rig = new OrchestratorTestHarness.Rig();
        rig.Events.Setup(e => e.QueryEventsAsync(
                rig.TenantId, "ORCHESTRATOR.", true,
                null, null, null, null, null, It.IsAny<int>(), false))
            .ReturnsAsync((new List<DomainEvent>
            {
                new()
                {
                    Type = OrchestratorEvents.DecisionMade,
                    TenantId = rig.TenantId,
                    SequenceNumber = 7,
                    Data = """{"kind":"acceptance","routing":"decide-self"}""",
                    CreatedAt = DateTime.UtcNow.AddMinutes(-5),
                },
            }, (int?)1));

        await rig.Instance.StartOrRehydrateAsync();

        rig.Instance.Session.BootstrapContext.Should().NotBeNullOrWhiteSpace();
        rig.Instance.Session.BootstrapContext.Should().Contain(OrchestratorEvents.DecisionMade);
        rig.EmittedEvents.Should().ContainSingle(e => e.Type == OrchestratorEvents.SessionRehydrated);
    }
}
