namespace Tamma.Api.Services.Runner;

/// <summary>
/// Story 40-1 AC7 — DCB event types for the runner scaffold. Exactly ONE
/// terminal event per install call; the status read emits none (it changes
/// nothing). Tags: <c>tenantId</c>, <c>repo</c>, <c>runnerVersion</c>,
/// <c>priorState</c>, plus <c>reason</c>/<c>failureCode</c> where relevant.
/// </summary>
public static class RunnerScaffoldEventTypes
{
    /// <summary>The runner set was committed to a branch and a PR is open, into a repo that had none.</summary>
    public const string Installed = "RUNNER.SCAFFOLD.INSTALLED";

    /// <summary>A drifted or customized install was replaced (explicit upgrade/force) via a PR.</summary>
    public const string Upgraded = "RUNNER.SCAFFOLD.UPGRADED";

    /// <summary>Nothing was written: already current, needs an explicit upgrade/force, or single-user mode.</summary>
    public const string Skipped = "RUNNER.SCAFFOLD.SKIPPED";

    /// <summary>The install could not run: guard denied, no driver, unsupported platform, or a platform error.</summary>
    public const string Failed = "RUNNER.SCAFFOLD.FAILED";
}
