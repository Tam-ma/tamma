namespace Tamma.Api.Services.Runner;

/// <summary>
/// Story 40-1 AC7 (D5) — install / drift-detect / opt-in upgrade of the Tamma
/// agent runner into a tenant's repo through the tenant's platform driver.
/// The SaaS half of what <c>install-runner.sh</c> does self-serve, with the same
/// four states and the same no-clobber rule.
///
/// <para><b>Per mode (AC10).</b> SaaS: the tenant owns the installed runner; it
/// runs on the tenant's CI with the tenant's repo-secret agent keys; results land
/// in the tenant's <c>tamma-result</c> artifact. Single-user: a no-op — the engine
/// runs the agent locally (<c>LocalExecutor</c>) with the sole user's keys, so
/// both calls answer <see cref="RunnerScaffoldModes.SingleUser"/> and write
/// nothing.</para>
///
/// <para>Both calls never throw on platform errors: they return a typed failure
/// code (see <see cref="RunnerScaffoldFailureCodes"/>). The tenant↔repo guard
/// (<c>IGitRepoAuthorizer</c>) runs before any driver is resolved.</para>
/// </summary>
public interface IRunnerScaffoldService
{
    /// <summary>Read-only: compare the repo's installed runner (on its default
    /// branch) with the shipped set.</summary>
    Task<RunnerStatusResult> GetStatusAsync(Guid? tenantId, string repo, CancellationToken ct = default);

    /// <summary>Install (state absent), upgrade (drifted, needs
    /// <see cref="RunnerInstallRequest.Upgrade"/>), or overwrite (customized,
    /// needs <see cref="RunnerInstallRequest.Force"/>). Writes go to a
    /// <c>tamma/runner-{version}</c> branch and a pull request — never directly to
    /// the default branch. Emits exactly one <c>RUNNER.SCAFFOLD.*</c> event.</summary>
    Task<RunnerInstallResult> InstallAsync(
        Guid? tenantId, string repo, RunnerInstallRequest request, CancellationToken ct = default);
}

/// <summary>The four install states, ranked worst-wins across the set exactly as
/// <c>install-runner.sh</c> ranks them: customized &gt; drifted &gt; absent &gt; current.</summary>
public enum RunnerInstallState
{
    /// <summary>Byte-identical to the shipped file.</summary>
    Current = 0,

    /// <summary>Not present on the default branch.</summary>
    Absent = 1,

    /// <summary>Present, but its version marker differs from the shipped one (or is missing).</summary>
    Drifted = 2,

    /// <summary>Present with the shipped version marker but different bytes — edited on purpose.</summary>
    Customized = 3,
}

/// <summary>Wire spellings for <see cref="RunnerInstallState"/>.</summary>
public static class RunnerInstallStateExtensions
{
    /// <summary><c>current</c> / <c>absent</c> / <c>drifted</c> / <c>customized</c>.</summary>
    public static string ToWire(this RunnerInstallState state) => state switch
    {
        RunnerInstallState.Current => "current",
        RunnerInstallState.Absent => "absent",
        RunnerInstallState.Drifted => "drifted",
        _ => "customized",
    };
}

/// <summary>Process-mode labels the scaffold reports.</summary>
public static class RunnerScaffoldModes
{
    /// <summary>SaaS / GitHub App — the scaffold path is live.</summary>
    public const string SaaS = "saas";

    /// <summary>Self-hosted single user — the scaffold is a no-op; the local runner is used.</summary>
    public const string SingleUser = "single-user";
}

/// <summary>Typed, key-free failure codes.</summary>
public static class RunnerScaffoldFailureCodes
{
    /// <summary>403 — the tenant may not act on this repo.</summary>
    public const string RepoNotAuthorized = "REPO_NOT_AUTHORIZED";

    /// <summary>400 — the repo is not <c>owner/name</c>.</summary>
    public const string InvalidRepo = "INVALID_REPO";

    /// <summary>503 — no platform driver resolved for this tenant/repo.</summary>
    public const string PlatformNotConfigured = "PLATFORM_NOT_CONFIGURED";

    /// <summary>422 — the platform has no dispatch-by-workflow-file model (GitLab) or no file-write verb.</summary>
    public const string PlatformUnsupported = "PLATFORM_UNSUPPORTED";

    /// <summary>409 — the installed runner is drifted; re-request with <c>upgrade: true</c>.</summary>
    public const string NeedsUpgrade = "NEEDS_UPGRADE";

