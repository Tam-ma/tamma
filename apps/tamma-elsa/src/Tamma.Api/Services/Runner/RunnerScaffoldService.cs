using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Tamma.Api.Services.Git;
using Tamma.Api.Services.PromptStore;
using Tamma.Core.Logging;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;
using Tamma.Platforms.Abstractions;
using PModels = Tamma.Platforms.Abstractions.Models;

namespace Tamma.Api.Services.Runner;

/// <inheritdoc cref="IRunnerScaffoldService" />
/// <remarks>
/// <para><b>Why a branch + PR, not a commit to the default branch.</b> The
/// story requires the scaffold commit to be reviewable and never to clobber a
/// user's copy silently. A PR is reviewable by construction, respects branch
/// protection, and leaves the default branch untouched until a person merges.
/// The cost: <c>workflow_dispatch</c> only sees the workflow once it is on the
/// default branch, so the runner is live on merge, not on install — the result
/// message says so.</para>
/// <para><b>Idempotent.</b> The branch is <c>tamma/runner-{version}</c>. A repeat
/// call finds the branch, skips the commit when it already carries the shipped
/// bytes, and returns the already-open PR instead of opening a second.</para>
/// <para>Writing under <c>.github/workflows/</c> needs the GitHub App's
/// <c>workflows: write</c> permission; without it the commit step fails with the
/// platform's typed error, surfaced as <see cref="RunnerScaffoldFailureCodes.PlatformError"/>.</para>
/// </remarks>
public sealed class RunnerScaffoldService : IRunnerScaffoldService
{
    /// <summary>Prefix of the install branch; the shipped version is appended.</summary>
    public const string BranchPrefix = "tamma/runner-";

    private readonly IGitRepoAuthorizer _authorizer;
    private readonly IPlatformResolver _platformResolver;
    private readonly IInstallationRepository _installations;
    private readonly IEventRepository _events;
    private readonly IRunnerTemplate _template;
    private readonly ITammaModeProvider _mode;
    private readonly ILogger<RunnerScaffoldService> _logger;

