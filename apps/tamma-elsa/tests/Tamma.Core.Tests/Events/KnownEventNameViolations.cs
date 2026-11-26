namespace Tamma.Core.Tests.Events;

/// <summary>
/// Story 44-5 AC8/AC9 (D9) — shrink-only, count-pinned allowlist of
/// pre-existing DCB event-type constants that do not yet match the canonical
/// <c>AGGREGATE[.SUB].ACTION.STATUS</c> shape (<c>^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*){2,3}$</c>).
///
/// <para><b>Shrink-only discipline:</b> entries may ONLY be removed as legacy
/// families are migrated. A stale entry (now compliant or deleted) fails
/// <see cref="EventTypeNamingRatchetTests"/> until deleted here, and no
/// Epic 44 family (<c>PROJECT.</c>/<c>WORKITEM.</c>/<c>ITERATION.</c>) may
/// ever appear in this table (AC9 self-defeat guard).</para>
/// </summary>
internal static class KnownEventNameViolations
{
    internal sealed record Entry(string FilePath, int Line, string ConstantName, string Value);

    public const int PinnedCount = 87;

    public static readonly IReadOnlyList<Entry> All =
    [
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/CycleEvents.cs", 50, "Started", "CYCLE.STARTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/CycleEvents.cs", 51, "StepFailed", "CYCLE.STEP_FAILED"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/CycleEvents.cs", 52, "Completed", "CYCLE.COMPLETED"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/CycleEvents.cs", 53, "Failed", "CYCLE.FAILED"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/CycleEvents.cs", 54, "Ended", "CYCLE.ENDED"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/MergeApprovalEvents.cs", 57, "GatePrefix", "APPROVAL.GATE"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/MergeApprovalEvents.cs", 63, "Escalated", "MERGE_APPROVAL.ESCALATED"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/MergeApprovalEvents.cs", 64, "MergeRequested", "MERGE.REQUESTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/MergeApprovalEvents.cs", 65, "MergeFailed", "MERGE.FAILED"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/MergeApprovalEvents.cs", 66, "TestRequested", "MERGE_APPROVAL.TEST_REQUESTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/MergeEvents.cs", 44, "Success", "MERGE.SUCCESS"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/MergeEvents.cs", 45, "Failed", "MERGE.FAILED"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/PlanApprovalEvents.cs", 39, "Requested", "PLAN_APPROVAL.REQUESTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/ADL/ReviewFixEvents.cs", 58, "Escalated", "REVIEW_FIX.ESCALATED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Adr/AdrEvents.cs", 22, "Started", "ADR.STARTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Adr/AdrEvents.cs", 23, "Drafted", "ADR.DRAFTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Adr/AdrEvents.cs", 24, "Accepted", "ADR.ACCEPTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Adr/AdrEvents.cs", 27, "Failed", "ADR.FAILED"),
        new("apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/AgentRunWaitEventTypes.cs", 24, "WaitSuspended", "AGENT_RUN.WAIT_SUSPENDED"),
        new("apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/AgentRunWaitEventTypes.cs", 27, "Received", "AGENT_RUN.RECEIVED"),
        new("apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/AgentRunWaitEventTypes.cs", 30, "TimedOut", "AGENT_RUN.TIMED_OUT"),
        new("apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/AgentRunWaitEventTypes.cs", 33, "ResumeUnresolved", "AGENT_RUN.RESUME_UNRESOLVED"),
        new("apps/tamma-elsa/src/Tamma.Activities/AgentDispatch/AgentRunWaitEventTypes.cs", 36, "TaskReentered", "AGENT_RUN.TASK_REENTERED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Ambiguity/AmbiguityEvents.cs", 44, "Started", "AMBIGUITY.STARTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Ambiguity/AmbiguityEvents.cs", 45, "Scored", "AMBIGUITY.SCORED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Ambiguity/AmbiguityEvents.cs", 49, "ClarificationTriggered", "AMBIGUITY.CLARIFICATION_TRIGGERED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Ambiguity/AmbiguityEvents.cs", 50, "BelowThreshold", "AMBIGUITY.BELOW_THRESHOLD"),
        new("apps/tamma-elsa/src/Tamma.Activities/Ambiguity/AmbiguityEvents.cs", 54, "Failed", "AMBIGUITY.FAILED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Blocker/BlockerEvents.cs", 60, "ResolutionAttempted", "BLOCKER.RESOLUTION_ATTEMPTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Blocker/BlockerEvents.cs", 61, "ProgressDetected", "BLOCKER.PROGRESS_DETECTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Blocker/BlockerEvents.cs", 62, "ProgressTimedOut", "BLOCKER.PROGRESS_TIMED_OUT"),
        new("apps/tamma-elsa/src/Tamma.Activities/Blocker/BlockerEvents.cs", 63, "Escalated", "BLOCKER.ESCALATED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Blocker/BlockerEvents.cs", 64, "Resolved", "BLOCKER.RESOLVED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Blocker/BlockerEvents.cs", 65, "TimedOut", "BLOCKER.TIMED_OUT"),
        new("apps/tamma-elsa/src/Tamma.Activities/Decomposition/DecompositionEvents.cs", 41, "Started", "DECOMPOSITION.STARTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Decomposition/DecompositionEvents.cs", 42, "ContextGathered", "DECOMPOSITION.CONTEXT_GATHERED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Decomposition/DecompositionEvents.cs", 43, "Completed", "DECOMPOSITION.COMPLETED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Decomposition/DecompositionEvents.cs", 47, "Failed", "DECOMPOSITION.FAILED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/AcceptanceCriteriaEvents.cs", 30, "Started", "ACCEPTANCE_CRITERIA.STARTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/AcceptanceCriteriaEvents.cs", 31, "Drafted", "ACCEPTANCE_CRITERIA.DRAFTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/AcceptanceCriteriaEvents.cs", 32, "Accepted", "ACCEPTANCE_CRITERIA.ACCEPTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/AcceptanceCriteriaEvents.cs", 35, "Failed", "ACCEPTANCE_CRITERIA.FAILED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/ApprovalEvents.cs", 51, "Requested", "APPROVAL.REQUESTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/ApprovalEvents.cs", 52, "Provided", "APPROVAL.PROVIDED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/ApprovalEvents.cs", 55, "EscalationTriggered", "ESCALATION.TRIGGERED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/ApprovalEvents.cs", 56, "EscalationResolved", "ESCALATION.RESOLVED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/ChannelEvents.cs", 19, "GuidanceRequested", "GUIDANCE.REQUESTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/ChannelEvents.cs", 22, "GuidanceProvided", "GUIDANCE.PROVIDED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/DocumentEvents.cs", 32, "ReviewRequested", "DOCUMENT.REVIEW_REQUESTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/DocumentEvents.cs", 33, "Reviewed", "DOCUMENT.REVIEWED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/DocumentEvents.cs", 34, "RevisionStarted", "DOCUMENT.REVISION_STARTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/DocumentEvents.cs", 35, "Accepted", "DOCUMENT.ACCEPTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/DocumentEvents.cs", 39, "Rejected", "DOCUMENT.REJECTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/DocumentEvents.cs", 40, "Escalated", "DOCUMENT.ESCALATED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/DocumentEvents.cs", 45, "ReviewPanelStarted", "DOCUMENT.REVIEW_PANEL_STARTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/DocumentEvents.cs", 46, "ReviewPanelCompleted", "DOCUMENT.REVIEW_PANEL_COMPLETED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/DocumentEvents.cs", 47, "ReviewPanelUndecidable", "DOCUMENT.REVIEW_PANEL_UNDECIDABLE"),
        new("apps/tamma-elsa/src/Tamma.Activities/Documents/DocumentEvents.cs", 53, "Reentered", "DOCUMENT.REENTERED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Research/ResearchEvents.cs", 44, "Started", "RESEARCH.STARTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Research/ResearchEvents.cs", 45, "ContextGathered", "RESEARCH.CONTEXT_GATHERED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Research/ResearchEvents.cs", 46, "Completed", "RESEARCH.COMPLETED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Research/ResearchEvents.cs", 50, "Failed", "RESEARCH.FAILED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Review/CodeReviewEvents.cs", 68, "Escalated", "CODE_REVIEW.ESCALATED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Review/CodeReviewEvents.cs", 71, "EscalationResolved", "CODE_REVIEW.ESCALATION_RESOLVED"),
        new("apps/tamma-elsa/src/Tamma.Activities/Review/CodeReviewEvents.cs", 73, "Failed", "CODE_REVIEW.FAILED"),
        new("apps/tamma-elsa/src/Tamma.Activities/TenantLifecycle/TenantLifecycleEvents.cs", 40, "ProvisioningRequested", "TENANT.PROVISIONING_REQUESTED"),
        new("apps/tamma-elsa/src/Tamma.Activities/TenantLifecycle/TenantLifecycleEvents.cs", 95, "DeleteCancelled", "TENANT.DELETE_CANCELLED"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Agents/AgentTrailEventTypes.cs", 53, "TaskPrefix", "AGENT.TASK"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Audit/AuditQueryEventTypes.cs", 17, "Queried", "AUDIT.QUERIED"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 12, "SubscriptionCreated", "customer.subscription.created"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 13, "SubscriptionUpdated", "customer.subscription.updated"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 14, "SubscriptionDeleted", "customer.subscription.deleted"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 15, "SubscriptionTrialWillEnd", "customer.subscription.trial_will_end"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 17, "InvoiceCreated", "invoice.created"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 18, "InvoiceFinalized", "invoice.finalized"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 19, "InvoicePaid", "invoice.paid"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 20, "InvoicePaymentFailed", "invoice.payment_failed"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 22, "PaymentIntentSucceeded", "payment_intent.succeeded"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 23, "PaymentIntentPaymentFailed", "payment_intent.payment_failed"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 25, "ChargeDisputeCreated", "charge.dispute.created"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Billing/BillingWebhookEventTypes.cs", 48, "FollowupTaskType", "billing.webhook.followup"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Pricing/EntitlementEventTypes.cs", 27, "TenantPlanChangedPrefix", "TENANT.PLAN."),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Pricing/EntitlementEventTypes.cs", 35, "PlanCatalogPrefix", "PLAN."),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Pricing/PlanAssignmentEventTypes.cs", 26, "LegacyPlanUpdated", "PLAN.UPDATED"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Pricing/PlanCatalogEventTypes.cs", 16, "Deprecated", "PLAN.DEPRECATED"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Providers/ProviderPricingEventTypes.cs", 14, "Registered", "PROVIDER.REGISTERED"),
        new("apps/tamma-elsa/src/Tamma.Api/Services/Providers/ProviderPricingEventTypes.cs", 17, "StatusChanged", "PROVIDER.STATUS_CHANGED"),
    ];
}
