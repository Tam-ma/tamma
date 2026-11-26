using Tamma.Core.Documents.Policy;

namespace Tamma.Core.Actions;

/// <summary>
/// Story 43-18 (AC4, AC8) — pure guard-rail validator for platform-scope action
/// level overrides (<c>action_level_overrides</c>) and stranded-override checks.
///
/// <list type="number">
///   <item><b>Unknown key</b> → 404.</item>
///   <item><b>Machinery key</b> → 400 naming the classification (machinery takes no dial level).</item>
///   <item><b>Non-enforceable key</b> → 400 (informational only).</item>
///   <item><b>Detent values only</b> → multiple of 5 in <c>[5, 100]</c>, or
///     <see cref="AutonomyDial.AlwaysHuman"/> (101).</item>
///   <item><b>The 50-line consequence floor</b> → an action whose shipped level is
///     <c>&gt;= 50</c> may NOT be overridden below 50 (delete-family, merges, deploys,
///     secrets, external comms stay inside the consequential band). Actions shipped
///     below 50 may move anywhere in the legal detent range.</item>
/// </list>
/// </summary>
public static class ActionLevelOverrideValidator
{
    /// <summary>Actions shipped at or above this level cannot be lowered below it (43-18 §6.1).</summary>
    public const int ConsequenceFloor = 50;

    /// <summary>Minimum legal detent value (multiples of 5 in [5, 100] plus AlwaysHuman 101).</summary>
    public const int MinDetent = 5;

    /// <summary>Step between legal detents.</summary>
    public const int DetentStep = 5;

    public const string CodeUnknownAction = "ACTION_LEVEL.UNKNOWN_ACTION";
    public const string CodeMissingField = "ACTION_POLICY.MISSING_FIELD";
    public const string CodeMachinery = "ACTION_POLICY.MACHINERY_NOT_DIAL_GOVERNED";
    public const string CodeNotEnforceable = "ACTION_POLICY.NOT_ENFORCEABLE";
    public const string CodeNonDetent = "ACTION_LEVEL.NON_DETENT";
    public const string CodeBelowFloor = "ACTION_LEVEL.BELOW_CONSEQUENCE_FLOOR";
    public const string CodeStrandedOverride = "ACTION.CATALOG.STRANDED_LEVEL_OVERRIDE";

    /// <summary>Validation failure carrying the HTTP status, machine code, and diagnostic text.</summary>
    public sealed record ValidationFailure(int StatusCode, string Code, string Error);

    /// <summary>One stranded override row discovered at startup or during a drift sweep (AC8).</summary>
    public sealed record StrandedOverrideViolation(string ActionKey, string Code, string Detail);

    /// <summary>
    /// TRUE iff <paramref name="level"/> is a legal detent: a multiple of 5 in
    /// <c>[5, 100]</c>, or <see cref="AutonomyDial.AlwaysHuman"/> (101).
    /// </summary>
    public static bool IsValidDetent(int level) =>
        level == AutonomyDial.AlwaysHuman
        || (level >= MinDetent && level <= AutonomyDial.Max && level % DetentStep == 0);

    /// <summary>
    /// Validate a platform-level override write (<c>PUT /api/admin/actions/levels/{ns}/{key}</c>).
    /// Returns <c>null</c> when legal, or a <see cref="ValidationFailure"/> describing the
    /// exact status code and guard rail that refused it.
    /// </summary>
    public static ValidationFailure? ValidateWrite(
        string ns,
        string key,
        int? level,
        IShippedLevelResolver? shippedLevels,
        out ActionDescriptor? descriptor)
    {
        descriptor = null;
        if (!ActionKey.TryParse($"{ns}:{key}", out var actionKey)
            || !ActionCatalog.TryGet(actionKey, out descriptor)
            || descriptor is null)
        {
            return new ValidationFailure(
                404,
                CodeUnknownAction,
                $"'{ns}:{key}' is not a catalogued action.");
        }

        if (level is not int targetLevel)
        {
            return new ValidationFailure(
                400,
                CodeMissingField,
                "Body field 'level' is required (single-field write; a missing field is never defaulted).");
        }

        if (descriptor.IsMachinery)
        {
            return new ValidationFailure(
                400,
                CodeMachinery,
                $"'{descriptor.Key.ToWire()}' is classified as machinery (Story 43-13): "
                + "deterministic services and plumbing take no dial level and may not be overridden.");
        }

        if (!descriptor.Enforceable)
        {
            return new ValidationFailure(
                400,
                CodeNotEnforceable,
                $"'{descriptor.Key.ToWire()}' is not enforceable (informational only) and takes no level override.");
        }

        if (!IsValidDetent(targetLevel))
        {
            return new ValidationFailure(
                400,
                CodeNonDetent,
                $"level {targetLevel} is not a valid detent: must be a multiple of {DetentStep} in "
                + $"[{MinDetent}, {AutonomyDial.Max}] or AlwaysHuman ({AutonomyDial.AlwaysHuman}).");
        }

        var resolver = shippedLevels ?? CatalogDefaultShippedLevelResolver.Instance;
        var shipped = resolver.ShippedDefault(descriptor.Key);
        if (shipped >= ConsequenceFloor && targetLevel < ConsequenceFloor)
        {
            return new ValidationFailure(
                400,
                CodeBelowFloor,
                $"'{descriptor.Key.ToWire()}' ships at level {shipped} (>= {ConsequenceFloor}, "
                + $"consequence floor rule) and may not be overridden below {ConsequenceFloor} "
                + $"(requested {targetLevel}).");
        }

        return null;
    }

    /// <summary>
    /// Story 43-18 AC8 — verify every persisted override row references a live,
    /// catalogued, non-machinery action key. Any stranded row (retired/renamed key
    /// or reclassified machinery member) returns a violation naming the key and the
    /// remediation (delete or re-key).
    /// </summary>
    public static IReadOnlyList<StrandedOverrideViolation> FindStrandedOverrides(
        IEnumerable<string> overrideActionKeys)
    {
        ArgumentNullException.ThrowIfNull(overrideActionKeys);
        var violations = new List<StrandedOverrideViolation>();

        foreach (var raw in overrideActionKeys.OrderBy(k => k, StringComparer.Ordinal))
        {
            if (!ActionKey.TryParse(raw, out var key)
                || !ActionCatalog.TryGet(key, out var descriptor)
                || descriptor is null)
            {
                violations.Add(new StrandedOverrideViolation(
                    raw,
                    CodeStrandedOverride,
                    $"Stranded action_level_overrides row for '{raw}' — key does not exist in "
                    + "ActionCatalog. Remediation: delete the row or re-key it to the replacement "
                    + "catalog member before starting Tamma.Api."));
                continue;
            }

            if (descriptor.IsMachinery)
            {
                violations.Add(new StrandedOverrideViolation(
                    raw,
                    CodeStrandedOverride,
                    $"Stranded action_level_overrides row for '{raw}' — key is classified as "
                    + "machinery (takes no dial level). Remediation: delete the row from "
                    + "action_level_overrides."));
            }
        }

        return violations;
    }
}