    public RunnerScaffoldService(
        IGitRepoAuthorizer authorizer,
        IPlatformResolver platformResolver,
        IInstallationRepository installations,
        IEventRepository events,
        IRunnerTemplate template,
        ITammaModeProvider mode,
        ILogger<RunnerScaffoldService> logger)
    {
        _authorizer = authorizer ?? throw new ArgumentNullException(nameof(authorizer));
        _platformResolver = platformResolver ?? throw new ArgumentNullException(nameof(platformResolver));
        _installations = installations ?? throw new ArgumentNullException(nameof(installations));
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _template = template ?? throw new ArgumentNullException(nameof(template));
        _mode = mode ?? throw new ArgumentNullException(nameof(mode));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    private bool IsSingleUser => _mode.Mode == TammaMode.SingleUser;

    private const string SingleUserMessage =
        "Single-user mode: no GitHub App, so nothing is installed into the repo. The engine runs the "
        + "coding agent locally (Agent:Local) with your own agent keys.";

    // ===================================================================
    // Status (read-only)
    // ===================================================================

    /// <inheritdoc />
    public async Task<RunnerStatusResult> GetStatusAsync(Guid? tenantId, string repo, CancellationToken ct = default)
    {
        if (IsSingleUser)
            return new RunnerStatusResult
            {
                Success = true, Mode = RunnerScaffoldModes.SingleUser, Repo = repo,
                ShippedVersion = _template.Version, Message = SingleUserMessage,
            };

        try
        {
            var probe = await ProbeAsync(tenantId, repo, ct).ConfigureAwait(false);
            if (probe.FailureCode is { } code)
                return StatusFail(repo, code, probe.FailureReason!);

            return new RunnerStatusResult
            {
                Success = true, Mode = RunnerScaffoldModes.SaaS, Repo = repo,
                ShippedVersion = _template.Version,
                State = probe.State!.Value.ToWire(),
                DefaultBranch = probe.DefaultBranch,
                Files = probe.Files,
                Message = NextStep(probe.State.Value),
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "runner scaffold status threw for {Repo}; returning PLATFORM_ERROR", LogSanitizer.Clean(repo));
            return StatusFail(repo, RunnerScaffoldFailureCodes.PlatformError, "an unexpected error occurred reading the runner status");
        }
    }

    private RunnerStatusResult StatusFail(string repo, string code, string reason) => new()
    {
        Success = false, Mode = RunnerScaffoldModes.SaaS, Repo = repo, ShippedVersion = _template.Version,
        FailureCode = code, FailureReason = reason,
    };

    private static string NextStep(RunnerInstallState state) => state switch
    {
        RunnerInstallState.Current => "The runner is installed and current.",
        RunnerInstallState.Absent => "Not installed. POST .../runner/install opens a pull request that adds it.",
        RunnerInstallState.Drifted => "Installed at a different version. POST .../runner/install with {\"upgrade\": true} opens an upgrade pull request.",
        _ => "Installed and edited locally. POST .../runner/install with {\"force\": true} opens a pull request that REPLACES your edits.",
    };

    // ===================================================================
    // Install
    // ===================================================================

    /// <inheritdoc />
    public async Task<RunnerInstallResult> InstallAsync(
        Guid? tenantId, string repo, RunnerInstallRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (IsSingleUser)
        {
            await EmitAsync(RunnerScaffoldEventTypes.Skipped, tenantId, repo, priorState: null,
                reason: "single_user_mode", failureCode: null, data: new { }, ct).ConfigureAwait(false);
            return new RunnerInstallResult
            {
                Success = true, Outcome = RunnerInstallOutcomes.NotApplicable, Mode = RunnerScaffoldModes.SingleUser,
                Repo = repo, ShippedVersion = _template.Version, Message = SingleUserMessage,
            };
        }

        try
        {
            return await InstallCoreAsync(tenantId, repo, request, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "runner scaffold install threw for {Repo}; returning PLATFORM_ERROR with one FAILED event",
                LogSanitizer.Clean(repo));
            return await FailAsync(tenantId, repo, null, RunnerScaffoldFailureCodes.PlatformError,
                "an unexpected error occurred installing the runner", ct).ConfigureAwait(false);
        }
    }

    private async Task<RunnerInstallResult> InstallCoreAsync(
        Guid? tenantId, string repo, RunnerInstallRequest request, CancellationToken ct)
    {
        var probe = await ProbeAsync(tenantId, repo, ct).ConfigureAwait(false);
        if (probe.FailureCode is { } code)
            return await FailAsync(tenantId, repo, null, code, probe.FailureReason!, ct).ConfigureAwait(false);

        var state = probe.State!.Value;
        var prior = state.ToWire();

        // ── D5: never clobber without an explicit opt-in ──
        switch (state)
        {
            case RunnerInstallState.Current:
                await EmitAsync(RunnerScaffoldEventTypes.Skipped, tenantId, repo, prior, "already_current", null, new { }, ct)
                    .ConfigureAwait(false);
                return Result(true, RunnerInstallOutcomes.AlreadyCurrent, repo, prior,
                    message: "Already up to date; nothing was written.");

            case RunnerInstallState.Drifted when !request.Upgrade && !request.Force:
                return await RefuseAsync(tenantId, repo, prior, RunnerScaffoldFailureCodes.NeedsUpgrade, "needs_upgrade",
                    $"The installed runner is a different version (shipped {_template.Version}): {DriftedPaths(probe)}. "
                    + "Re-request with {\"upgrade\": true} to open an upgrade pull request.", ct).ConfigureAwait(false);

            case RunnerInstallState.Customized when !request.Force:
                return await RefuseAsync(tenantId, repo, prior, RunnerScaffoldFailureCodes.NeedsForce, "needs_force",
                    $"Edited locally: {CustomizedPaths(probe)}. Re-request with {{\"force\": true}} to open a pull "
                    + "request that replaces them (your edits are lost on merge).", ct).ConfigureAwait(false);
        }

        // ── Write: branch → (commit unless already carried) → PR ──
        var client = probe.Driver!.Client;
        var (owner, name) = (probe.Owner!, probe.Name!);
        var defaultBranch = probe.DefaultBranch!;
        var branch = BranchPrefix + _template.Version.Trim();

        // The branch name depends only on the version, so a branch left over from an
        // earlier install (PR merged or closed, branch kept) is reused by name. Only a
        // branch with an OPEN PR is live work to build on; without one the branch is
        // stale — it may carry the shipped bytes with no commits ahead of default, and
        // reusing it would skip the commit and open an empty PR (GitHub 422). A stale
        // branch is deleted and recreated from the default tip. The branch is
        // Tamma-owned (tamma/runner-<version>), so nothing of the user's is lost.
        var existing = await client.GetBranchAsync(owner, name, branch, ct).ConfigureAwait(false);
        PModels.PullRequest? openPr = null;
        bool needsCreate;
        switch (existing)
        {
            case PlatformResult<PModels.Branch>.Ok:
            {
                var open = await client.ListOpenPullRequestsForBranchAsync(owner, name, branch, defaultBranch, ct)
                    .ConfigureAwait(false);
                if (open is not PlatformResult<IReadOnlyList<PModels.PullRequest>>.Ok openOk)
                    return await StepFailAsync(tenantId, repo, prior, "list open pull requests", open, ct).ConfigureAwait(false);
                openPr = openOk.Value.Count > 0 ? openOk.Value[0] : null;
                if (openPr is null)
                {
                    var deleted = await client.DeleteBranchAsync(owner, name, branch, ct).ConfigureAwait(false);
                    if (deleted is not PlatformResult<bool>.Ok and not PlatformResult<bool>.Failed { Error: PlatformError.NotFound })
                        return await StepFailAsync(tenantId, repo, prior, "reset stale install branch", deleted, ct).ConfigureAwait(false);
                }
                needsCreate = openPr is null;
                break;
            }
            case PlatformResult<PModels.Branch>.Failed { Error: PlatformError.NotFound }:
                needsCreate = true;
                break;
            default:
                return await StepFailAsync(tenantId, repo, prior, "read install branch", existing, ct).ConfigureAwait(false);
        }

        if (needsCreate)
        {
            var tip = await client.GetBranchAsync(owner, name, defaultBranch, ct).ConfigureAwait(false);
            if (tip is not PlatformResult<PModels.Branch>.Ok tipOk)
                return await StepFailAsync(tenantId, repo, prior, "read default branch", tip, ct).ConfigureAwait(false);
            var created = await client.CreateBranchAsync(
                new PModels.CreateBranchRequest(owner, name, branch, tipOk.Value.Sha), ct).ConfigureAwait(false);
            if (created is not PlatformResult<PModels.Branch>.Ok)
                return await StepFailAsync(tenantId, repo, prior, "create install branch", created, ct).ConfigureAwait(false);
        }

        // A fresh branch sits at the default tip, which is not Current (that returned
        // above), so it never already carries the set — only a live PR branch can.
        string? commitSha = null;
        var alreadyCarried = !needsCreate
            && await BranchCarriesShippedSetAsync(client, owner, name, branch, ct).ConfigureAwait(false);
        if (!alreadyCarried)
        {
            var commit = await client.CommitFilesAsync(new PModels.CommitFilesRequest(
                owner, name, branch,
                $"chore: {(state == RunnerInstallState.Absent ? "install" : "upgrade")} Tamma agent runner {_template.Version.Trim()}",
                _template.Files.Select(f => new PModels.CommitFileChange(f.RepoPath, f.Content, f.Executable)).ToList()),
                ct).ConfigureAwait(false);
            if (commit is not PlatformResult<PModels.FileCommit>.Ok commitOk)
                return await StepFailAsync(tenantId, repo, prior, "commit runner files", commit, ct).ConfigureAwait(false);
            commitSha = commitOk.Value.Sha;
        }

        PModels.PullRequest pr;
        if (openPr is not null)
        {
            pr = openPr;
        }
        else
        {
            var opened = await client.OpenPullRequestAsync(new PModels.OpenPullRequestRequest(
                owner, name, $"Tamma agent runner {_template.Version.Trim()}", branch, defaultBranch,
                PullRequestBody(state, probe)), ct).ConfigureAwait(false);
            if (opened is not PlatformResult<PModels.PullRequest>.Ok openedOk)
                return await StepFailAsync(tenantId, repo, prior, "open pull request", opened, ct).ConfigureAwait(false);
            pr = openedOk.Value;
        }

        var upgraded = state != RunnerInstallState.Absent;
        await EmitAsync(upgraded ? RunnerScaffoldEventTypes.Upgraded : RunnerScaffoldEventTypes.Installed,
            tenantId, repo, prior, reason: null, failureCode: null,
            new
            {
                branch, commitSha, pullRequestNumber = pr.Number, pullRequestUrl = pr.HtmlUrl,
                files = _template.Files.Select(f => f.RepoPath).ToArray(),
                reusedCommit = alreadyCarried, upgrade = request.Upgrade, force = request.Force,
            }, ct).ConfigureAwait(false);

        return Result(true, upgraded ? RunnerInstallOutcomes.Upgraded : RunnerInstallOutcomes.Installed, repo, prior,
            message: $"Pull request #{pr.Number} is open. Merge it to activate the runner, then add the "
                     + "ANTHROPIC_API_KEY repository secret (Tamma never sees it).") with
        {
            Branch = branch, CommitSha = commitSha, PullRequestNumber = pr.Number, PullRequestUrl = pr.HtmlUrl,
        };
    }

    private async Task<bool> BranchCarriesShippedSetAsync(
        IGitPlatformClient client, string owner, string name, string branch, CancellationToken ct)
    {
        foreach (var file in _template.Files)
        {
            var read = await client.GetFileContentAsync(
                new PModels.GetFileContentRequest(owner, name, file.RepoPath, branch), ct).ConfigureAwait(false);
            if (read is not PlatformResult<byte[]>.Ok ok || !ok.Value.AsSpan().SequenceEqual(file.Content))
                return false;
        }
        return true;
    }

    private string PullRequestBody(RunnerInstallState state, Probe probe) =>
        $"""
        Installs the Tamma agent runner **{_template.Version.Trim()}** (prior state: `{state.ToWire()}`).

        Files:
        {string.Join("\n", _template.Files.Select(f => $"- `{f.RepoPath}`"))}

        After merging, add the `ANTHROPIC_API_KEY` repository secret (Settings → Secrets and variables → Actions).
        The agent key stays in GitHub Actions; Tamma only dispatches the workflow and reads the `tamma-result` artifact.

        {(state == RunnerInstallState.Customized ? "⚠️ This REPLACES locally edited files: " + CustomizedPaths(probe) : string.Empty)}
        """;

    private static string DriftedPaths(Probe p) =>
        string.Join(", ", p.Files.Where(f => f.State == RunnerInstallState.Drifted.ToWire()).Select(f => f.Path));

    private static string CustomizedPaths(Probe p) =>
        string.Join(", ", p.Files.Where(f => f.State == RunnerInstallState.Customized.ToWire()).Select(f => f.Path));

    private RunnerInstallResult Result(bool success, string outcome, string repo, string? prior,
        string? message = null, string? code = null, string? reason = null) => new()
    {
        Success = success, Outcome = outcome, Mode = RunnerScaffoldModes.SaaS, Repo = repo,
        ShippedVersion = _template.Version, PriorState = prior, Message = message,
        FailureCode = code, FailureReason = reason,
    };

    private async Task<RunnerInstallResult> RefuseAsync(
        Guid? tenantId, string repo, string prior, string code, string reasonTag, string reason, CancellationToken ct)
    {
        await EmitAsync(RunnerScaffoldEventTypes.Skipped, tenantId, repo, prior, reasonTag, code, new { }, ct)
            .ConfigureAwait(false);
        return Result(false, RunnerInstallOutcomes.Refused, repo, prior, message: reason, code: code, reason: reason);
    }

    private async Task<RunnerInstallResult> FailAsync(
        Guid? tenantId, string repo, string? prior, string code, string reason, CancellationToken ct)
    {
        await EmitAsync(RunnerScaffoldEventTypes.Failed, tenantId, repo, prior, reason: null, code, new { }, ct)
            .ConfigureAwait(false);
        return Result(false, RunnerInstallOutcomes.Failed, repo, prior, code: code, reason: reason);
    }

    private Task<RunnerInstallResult> StepFailAsync<T>(
        Guid? tenantId, string repo, string prior, string step, PlatformResult<T> result, CancellationToken ct) =>
        FailAsync(tenantId, repo, prior, RunnerScaffoldFailureCodes.PlatformError, $"{step} failed: {Describe(result)}", ct);

    /// <summary>Key-free description of a failed platform result (error kind + code only).</summary>
    private static string Describe<T>(PlatformResult<T> result) => result switch
    {
        PlatformResult<T>.Failed { Error: PlatformError.InvalidRequest ir } => $"invalid request ({ir.Code})",
        PlatformResult<T>.Failed f => f.Error.GetType().Name,
        PlatformResult<T>.ServiceUnavailable => "platform driver not wired",
        _ => "unexpected platform response",
    };

    // ===================================================================
    // Probe: guard → parse → driver → default branch → per-file state
    // ===================================================================

    private sealed record Probe(
        string? FailureCode, string? FailureReason,
        IGitPlatformDriver? Driver = null, string? Owner = null, string? Name = null,
        string? DefaultBranch = null, RunnerInstallState? State = null,
        IReadOnlyList<RunnerFileStatus> Files = null!)
    {
        public static Probe Fail(string code, string reason) => new(code, reason, Files: []);
    }

    private async Task<Probe> ProbeAsync(Guid? tenantId, string repo, CancellationToken ct)
    {
        // The guard runs FIRST — before parsing, driver resolution or any platform call.
        var authz = await _authorizer.AuthorizeAsync(tenantId, repo, ct).ConfigureAwait(false);
        if (!authz.Allowed)
            return Probe.Fail(RunnerScaffoldFailureCodes.RepoNotAuthorized, authz.Reason ?? "repository not authorized for this tenant");

        var parts = string.IsNullOrWhiteSpace(repo) ? [] : repo.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2)
            return Probe.Fail(RunnerScaffoldFailureCodes.InvalidRepo, $"Invalid repository '{repo}' (expected 'owner/repo')");
        var (owner, name) = (parts[0], parts[1]);

        var driver = await ResolveDriverAsync(tenantId, repo, ct).ConfigureAwait(false);
        if (driver is null)
            return Probe.Fail(RunnerScaffoldFailureCodes.PlatformNotConfigured,
                "No platform driver resolved for this tenant/repo — connect the GitHub App first.");
        if (driver.Kind == PlatformKind.GitLab)
            return Probe.Fail(RunnerScaffoldFailureCodes.PlatformUnsupported,
                "GitLab runs pipelines per ref, not a dispatched workflow file; the GitHub Actions runner does not apply.");
        if (!driver.Capabilities.Contains(PlatformCapability.FileWrites))
            return Probe.Fail(RunnerScaffoldFailureCodes.PlatformUnsupported,
                $"The {driver.Kind} driver cannot commit files yet; install with runner/github-actions/install-runner.sh instead.");

        var repoInfo = await driver.Client.GetRepoAsync(owner, name, ct).ConfigureAwait(false);
        if (repoInfo is not PlatformResult<PModels.Repo>.Ok { Value.DefaultBranch: { Length: > 0 } defaultBranch })
            return Probe.Fail(RunnerScaffoldFailureCodes.PlatformError, $"read repository failed: {Describe(repoInfo)}");

        var files = new List<RunnerFileStatus>(_template.Files.Count);
        var worst = RunnerInstallState.Current;
        foreach (var shipped in _template.Files)
        {
            var read = await driver.Client.GetFileContentAsync(
                new PModels.GetFileContentRequest(owner, name, shipped.RepoPath, defaultBranch), ct).ConfigureAwait(false);
            RunnerInstallState state;
            string? installedVersion = null;
            switch (read)
            {
                case PlatformResult<byte[]>.Failed { Error: PlatformError.NotFound }:
                    state = RunnerInstallState.Absent;
                    break;
                case PlatformResult<byte[]>.Ok ok:
                    installedVersion = RunnerVersionMarker.Parse(ok.Value);
                    state = ok.Value.AsSpan().SequenceEqual(shipped.Content) ? RunnerInstallState.Current
                        : !string.Equals(installedVersion, _template.Version, StringComparison.Ordinal) ? RunnerInstallState.Drifted
                        : RunnerInstallState.Customized;
                    break;
                default:
                    return Probe.Fail(RunnerScaffoldFailureCodes.PlatformError,
                        $"read {shipped.RepoPath} failed: {Describe(read)}");
            }
            files.Add(new RunnerFileStatus(shipped.RepoPath, state.ToWire(), installedVersion));
            if (state > worst) worst = state;
        }

        return new Probe(null, null, driver, owner, name, defaultBranch, worst, files);
    }

