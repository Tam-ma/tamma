using Tamma.Api.Services.Agents;

namespace Tamma.Core.Tracking;

/// <summary>
/// Story 44-7 AC7/AC8 (D6/D7) — per-project autonomous-loop intake &amp; status
/// write-back gate on <c>projects."AutomationMode"</c>.
///
/// <list type="bullet">
///   <item><c>off</c> (default) — neither autonomous intake nor status write-back.</item>
///   <item><c>assist</c> — native intake selects <c>ready</c> items, status write-back stays off.</item>
///   <item><c>auto</c> — native intake selects <c>ready</c> items AND idempotent status write-back is enabled.</item>
/// </list>
/// </summary>
public enum ProjectAutomationMode
{
    [Wire("off")] Off,
    [Wire("assist")] Assist,
    [Wire("auto")] Auto,
}

public static class ProjectAutomationModeExtensions
{
    public static string ToWire(this ProjectAutomationMode mode) =>
        EnumWire<ProjectAutomationMode>.ToWire(mode);

    public static bool TryParse(string wire, out ProjectAutomationMode mode) =>
        EnumWire<ProjectAutomationMode>.TryParse(wire, out mode);

    public static ProjectAutomationMode Parse(string input)
    {
        if (!string.IsNullOrWhiteSpace(input) && EnumWire<ProjectAutomationMode>.TryParse(input, out var mode))
            return mode;

        throw new TammaError(
            "TRACKER.UNKNOWN_AUTOMATION_MODE",
            $"Unknown project automation mode: '{input}'. Valid modes: " +
            $"{string.Join(", ", Enum.GetValues<ProjectAutomationMode>().Select(m => m.ToWire()))}.",
            new Dictionary<string, object?> { ["input"] = input },
            retryable: false,
            severity: TammaErrorSeverity.Medium);
    }

    public static bool AllowsIntake(this ProjectAutomationMode mode) =>
        mode is ProjectAutomationMode.Assist or ProjectAutomationMode.Auto;

    public static bool AllowsStatusWriteBack(this ProjectAutomationMode mode) =>
        mode == ProjectAutomationMode.Auto;
}
