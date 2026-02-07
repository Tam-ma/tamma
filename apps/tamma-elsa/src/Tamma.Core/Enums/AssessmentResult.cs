namespace Tamma.Core.Enums;

/// <summary>
/// Status of junior capability assessment
/// </summary>
public enum AssessmentStatus
{
    /// <summary>Junior correctly understands requirements</summary>
    Correct,

    /// <summary>Junior has partial understanding</summary>
    Partial,

    /// <summary>Junior misunderstood requirements</summary>
    Incorrect,

    /// <summary>Assessment timed out (no response)</summary>
    Timeout,

    /// <summary>Assessment could not be completed</summary>
    Error
}

/// <summary>
/// Confidence level in assessment results
/// </summary>
public enum ConfidenceLevel
{
    /// <summary>Very low confidence in assessment</summary>
    VeryLow = 1,

    /// <summary>Low confidence</summary>
    Low = 2,

    /// <summary>Medium confidence</summary>
    Medium = 3,

    /// <summary>High confidence</summary>
    High = 4,

    /// <summary>Very high confidence in assessment</summary>
    VeryHigh = 5
}
