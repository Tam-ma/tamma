using Tamma.Core.Interfaces;

namespace Tamma.Api.Services;

/// <summary>
/// Email integration service — sends email notifications.
/// </summary>
public class EmailIntegrationService : IEmailIntegrationService
{
    private readonly ILogger<EmailIntegrationService> _logger;
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClientFactory;

    public EmailIntegrationService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<EmailIntegrationService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<IntegrationResult<bool>> SendEmailAsync(string to, string subject, string body)
    {
        _logger.LogInformation("Would send email to {To}: {Subject}", to, subject);
        // TODO: Implement email sending (SendGrid, AWS SES, etc.)
        await Task.CompletedTask;
        return IntegrationResult<bool>.Ok(true);
    }
}
