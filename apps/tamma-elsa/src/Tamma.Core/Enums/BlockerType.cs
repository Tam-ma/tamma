namespace Tamma.Core.Enums;

/// <summary>
/// Types of blockers that can occur during mentorship
/// </summary>
public enum BlockerType
{
    /// <summary>Junior doesn't understand what to build</summary>
    REQUIREMENTS_UNCLEAR,

    /// <summary>Junior lacks technical knowledge needed</summary>
    TECHNICAL_KNOWLEDGE_GAP,

    /// <summary>Environment or tooling issues</summary>
    ENVIRONMENT_ISSUE,

    /// <summary>Dependency or integration issues</summary>
    DEPENDENCY_ISSUE,

    /// <summary>Design or architecture confusion</summary>
    ARCHITECTURE_CONFUSION,

    /// <summary>Testing or debugging challenges</summary>
    TESTING_CHALLENGE,

    /// <summary>Code review feedback unclear</summary>
    REVIEW_FEEDBACK_UNCLEAR,

    /// <summary>Performance or optimization issues</summary>
    PERFORMANCE_ISSUE,

    /// <summary>Security concerns or vulnerabilities</summary>
    SECURITY_CONCERN,

    /// <summary>External blocker (waiting on others)</summary>
    EXTERNAL_DEPENDENCY,

    /// <summary>Personal or availability issues</summary>
    AVAILABILITY_ISSUE,

    /// <summary>Motivation or confidence issues</summary>
    MOTIVATION_ISSUE,

    /// <summary>Communication breakdown</summary>
    COMMUNICATION_ISSUE,

    /// <summary>Unknown or unclassified blocker</summary>
    UNKNOWN
}
