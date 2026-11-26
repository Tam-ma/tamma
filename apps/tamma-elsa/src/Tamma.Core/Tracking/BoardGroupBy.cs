using Tamma.Api.Services.Agents;

namespace Tamma.Core.Tracking;

/// <summary>
/// Story 44-4 AC6 / D5 — the closed vocabulary for
/// <c>GET /api/projects/{projectId}/board?groupBy=…</c>. A free-text column name
/// would be both a SQL-injection surface and an unbounded query shape; this enum
/// maps via an exhaustive switch onto fixed SQL column expressions.
/// </summary>
public enum BoardGroupBy
{
    [Wire("status")] Status,
    [Wire("assignee")] Assignee,
    [Wire("kind")] Kind,
    [Wire("priority")] Priority,
    [Wire("iteration")] Iteration,
}

public static class BoardGroupByExtensions
{
    /// <summary>The canonical wire string for <paramref name="groupBy"/>.</summary>
    public static string ToWire(this BoardGroupBy groupBy) => EnumWire<BoardGroupBy>.ToWire(groupBy);

    /// <summary>Case-sensitive (ordinal) lookup of the member for <paramref name="wire"/>.</summary>
    public static bool TryParse(string? wire, out BoardGroupBy groupBy)
    {
        if (string.IsNullOrWhiteSpace(wire))
        {
            groupBy = default;
            return false;
        }
        return EnumWire<BoardGroupBy>.TryParse(wire, out groupBy);
    }

    /// <summary>
    /// Resolve a wire string to a <see cref="BoardGroupBy"/> (case-sensitive, ordinal).
    /// </summary>
    /// <exception cref="TammaError">
    /// Code <c>TRACKER.UNKNOWN_GROUP_BY</c> naming the accepted set.
    /// </exception>
    public static BoardGroupBy Parse(string? input)
    {
        if (TryParse(input, out var groupBy))
            return groupBy;

        throw new TammaError(
            "TRACKER.UNKNOWN_GROUP_BY",
            $"Unknown board groupBy: '{input}'. Valid values: "
            + $"{string.Join(", ", Enum.GetValues<BoardGroupBy>().Select(g => g.ToWire()))}.",
            new Dictionary<string, object?> { ["input"] = input },
            retryable: false,
            severity: TammaErrorSeverity.Low);
    }
}
