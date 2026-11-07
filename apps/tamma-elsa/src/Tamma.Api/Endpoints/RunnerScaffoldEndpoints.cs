using Microsoft.AspNetCore.Http;
using Tamma.Api.Services.Runner;
using Tamma.Data;

namespace Tamma.Api.Endpoints;

/// <summary>
/// Story 40-1 AC7 — the tenant-admin runner scaffold surface:
/// <c>GET /api/v1/repos/{owner}/{repo}/runner</c> (status) and
/// <c>POST /api/v1/repos/{owner}/{repo}/runner/install</c> (install / upgrade,
/// body <c>{ "upgrade"?: bool, "force"?: bool }</c>). The tenant comes from
/// <see cref="ITenantContext"/>, never the body; the tenant↔repo guard runs inside
/// the service before any platform call.
/// </summary>
public static class RunnerScaffoldEndpoints
{
    public static async Task<IResult> GetStatus(
        string owner, string repo, ITenantContext tenantContext, IRunnerScaffoldService scaffold, CancellationToken ct)
    {
        var result = await scaffold.GetStatusAsync(tenantContext.TenantId, $"{owner}/{repo}", ct).ConfigureAwait(false);
        return result.Success ? Results.Ok(result) : Results.Json(result, statusCode: StatusFor(result.FailureCode));
    }

    public static async Task<IResult> Install(
        string owner, string repo, RunnerInstallRequest? body,
        ITenantContext tenantContext, IRunnerScaffoldService scaffold, CancellationToken ct)
    {
        var result = await scaffold.InstallAsync(
            tenantContext.TenantId, $"{owner}/{repo}", body ?? new RunnerInstallRequest(), ct).ConfigureAwait(false);
        return result.Success ? Results.Ok(result) : Results.Json(result, statusCode: StatusFor(result.FailureCode));
    }

    /// <summary>Failure code → HTTP status.</summary>
    internal static int StatusFor(string? failureCode) => failureCode switch
    {
        RunnerScaffoldFailureCodes.RepoNotAuthorized => StatusCodes.Status403Forbidden,
        RunnerScaffoldFailureCodes.InvalidRepo => StatusCodes.Status400BadRequest,
        RunnerScaffoldFailureCodes.NeedsUpgrade or RunnerScaffoldFailureCodes.NeedsForce => StatusCodes.Status409Conflict,
        RunnerScaffoldFailureCodes.PlatformUnsupported => StatusCodes.Status422UnprocessableEntity,
        RunnerScaffoldFailureCodes.PlatformNotConfigured => StatusCodes.Status503ServiceUnavailable,
        _ => StatusCodes.Status502BadGateway,
    };
}