    /// <summary>409 — the installed runner was customized; re-request with <c>force: true</c> (local edits are lost).</summary>
    public const string NeedsForce = "NEEDS_FORCE";

    /// <summary>502 — a platform call failed (the reason names the step).</summary>
    public const string PlatformError = "PLATFORM_ERROR";
}

/// <summary>Install-call options. Both default to false: install only into a repo with no runner.</summary>
/// <param name="Upgrade">Replace a drifted install (version marker differs).</param>
/// <param name="Force">Replace even a customized install (implies <paramref name="Upgrade"/>).</param>
public sealed record RunnerInstallRequest(bool Upgrade = false, bool Force = false);

/// <summary>One file's state.</summary>
/// <param name="Path">Install path in the repo.</param>
/// <param name="State">Wire state (<see cref="RunnerInstallStateExtensions.ToWire"/>).</param>
/// <param name="InstalledVersion">The installed file's version marker; null when absent or unmarked.</param>
public sealed record RunnerFileStatus(string Path, string State, string? InstalledVersion);

/// <summary>Result of <see cref="IRunnerScaffoldService.GetStatusAsync"/>.</summary>
public sealed record RunnerStatusResult
{
    /// <summary>True when the state was determined (or the mode makes it not applicable).</summary>
    public required bool Success { get; init; }

    /// <summary><see cref="RunnerScaffoldModes"/>.</summary>
    public required string Mode { get; init; }

    /// <summary><c>owner/name</c> as requested.</summary>
    public required string Repo { get; init; }

    /// <summary>The shipped runner version.</summary>
    public required string ShippedVersion { get; init; }

    /// <summary>Worst-wins state across the set; null when not determined or not applicable.</summary>
    public string? State { get; init; }

    /// <summary>The branch the state was read from.</summary>
    public string? DefaultBranch { get; init; }

    /// <summary>Per-file states.</summary>
    public IReadOnlyList<RunnerFileStatus> Files { get; init; } = [];

    /// <summary>Operator-facing next step.</summary>
    public string? Message { get; init; }

    /// <summary><see cref="RunnerScaffoldFailureCodes"/> when <see cref="Success"/> is false.</summary>
    public string? FailureCode { get; init; }

    /// <summary>Key-free failure detail.</summary>
    public string? FailureReason { get; init; }
}

/// <summary>Install outcomes (wire values).</summary>
public static class RunnerInstallOutcomes
{
    /// <summary>A PR with the runner set is open into a repo that had none.</summary>
    public const string Installed = "installed";

    /// <summary>A PR replacing a drifted/customized install is open.</summary>
    public const string Upgraded = "upgraded";

    /// <summary>Already byte-identical; nothing written.</summary>
    public const string AlreadyCurrent = "already_current";

    /// <summary>Refused — needs <c>upgrade</c> or <c>force</c>; nothing written.</summary>
    public const string Refused = "refused";

    /// <summary>Single-user mode — nothing to install.</summary>
    public const string NotApplicable = "not_applicable";

    /// <summary>The install could not run.</summary>
    public const string Failed = "failed";
}

/// <summary>Result of <see cref="IRunnerScaffoldService.InstallAsync"/>.</summary>
public sealed record RunnerInstallResult
{
    /// <summary>True for installed / upgraded / already_current / not_applicable.</summary>
    public required bool Success { get; init; }

    /// <summary><see cref="RunnerInstallOutcomes"/>.</summary>
    public required string Outcome { get; init; }

    /// <summary><see cref="RunnerScaffoldModes"/>.</summary>
    public required string Mode { get; init; }

    /// <summary><c>owner/name</c> as requested.</summary>
    public required string Repo { get; init; }

    /// <summary>The shipped runner version.</summary>
    public required string ShippedVersion { get; init; }

    /// <summary>The state before the call; null when it could not be read.</summary>
    public string? PriorState { get; init; }

    /// <summary>The install branch.</summary>
    public string? Branch { get; init; }

    /// <summary>The new commit, or null when the branch already carried the shipped set.</summary>
    public string? CommitSha { get; init; }

    /// <summary>The PR number.</summary>
    public string? PullRequestNumber { get; init; }

    /// <summary>The PR URL — merge it to activate the runner.</summary>
    public string? PullRequestUrl { get; init; }

    /// <summary>Operator-facing next step.</summary>
    public string? Message { get; init; }

    /// <summary><see cref="RunnerScaffoldFailureCodes"/> when not successful.</summary>
    public string? FailureCode { get; init; }

    /// <summary>Key-free failure detail.</summary>
    public string? FailureReason { get; init; }
}
