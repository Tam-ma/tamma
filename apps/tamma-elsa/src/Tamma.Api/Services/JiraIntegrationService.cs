using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Tamma.Core.Interfaces;

namespace Tamma.Api.Services;

/// <summary>
/// JIRA integration service — ticket queries and updates.
/// </summary>
public class JiraIntegrationService : IJiraIntegrationService
{
    private readonly ILogger<JiraIntegrationService> _logger;
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClientFactory;

    public JiraIntegrationService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<JiraIntegrationService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<IntegrationResult<JiraTicketResult>> UpdateJiraTicketAsync(string ticketId, JiraTicketUpdate update)
    {
        var baseUrl = _configuration["Jira:BaseUrl"];
        var email = _configuration["Jira:Email"];
        var apiToken = _configuration["Jira:ApiToken"];

        if (string.IsNullOrEmpty(baseUrl) || string.IsNullOrEmpty(email) || string.IsNullOrEmpty(apiToken))
        {
            _logger.LogWarning("JIRA not configured, skipping ticket update for {TicketId}", ticketId);
            return IntegrationResult<JiraTicketResult>.Fail("JIRA not configured");
        }

        try
        {
            _logger.LogInformation("Updating JIRA ticket {TicketId}", ticketId);

            var httpClient = _httpClientFactory.CreateClient();
            var authBytes = Encoding.UTF8.GetBytes($"{email}:{apiToken}");
            httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Basic", Convert.ToBase64String(authBytes));

            if (!string.IsNullOrEmpty(update.Comment))
            {
                var commentPayload = new
                {
                    body = new
                    {
                        type = "doc",
                        version = 1,
                        content = new[]
                        {
                            new
                            {
                                type = "paragraph",
                                content = new object[]
                                {
                                    new { type = "text", text = update.Comment }
                                }
                            }
                        }
                    }
                };
                var commentResponse = await httpClient.PostAsJsonAsync(
                    $"{baseUrl}/rest/api/3/issue/{ticketId}/comment", commentPayload);
                commentResponse.EnsureSuccessStatusCode();
            }

            var result = new JiraTicketResult { Success = true, TicketKey = ticketId };
            return IntegrationResult<JiraTicketResult>.Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update JIRA ticket {TicketId}", ticketId);
            return IntegrationResult<JiraTicketResult>.Fail(ex.Message);
        }
    }

    public async Task<IntegrationResult<JiraTicket?>> GetJiraTicketAsync(string ticketId)
    {
        var baseUrl = _configuration["Jira:BaseUrl"];
        var email = _configuration["Jira:Email"];
        var apiToken = _configuration["Jira:ApiToken"];

        if (string.IsNullOrEmpty(baseUrl) || string.IsNullOrEmpty(email) || string.IsNullOrEmpty(apiToken))
        {
            _logger.LogWarning("JIRA not configured, cannot fetch ticket {TicketId}", ticketId);
            return IntegrationResult<JiraTicket?>.Fail("JIRA not configured");
        }

        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            var authBytes = Encoding.UTF8.GetBytes($"{email}:{apiToken}");
            httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Basic", Convert.ToBase64String(authBytes));

            var response = await httpClient.GetAsync(
                $"{baseUrl}/rest/api/3/issue/{ticketId}");
            response.EnsureSuccessStatusCode();

            var data = await response.Content.ReadFromJsonAsync<JsonElement>();
            var fields = data.GetProperty("fields");

            var ticket = new JiraTicket
            {
                Id = data.GetProperty("id").GetString() ?? "",
                Key = data.GetProperty("key").GetString() ?? ticketId,
                Summary = fields.GetProperty("summary").GetString() ?? "",
                Description = fields.TryGetProperty("description", out var desc) && desc.ValueKind != JsonValueKind.Null
                    ? desc.ToString() : "",
                Status = fields.GetProperty("status").GetProperty("name").GetString() ?? "",
                Priority = fields.TryGetProperty("priority", out var pri) && pri.ValueKind != JsonValueKind.Null
                    ? pri.GetProperty("name").GetString() ?? "" : ""
            };
            return IntegrationResult<JiraTicket?>.Ok(ticket);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get JIRA ticket {TicketId}", ticketId);
            return IntegrationResult<JiraTicket?>.Fail(ex.Message);
        }
    }
}
