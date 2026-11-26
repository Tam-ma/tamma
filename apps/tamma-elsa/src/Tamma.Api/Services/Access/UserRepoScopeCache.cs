using System.Collections.Concurrent;

namespace Tamma.Api.Services.Access;

/// <summary>
/// Story 39-20 (D6) — in-memory <see cref="IUserRepoScopeCache"/> mirroring
/// <c>EntitlementSnapshotCache</c> (<see cref="ConcurrentDictionary{TKey,TValue}"/>
/// + <see cref="TimeProvider"/> TTL, default 60s). Every team/grant/visibility
/// mutation in this story calls <see cref="InvalidateTenant"/>; external
/// <c>OrgEndpoints</c> membership changes are bounded by the TTL.
/// </summary>
public sealed class UserRepoScopeCache : IUserRepoScopeCache
{
    public static readonly TimeSpan DefaultTtl = TimeSpan.FromSeconds(60);

    private readonly ConcurrentDictionary<(Guid TenantId, Guid UserId), Entry> _entries = new();
    private readonly TimeProvider _time;
    private readonly TimeSpan _ttl;

    private readonly record struct Entry(UserRepoScope Value, DateTimeOffset ExpiresAt);

    public UserRepoScopeCache(TimeProvider time)
        : this(time, DefaultTtl)
    {
    }

    public UserRepoScopeCache(TimeProvider time, TimeSpan ttl)
    {
        _time = time ?? throw new ArgumentNullException(nameof(time));
        if (ttl <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(ttl), ttl, "TTL must be positive.");
        _ttl = ttl;
    }

    public int Count => _entries.Count;

    public UserRepoScope? TryGet(Guid tenantId, Guid userId)
    {
        var key = (tenantId, userId);
        if (!_entries.TryGetValue(key, out var entry))
            return null;

        if (_time.GetUtcNow() >= entry.ExpiresAt)
        {
            _entries.TryRemove(new KeyValuePair<(Guid, Guid), Entry>(key, entry));
            return null;
        }

        return entry.Value;
    }

    public void Set(UserRepoScope scope)
    {
        ArgumentNullException.ThrowIfNull(scope);
        _entries[(scope.TenantId, scope.UserId)] = new Entry(scope, _time.GetUtcNow().Add(_ttl));
    }

    public void InvalidateTenant(Guid tenantId)
    {
        foreach (var key in _entries.Keys)
        {
            if (key.TenantId == tenantId)
                _entries.TryRemove(key, out _);
        }
    }

    public void InvalidateUser(Guid tenantId, Guid userId)
        => _entries.TryRemove((tenantId, userId), out _);

    public void Flush() => _entries.Clear();
}
