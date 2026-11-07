using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Tamma.Core;
using Tamma.Core.AgentDispatch.Resume;

namespace Tamma.Activities.AgentDispatch;

/// <summary>
/// Story 40-4 — where a restarted <c>SingleIssueCycleWorkflow</c>'s task loop should begin.
/// Throws a <see cref="TammaError"/> with <see cref="TaskLoopResumeCalculator.InconsistentStateCode"/>
/// when git and the event trail disagree; the caller routes that to the cycle's loud failure.
/// </summary>
public interface ITaskLoopReEntryService
{
    Task<TaskLoopResumePosition> ReconstructAsync(
        Guid? tenantId, string repository, string branchName, int issueNumber, CancellationToken ct);
}

/// <summary>
/// Story 40-4 (AC6) — the switched-off seam: always task 0, today's behaviour. Selected while
/// <see cref="TaskReEntryRegistration.ConfigKey"/> is set to true (the operator kill-switch).
/// </summary>
public sealed class NullTaskLoopReEntryService : ITaskLoopReEntryService
{
    public Task<TaskLoopResumePosition> ReconstructAsync(
        Guid? tenantId, string repository, string branchName, int issueNumber, CancellationToken ct)
        => Task.FromResult(TaskLoopResumePosition.Start(
            TaskResumeBasis.Disabled, "Task re-entry is switched off (Coding:TaskReEntryDisabled); starting at task 0."));
}

/// <summary>Story 40-4 (AC6) — the one config switch, read the same way by both hosts.</summary>
public static class TaskReEntryRegistration
{
    public const string ConfigKey = "Coding:TaskReEntryDisabled";

    /// <summary>
    /// The shipped default: re-entry OFF. Story 40-4 shipped it off; Story 40-7 turned it on; the
    /// 2026-11-07 audit turned it back off: <c>TaskLoopReEntryService.ReadRunsAsync</c> reads
    /// <c>AGENT_RUN.*</c> events by issue/repo/branch only, so a re-run of an issue (fixed branch
    /// <c>tamma/issue-N</c>) inherits an EARLIER attempt's task results and can fail with
    /// <c>CODE.REENTRY.INCONSISTENT_STATE</c> before dispatching anything. Turn it back on only
    /// once those reads are scoped to the crashed attempt. Set the key to <c>false</c> to opt in.
    /// </summary>
    public const bool DisabledByDefault = true;

    public static bool IsDisabled(IConfiguration configuration)
        => configuration.GetValue(ConfigKey, DisabledByDefault);
}

/// <summary>
/// The accepted task-breakdown <c>plan</c> written by <c>task-creation</c> (Story 39-15).
/// It is stored under a producer-scoped issue id so it never collides with the system plan
/// (<c>CreationBindingHelper.ScopeIssueId</c>); a test pins the two to the same string.
/// </summary>
public static class TaskBreakdownDocument
{
    public const string DocumentType = "plan";
    public const string Producer = "task-creation";

    /// <summary><c>{repository}#{issueNumber}#task-creation</c>.</summary>
    public static string IssueIdFor(string repository, int issueNumber)
        => $"{repository}#{issueNumber.ToString(System.Globalization.CultureInfo.InvariantCulture)}#{Producer}";

