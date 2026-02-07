namespace Tamma.Core.Enums;

/// <summary>
/// Represents all possible states in the Tamma autonomous mentorship workflow.
/// Based on the 20+ state machine design from UML diagram.
/// </summary>
public enum MentorshipState
{
    // ============================================
    // Initialization States
    // ============================================

    /// <summary>Initial state when a new mentorship session starts</summary>
    INIT_STORY_PROCESSING,

    /// <summary>Validating story requirements and context</summary>
    VALIDATE_STORY,

    // ============================================
    // Assessment States
    // ============================================

    /// <summary>Assessing junior developer's understanding of requirements</summary>
    ASSESS_JUNIOR_CAPABILITY,

    /// <summary>Clarifying requirements when partial understanding detected</summary>
    CLARIFY_REQUIREMENTS,

    /// <summary>Re-explaining story when misunderstanding detected</summary>
    RE_EXPLAIN_STORY,

    // ============================================
    // Planning States
    // ============================================

    /// <summary>Breaking down story into smaller tasks</summary>
    PLAN_DECOMPOSITION,

    /// <summary>Reviewing and approving the implementation plan</summary>
    REVIEW_PLAN,

    /// <summary>Adjusting plan based on feedback</summary>
    ADJUST_PLAN,

    // ============================================
    // Implementation States
    // ============================================

    /// <summary>Junior begins implementation work</summary>
    START_IMPLEMENTATION,

    /// <summary>Actively monitoring junior's progress</summary>
    MONITOR_PROGRESS,

    /// <summary>Providing guidance during implementation</summary>
    PROVIDE_GUIDANCE,

    /// <summary>Detecting patterns in junior's behavior</summary>
    DETECT_PATTERN,

    // ============================================
    // Blocker States
    // ============================================

    /// <summary>Diagnosing what is blocking progress</summary>
    DIAGNOSE_BLOCKER,

    /// <summary>Providing hints to help with blocker</summary>
    PROVIDE_HINT,

    /// <summary>Providing more direct assistance</summary>
    PROVIDE_ASSISTANCE,

    /// <summary>Escalating to senior developer or lead</summary>
    ESCALATE_TO_SENIOR,

    // ============================================
    // Quality States
    // ============================================

    /// <summary>Running quality gate checks (tests, lint, etc.)</summary>
    QUALITY_GATE_CHECK,

    /// <summary>Auto-fixing detected quality issues</summary>
    AUTO_FIX_ISSUES,

    /// <summary>Manual fix required for complex issues</summary>
    MANUAL_FIX_REQUIRED,

    // ============================================
    // Review States
    // ============================================

    /// <summary>Preparing code for review</summary>
    PREPARE_CODE_REVIEW,

    /// <summary>Monitoring code review process</summary>
    MONITOR_REVIEW,

    /// <summary>Guiding fixes based on review feedback</summary>
    GUIDE_FIXES,

    /// <summary>Re-requesting review after fixes</summary>
    RE_REQUEST_REVIEW,

    // ============================================
    // Completion States
    // ============================================

    /// <summary>Merging code and completing mentorship</summary>
    MERGE_AND_COMPLETE,

    /// <summary>Generating session report and analytics</summary>
    GENERATE_REPORT,

    /// <summary>Updating junior's skill profile</summary>
    UPDATE_SKILL_PROFILE,

    /// <summary>Final state - mentorship completed successfully</summary>
    COMPLETED,

    // ============================================
    // Error/Exception States
    // ============================================

    /// <summary>Session paused by user or system</summary>
    PAUSED,

    /// <summary>Session cancelled</summary>
    CANCELLED,

    /// <summary>Session failed due to error</summary>
    FAILED,

    /// <summary>Session timed out</summary>
    TIMEOUT
}
