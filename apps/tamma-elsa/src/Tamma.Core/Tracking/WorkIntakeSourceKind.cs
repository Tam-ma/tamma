using System.Text.Json;
using System.Text.Json.Serialization;
using Tamma.Api.Services.Agents;

namespace Tamma.Core.Tracking;

/// <summary>
/// Story 44-7 AC5 (D5) — closed, ordinal two-member vocabulary distinguishing
/// platform-issue candidates from native tracker work-item candidates inside
/// <c>WorkItem.Source</c> and <c>WorkItemJson</c>.
/// </summary>
[JsonConverter(typeof(WorkIntakeSourceKindJsonConverter))]
public enum WorkIntakeSourceKind
{
    [Wire("platform-issue")] PlatformIssue,
    [Wire("tracker")] Tracker,
}

public static class WorkIntakeSourceKindExtensions
{
    public static string ToWire(this WorkIntakeSourceKind kind) =>
        EnumWire<WorkIntakeSourceKind>.ToWire(kind);

    public static bool TryParse(string wire, out WorkIntakeSourceKind kind) =>
        EnumWire<WorkIntakeSourceKind>.TryParse(wire, out kind);

    public static WorkIntakeSourceKind Parse(string input)
    {
        if (!string.IsNullOrWhiteSpace(input) && EnumWire<WorkIntakeSourceKind>.TryParse(input, out var kind))
            return kind;

        throw new TammaError(
            "TRACKER.UNKNOWN_INTAKE_SOURCE",
            $"Unknown work intake source: '{input}'. Accepted sources: " +
            $"{string.Join(", ", Enum.GetValues<WorkIntakeSourceKind>().Select(k => k.ToWire()))}.",
            new Dictionary<string, object?> { ["input"] = input },
            retryable: false,
            severity: TammaErrorSeverity.High);
    }
}

public sealed class WorkIntakeSourceKindJsonConverter : JsonConverter<WorkIntakeSourceKind>
{
    public override WorkIntakeSourceKind Read(
        ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String)
            throw new JsonException($"WorkIntakeSourceKind must be a string wire token, got {reader.TokenType}.");
        var wire = reader.GetString() ?? string.Empty;
        if (!WorkIntakeSourceKindExtensions.TryParse(wire, out var kind))
        {
            throw new JsonException(
                $"Unknown WorkIntakeSourceKind wire value '{wire}'. Accepted: " +
                string.Join(", ", Enum.GetValues<WorkIntakeSourceKind>().Select(k => k.ToWire())));
        }
        return kind;
    }

    public override void Write(
        Utf8JsonWriter writer, WorkIntakeSourceKind value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToWire());
}
