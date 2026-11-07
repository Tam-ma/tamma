using System.Globalization;
using System.Text.RegularExpressions;

namespace Tamma.Activities.AgentDispatch;

/// <summary>
/// The per-task agent session id, <c>adl-{issueNumber}-task-{taskIndex}</c>. It is the key the
/// <c>AGENT_RUN.*</c> rows are correlated by and that 40-4's re-entry joins on, so it must stay
/// stable: changing the format orphans every row already written.
/// </summary>
public static partial class TaskSessionId
{
    public static string For(int issueNumber, int taskIndex)
        => string.Create(CultureInfo.InvariantCulture, $"adl-{issueNumber}-task-{taskIndex}");

    /// <summary>Parse a session id; <c>false</c> for anything not in the exact format.</summary>
    public static bool TryParse(string? sessionId, out int issueNumber, out int taskIndex)
    {
        issueNumber = 0;
        taskIndex = 0;
        if (string.IsNullOrEmpty(sessionId)) return false;
        var m = Pattern().Match(sessionId);
        return m.Success
            && int.TryParse(m.Groups[1].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture, out issueNumber)
            && int.TryParse(m.Groups[2].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture, out taskIndex);
    }

    [GeneratedRegex(@"^adl-(\d{1,9})-task-(\d{1,9})$", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