    /// <summary>
    /// Read the stored plan body into the loop's task list: the raw <c>tasks</c> array (exactly
    /// what <c>task-creation</c> hands the cycle as <c>tasksJson</c>) and each task's id/files.
    /// False on an unreadable or task-less body.
    /// </summary>
    public static bool TryRead(string? planBodyJson, out string tasksJson, out IReadOnlyList<TaskListEntry> tasks)
    {
        tasksJson = "[]";
        tasks = [];
        if (string.IsNullOrWhiteSpace(planBodyJson)) return false;
        try
        {
            using var doc = JsonDocument.Parse(planBodyJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object
                || !doc.RootElement.TryGetProperty("tasks", out var arr)
                || arr.ValueKind != JsonValueKind.Array
                || arr.GetArrayLength() == 0)
                return false;

            var list = new List<TaskListEntry>();
            foreach (var t in arr.EnumerateArray())
            {
                string? id = null;
                var files = new List<string>();
                if (t.ValueKind == JsonValueKind.Object)
                {
                    if (t.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.String)
                        id = idEl.GetString();
                    if (t.TryGetProperty("files", out var fEl) && fEl.ValueKind == JsonValueKind.Array)
                        files.AddRange(fEl.EnumerateArray()
                            .Where(f => f.ValueKind == JsonValueKind.String)
                            .Select(f => f.GetString()!));
                }
                list.Add(new TaskListEntry(id, files));
            }
            tasksJson = arr.GetRawText();
            tasks = list;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}

/// <summary>
/// Story 40-4 — the engine host's <see cref="ITaskLoopReEntryService"/>. The real service needs
/// the tenant's event store, document store and git driver, which only Tamma.Api composes, so
/// the engine asks the API (<c>GET /api/engine/issues/{n}/task-resume</c>) — the same split as
/// 39-10's <c>HttpLifecycleReEntryService</c>. A 409 carries an inconsistency, rethrown as the
/// typed error; any other failure throws a retryable read error.
/// </summary>
public sealed class HttpTaskLoopReEntryService : ITaskLoopReEntryService
{
    public const string ReadFailedCode = "CODE.REENTRY.READ_FAILED";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly string _baseUrl;
    private readonly string? _token;
    private readonly ILogger<HttpTaskLoopReEntryService> _logger;

    public HttpTaskLoopReEntryService(
        IHttpClientFactory httpClientFactory, IConfiguration configuration, ILogger<HttpTaskLoopReEntryService> logger)
    {
        _httpClientFactory = httpClientFactory ?? throw new ArgumentNullException(nameof(httpClientFactory));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _baseUrl = (configuration?["Tamma:ApiUrl"]
                    ?? Environment.GetEnvironmentVariable("TAMMA_API_URL")
                    ?? "http://localhost:3000").TrimEnd('/');
        _token = configuration?["Tamma:ApiToken"] ?? Environment.GetEnvironmentVariable("TAMMA_API_TOKEN");
    }

    public static string PathFor(string repository, string branchName, int issueNumber)
        => $"/api/engine/issues/{issueNumber.ToString(System.Globalization.CultureInfo.InvariantCulture)}/task-resume" +
           $"?repository={Uri.EscapeDataString(repository)}&branch={Uri.EscapeDataString(branchName)}";

    public async Task<TaskLoopResumePosition> ReconstructAsync(
        Guid? tenantId, string repository, string branchName, int issueNumber, CancellationToken ct)
    {
        var url = _baseUrl + PathFor(repository, branchName, issueNumber);
        HttpResponseMessage response;
        try
        {
            var client = _httpClientFactory.CreateClient(nameof(HttpTaskLoopReEntryService));
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            if (!string.IsNullOrWhiteSpace(_token))
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
            if (tenantId is Guid t && t != Guid.Empty)
                request.Headers.TryAddWithoutValidation("X-Tenant-Id", t.ToString());
            response = await client.SendAsync(request, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "Task re-entry read failed in transport");
            throw new TammaError(ReadFailedCode, $"Task re-entry read failed in transport: {ex.GetType().Name}.", retryable: true);
        }

        using (response)
        {
            if (response.StatusCode == HttpStatusCode.Conflict)
            {
                var problem = await TryReadAsync<InconsistencyBody>(response, ct).ConfigureAwait(false);
                throw new TammaError(
                    problem?.Code ?? TaskLoopResumeCalculator.InconsistentStateCode,
                    problem?.Message ?? "Task re-entry found git and the event trail in disagreement.",
                    retryable: false,
                    severity: TammaErrorSeverity.High);
            }
            if (!response.IsSuccessStatusCode)
                throw new TammaError(ReadFailedCode,
                    $"Task re-entry read returned {(int)response.StatusCode}.", retryable: true);

            return await TryReadAsync<TaskLoopResumePosition>(response, ct).ConfigureAwait(false)
                   ?? throw new TammaError(ReadFailedCode, "Task re-entry read returned an empty body.", retryable: true);
        }
    }

    /// <summary>The 409 body the API endpoint writes.</summary>
    public sealed record InconsistencyBody(string Code, string Message);

    private static async Task<T?> TryReadAsync<T>(HttpResponseMessage response, CancellationToken ct) where T : class
    {
        try
        {
            return await response.Content.ReadFromJsonAsync<T>(Json, ct).ConfigureAwait(false);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
