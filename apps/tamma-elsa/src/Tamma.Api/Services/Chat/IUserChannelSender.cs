using Microsoft.AspNetCore.SignalR;
using Tamma.Api.Hubs;
using Tamma.Core.Documents.Channels;

namespace Tamma.Api.Services.Chat;

/// <summary>
/// Story 39-19 (D1 / D4) — narrow seam pushing a <see cref="ChannelEnvelope"/>
/// to a single dashboard user's SignalR group (<c>user:{tenantId}:{userId}</c>).
/// Keeps <see cref="OrchestratorChatService"/> unit-testable without an ASP.NET
/// SignalR host while targeting Story 39-18's <see cref="UserChannelHub"/> in production.
/// </summary>
public interface IUserChannelSender
{
    Task SendToUserAsync(Guid tenantId, Guid userId, ChannelEnvelope envelope, CancellationToken ct = default);
}

/// <summary>Production SignalR sender targeting <see cref="UserChannelHub"/>.</summary>
public sealed class SignalRUserChannelSender : IUserChannelSender
{
    private readonly IHubContext<UserChannelHub, IUserChannelClient> _hub;

    public SignalRUserChannelSender(IHubContext<UserChannelHub, IUserChannelClient> hub)
    {
        _hub = hub ?? throw new ArgumentNullException(nameof(hub));
    }

    public Task SendToUserAsync(Guid tenantId, Guid userId, ChannelEnvelope envelope, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        return _hub.Clients
            .Group(UserChannelHub.UserGroupFor(tenantId, userId))
            .Receive(envelope);
    }
}
