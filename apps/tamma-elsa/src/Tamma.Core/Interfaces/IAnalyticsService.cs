using Tamma.Core.Enums;

namespace Tamma.Core.Interfaces;

/// <summary>
/// Service for analytics and metrics tracking
/// </summary>
public interface IAnalyticsService
{
    /// <summary>Record a metric for a session</summary>
    Task RecordMetricAsync(Guid sessionId, string metricName, double value, string? unit = null);

    /// <summary>Record a metric for a junior developer</summary>
    Task RecordJuniorMetricAsync(string juniorId, string metricName, double value, string? unit = null);

    /// <summary>Get metrics for a session</summary>
    Task<List<MetricRecord>> GetSessionMetricsAsync(Guid sessionId);

    /// <summary>Get metrics for a junior developer</summary>
    Task<List<MetricRecord>> GetJuniorMetricsAsync(string juniorId, DateTime? from = null, DateTime? to = null);

    /// <summary>Get aggregated analytics for a time period</summary>
    Task<AggregatedAnalytics> GetAggregatedAnalyticsAsync(DateTime from, DateTime to);

    /// <summary>Get state transition analytics</summary>
    Task<StateTransitionAnalytics> GetStateTransitionAnalyticsAsync(DateTime from, DateTime to);

    /// <summary>Get blocker analytics</summary>
    Task<BlockerAnalytics> GetBlockerAnalyticsAsync(DateTime from, DateTime to);

    /// <summary>Get junior developer performance report</summary>
    Task<JuniorPerformanceReport> GetJuniorPerformanceReportAsync(string juniorId);

    /// <summary>Detect patterns in junior behavior</summary>
    Task<List<BehaviorPattern>> DetectPatternsAsync(string juniorId);

    /// <summary>Calculate skill level recommendation</summary>
    Task<SkillLevelRecommendation> CalculateSkillLevelAsync(string juniorId);
}

// ============================================
// Analytics Models
// ============================================

public class MetricRecord
{
    public Guid Id { get; set; }
    public Guid? SessionId { get; set; }
    public string? JuniorId { get; set; }
    public string MetricName { get; set; } = string.Empty;
    public double Value { get; set; }
    public string? Unit { get; set; }
    public DateTime RecordedAt { get; set; }
}

public class AggregatedAnalytics
{
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public int TotalSessions { get; set; }
    public int CompletedSessions { get; set; }
    public int FailedSessions { get; set; }
    public double AverageCompletionTimeHours { get; set; }
    public double SuccessRate { get; set; }
    public Dictionary<string, double> AverageMetrics { get; set; } = new();
    public Dictionary<MentorshipState, TimeSpan> AverageTimePerState { get; set; } = new();
}

public class StateTransitionAnalytics
{
    public Dictionary<string, int> TransitionCounts { get; set; } = new();
    public Dictionary<string, TimeSpan> AverageTransitionTimes { get; set; } = new();
    public List<string> MostCommonPaths { get; set; } = new();
    public List<string> BottleneckStates { get; set; } = new();
}

public class BlockerAnalytics
{
    public int TotalBlockers { get; set; }
    public Dictionary<BlockerType, int> BlockersByType { get; set; } = new();
    public Dictionary<BlockerType, TimeSpan> AverageResolutionTime { get; set; } = new();
    public double BlockerResolutionRate { get; set; }
    public List<CommonBlocker> MostCommonBlockers { get; set; } = new();
}

public class CommonBlocker
{
    public BlockerType Type { get; set; }
    public string Description { get; set; } = string.Empty;
    public int Occurrences { get; set; }
    public TimeSpan AverageResolutionTime { get; set; }
    public string? SuggestedResolution { get; set; }
}

public class JuniorPerformanceReport
{
    public string JuniorId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int CurrentSkillLevel { get; set; }
    public int TotalSessions { get; set; }
    public int SuccessfulSessions { get; set; }
    public double SuccessRate { get; set; }
    public double AverageCompletionTimeHours { get; set; }
    public Dictionary<string, double> SkillAreaScores { get; set; } = new();
    public List<string> Strengths { get; set; } = new();
    public List<string> AreasForImprovement { get; set; } = new();
    public List<BehaviorPattern> DetectedPatterns { get; set; } = new();
    public PerformanceTrend Trend { get; set; } = new();
}

public class PerformanceTrend
{
    public string Direction { get; set; } = "stable"; // improving, stable, declining
    public double ChangePercentage { get; set; }
    public List<TrendDataPoint> DataPoints { get; set; } = new();
}

public class TrendDataPoint
{
    public DateTime Date { get; set; }
    public double Value { get; set; }
}

public class BehaviorPattern
{
    public string PatternId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public PatternType Type { get; set; }
    public double Confidence { get; set; }
    public int Occurrences { get; set; }
    public string? Recommendation { get; set; }
}

public enum PatternType
{
    Positive,
    Neutral,
    Concerning
}

public class SkillLevelRecommendation
{
    public string JuniorId { get; set; } = string.Empty;
    public int CurrentLevel { get; set; }
    public int RecommendedLevel { get; set; }
    public double Confidence { get; set; }
    public List<string> Justification { get; set; } = new();
    public List<string> SkillGaps { get; set; } = new();
    public List<string> RecommendedLearning { get; set; } = new();
}
