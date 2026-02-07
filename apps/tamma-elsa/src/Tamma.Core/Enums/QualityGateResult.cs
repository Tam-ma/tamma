namespace Tamma.Core.Enums;

/// <summary>
/// Types of quality gates in the workflow
/// </summary>
public enum QualityGateType
{
    /// <summary>Unit tests must pass</summary>
    UnitTests,

    /// <summary>Integration tests must pass</summary>
    IntegrationTests,

    /// <summary>Code coverage requirements</summary>
    CodeCoverage,

    /// <summary>Linting and code style checks</summary>
    Linting,

    /// <summary>Static code analysis</summary>
    StaticAnalysis,

    /// <summary>Security vulnerability scanning</summary>
    SecurityScan,

    /// <summary>Build compilation check</summary>
    BuildCompilation,

    /// <summary>Documentation completeness</summary>
    Documentation,

    /// <summary>Performance benchmarks</summary>
    Performance,

    /// <summary>Accessibility requirements</summary>
    Accessibility
}

/// <summary>
/// Severity of quality gate issues
/// </summary>
public enum IssueSeverity
{
    /// <summary>Informational message</summary>
    Info,

    /// <summary>Warning - should be addressed</summary>
    Warning,

    /// <summary>Error - must be fixed</summary>
    Error,

    /// <summary>Critical - blocks progress</summary>
    Critical
}

/// <summary>
/// Overall quality gate status
/// </summary>
public enum QualityGateStatus
{
    /// <summary>All gates passed</summary>
    Passed,

    /// <summary>Passed with warnings</summary>
    PassedWithWarnings,

    /// <summary>Failed - issues must be resolved</summary>
    Failed,

    /// <summary>Skipped - gate not applicable</summary>
    Skipped,

    /// <summary>Error running gate check</summary>
    Error
}
