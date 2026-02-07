using Microsoft.AspNetCore.Authorization;

namespace Tamma.Api.Infrastructure;

/// <summary>
/// Authorization requirement that always succeeds.
/// Used only in Development mode when JWT is not configured.
/// </summary>
public class AllowAnonymousRequirement : IAuthorizationRequirement
{
}

/// <summary>
/// Handler that always succeeds for AllowAnonymousRequirement.
/// This ensures [Authorize] attributes do not block requests during local development
/// when JWT authentication is not configured.
/// </summary>
public class AllowAnonymousHandler : AuthorizationHandler<AllowAnonymousRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        AllowAnonymousRequirement requirement)
    {
        context.Succeed(requirement);
        return Task.CompletedTask;
    }
}
