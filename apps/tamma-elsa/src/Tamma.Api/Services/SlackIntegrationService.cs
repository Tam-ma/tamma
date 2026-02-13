using System.Net.Http.Json;
using Tamma.Core.Interfaces;

namespace Tamma.Api.Services;

/// <summary>
/// Slack integration service — sends channel and direct messages via webhook.
/// </summary>
public class SlackIntegrationService : ISlackIntegrationService
{
    private readonly ILogger<SlackIntegrationService> _logger;
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClientFactory;

    public SlackIntegrationService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<SlackIntegrationService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<IntegrationResult<bool>> SendSlackMessageAsync(string channel, string message)
    {
        var webhookUrl = _configuration["Slack:WebhookUrl"];
        if (string.IsNullOrEmpty(webhookUrl))
        {
            _logger.LogWarning("Slack webhook URL not configured");
            return IntegrationResult<bool>.Fail("Slack webhook URL not configured");
        }

        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            var payload = new { channel, text = message };
            var response = await httpClient.PostAsJsonAsync(webhookUrl, payload);
            response.EnsureSuccessStatusCode();
            _logger.LogInformation("Sent Slack message to channel {Channel}", channel);
            return IntegrationResult<bool>.Ok(true);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send Slack message to {Channel}", channel);
            return IntegrationResult<bool>.Fail(ex.Message);
        }
    }

    public async Task<IntegrationResult<bool>> SendSlackDirectMessageAsync(string userId, string message)
    {
        var webhookUrl = _configuration["Slack:WebhookUrl"];
        if (string.IsNullOrEmpty(webhookUrl))
        {
            _logger.LogWarning("Slack webhook URL not configured");
            return IntegrationResult<bool>.Fail("Slack webhook URL not configured");
        }

        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            var payload = new { channel = $"@{userId}", text = message };
            var response = await httpClient.PostAsJsonAsync(webhookUrl, payload);
            response.EnsureSuccessStatusCode();
            _logger.LogInformation("Sent Slack DM to user {UserId}", userId);
            return IntegrationResult<bool>.Ok(true);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send Slack DM to {UserId}", userId);
            return IntegrationResult<bool>.Fail(ex.Message);
        }
    }
}
