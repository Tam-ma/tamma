using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using NUnit.Framework;
using Tamma.Api.Services.LocalExport;
using Tamma.Data;
using Tamma.Data.Entities;

namespace Tamma.Api.Tests.Services.LocalExport;

[TestFixture]
public sealed class LocalExportCommandTests
{
    [Test]
    public async Task Saas_mode_fails_before_key_or_database_access()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Tamma:Mode"] = "saas",
            ["Tamma:TenantSharedSecret"] = LocalExportTestFixture.TokenCanary,
        }).Build();
        var originalError = Console.Error;
        await using var error = new StringWriter();
        Console.SetError(error);
        try
        {
            var exit = await LocalExportCommand.RunAsync(configuration, ["export-local"]);
            exit.Should().Be(1);
            error.ToString().Should().Contain("EXPORT.MODE.SAAS")
                .And.NotContain(LocalExportTestFixture.TokenCanary);
        }
        finally
        {
            Console.SetError(originalError);
        }
    }

    [Test]
    public async Task Missing_sole_user_is_rejected()
    {
        await using var db = CreateContext();
        var act = () => EfLocalExportSource.ResolveOwnerAsync(db, EmptyConfiguration(), CancellationToken.None);
        await act.Should().ThrowAsync<LocalExportException>()
            .Where(ex => ex.Code == "EXPORT.OWNER.AMBIGUOUS");
    }

    [Test]
    public async Task Multiple_users_without_explicit_owner_are_rejected()
    {
        await using var db = CreateContext();
        db.Users.AddRange(User(LocalExportTestFixture.UserId), User(Guid.NewGuid()));
        await db.SaveChangesAsync();
        var act = () => EfLocalExportSource.ResolveOwnerAsync(db, EmptyConfiguration(), CancellationToken.None);
        await act.Should().ThrowAsync<LocalExportException>()
            .Where(ex => ex.Code == "EXPORT.OWNER.AMBIGUOUS");
    }

    [Test]
    public async Task Personal_tenant_requires_owner_membership()
    {
        await using var db = CreateContext();
        var user = User(LocalExportTestFixture.UserId);
        var tenant = Tenant(LocalExportTestFixture.TenantId, user.Id);
        db.Users.Add(user);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();
        var act = () => EfLocalExportSource.ResolveOwnerAsync(db, EmptyConfiguration(), CancellationToken.None);
        await act.Should().ThrowAsync<LocalExportException>()
            .Where(ex => ex.Code == "EXPORT.OWNERSHIP.INVALID");
    }

    [Test]
    public async Task Multiple_personal_tenants_are_rejected()
    {
        await using var db = CreateContext();
        var user = User(LocalExportTestFixture.UserId);
        db.Users.Add(user);
        db.Tenants.AddRange(
            Tenant(LocalExportTestFixture.TenantId, user.Id),
            Tenant(Guid.NewGuid(), user.Id));
        await db.SaveChangesAsync();
        var act = () => EfLocalExportSource.ResolveOwnerAsync(db, EmptyConfiguration(), CancellationToken.None);
        await act.Should().ThrowAsync<LocalExportException>()
            .Where(ex => ex.Code == "EXPORT.TENANT.AMBIGUOUS");
    }

    [Test]
    public async Task Verified_user_personal_tenant_and_owner_membership_resolve()
    {
        await using var db = CreateContext();
        var user = User(LocalExportTestFixture.UserId);
        user.TenantId = LocalExportTestFixture.TenantId;
        var tenant = Tenant(LocalExportTestFixture.TenantId, user.Id);
        db.Users.Add(user);
        db.Tenants.Add(tenant);
        db.TenantMemberships.Add(new TenantMembership
        {
            Id = Guid.NewGuid(), UserId = user.Id, TenantId = tenant.Id, Role = "owner",
        });
        await db.SaveChangesAsync();

        var result = await EfLocalExportSource.ResolveOwnerAsync(
            db, EmptyConfiguration(), CancellationToken.None);
        result.User.Id.Should().Be(user.Id);
        result.Tenant.Id.Should().Be(tenant.Id);
    }

    private static ControlPlaneDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase($"local-export-{Guid.NewGuid():N}")
            .Options;
        return new ControlPlaneDbContext(options);
    }

    private static IConfiguration EmptyConfiguration() => new ConfigurationBuilder().Build();

    private static User User(Guid id) => new()
    {
        Id = id,
        Email = $"{id:N}@example.test",
        IsActive = true,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Tenant Tenant(Guid id, Guid ownerId) => new()
    {
        Id = id,
        OwnerId = ownerId,
        Type = "personal",
        Name = "Local",
        Slug = $"u-{id:N}",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };
}