    /// <summary>Per-repo installation first, tenant-primary second — the same
    /// resolution <c>AgentDispatchMediationService</c> uses, so the install and
    /// the later dispatch speak to the repo through the same installation.</summary>
    private async Task<IGitPlatformDriver?> ResolveDriverAsync(Guid? tenantId, string repo, CancellationToken ct)
    {
        if (tenantId is { } tid && tid != Guid.Empty)
        {
            try
            {
                var install = await _installations.GetByRepoFullNameAsync(repo).ConfigureAwait(false);
                if (install?.TenantId == tid)
                {
                    var perRepo = await _platformResolver.ResolveForRepoInstallationAsync(
                        tid, PlatformKind.GitHub,
                        install.InstallationId.ToString(CultureInfo.InvariantCulture), ct).ConfigureAwait(false);
                    if (perRepo is not null) return perRepo;
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Per-repo installation resolution failed for {Repo}; falling back to tenant-primary",
                    LogSanitizer.Clean(repo));
            }
        }

        var resolution = await _platformResolver.ResolveForMediationAsync(tenantId, ct).ConfigureAwait(false);
        return resolution?.Driver;
    }

    // ===================================================================
    // DCB audit
    // ===================================================================

    private async Task EmitAsync(
        string eventType, Guid? tenantId, string repo, string? priorState, string? reason, string? failureCode,
        object data, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        try
        {
            await _events.AppendAsync(new DomainEvent
            {
                Id = Guid.NewGuid(),
                Type = eventType,
                TenantId = tenantId,
                Tags = JsonSerializer.Serialize(new
                {
                    tenantId = tenantId?.ToString(), repo, runnerVersion = _template.Version.Trim(),
                    priorState, reason, failureCode,
                    mode = IsSingleUser ? RunnerScaffoldModes.SingleUser : RunnerScaffoldModes.SaaS,
                }),
                Metadata = JsonSerializer.Serialize(new { workflowVersion = "1.0.0", eventSource = "system" }),
                Data = JsonSerializer.Serialize(data),
                CreatedAt = DateTime.UtcNow,
            }).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The install result still returns; the audit gap is logged loudly.
            _logger.LogError(ex, "RUNNER.SCAFFOLD.* append failed (type={Type}) for {Repo}", eventType, LogSanitizer.Clean(repo));
        }
    }
}
