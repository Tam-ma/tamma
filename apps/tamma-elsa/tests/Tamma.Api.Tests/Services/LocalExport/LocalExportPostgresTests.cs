using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using NUnit.Framework;
using Tamma.Api.Services.LocalExport;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Entities;
using Tamma.Data.Pooling;
using Testcontainers.PostgreSql;

namespace Tamma.Api.Tests.Services.LocalExport;

[TestFixture]
[Category("Integration")]
public sealed class LocalExportPostgresTests
{
    private PostgreSqlContainer _postgres = null!;
    private string _controlPlaneConnection = null!;
    private string _tenantConnection = null!;
    private string _schema = null!;

    [OneTimeSetUp]
    public async Task SetUpFixture()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("local_export_test")
            .WithUsername("tamma")
            .WithPassword("tamma")
            .Build();
        await _postgres.StartAsync();
        _controlPlaneConnection = _postgres.GetConnectionString();
        _schema = TenantNaming.SchemaName(LocalExportTestFixture.TenantId);
        _tenantConnection = new NpgsqlConnectionStringBuilder(_controlPlaneConnection)
        {
            SearchPath = _schema,
        }.ConnectionString;

        await using (var cp = CreateControlPlane())
        {
            await cp.Database.MigrateAsync();
        }
        await new EfTenantDbMigrator().MigrateTenantAppAsync(_tenantConnection);
        await SeedAsync();
        NpgsqlConnection.ClearAllPools();
    }

    [OneTimeTearDown]
    public async Task TearDownFixture()
    {
        NpgsqlConnection.ClearAllPools();
        await _postgres.DisposeAsync();
    }

    [Test]
    public async Task Capture_preserves_order_lineage_and_both_planes_without_source_writes()
    {
        var source = new EfLocalExportSource(
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Tamma:Mode"] = "single-user",
            }).Build(),
            new ControlPlaneFactory(_controlPlaneConnection),
            new TenantFactory(_tenantConnection, _schema));

        var capture = await source.CaptureAsync(CancellationToken.None);

        capture.User["id"]!.GetValue<string>().Should().Be(LocalExportTestFixture.UserId.ToString());
        capture.Tenant["id"]!.GetValue<string>().Should().Be(LocalExportTestFixture.TenantId.ToString());
        var datasets = capture.Datasets.ToDictionary(d => d.Name, StringComparer.Ordinal);
        datasets["tenant.domain_events"].Rows.Select(r => r.Payload["sequenceNumber"]!.GetValue<long>())
            .Should().BeInAscendingOrder().And.HaveCount(2);
        datasets["tenant.documents"].Rows.Should().ContainSingle()
            .Which.Payload["correlatingEventId"]!.GetValue<string>().Should()
            .Be(datasets["tenant.domain_events"].Rows[0].Id);
        datasets["control_plane.action_assignments"].Rows.Should().ContainSingle();
        datasets["control_plane.action_authorizations"].Rows.Should().ContainSingle();
        datasets["control_plane.provider_settings"].Rows.Should().ContainSingle();
        datasets["tenant.workflow_instances"].Rows.Should().ContainSingle()
            .Which.Payload["definitionId"]!.GetValue<string>().Should()
            .Be(datasets["tenant.workflow_definitions"].Rows[0].Id);

        var exportedText = string.Join('\n', capture.Datasets.SelectMany(d => d.Rows)
            .Select(r => r.Payload.ToJsonString()).Concat([capture.User.ToJsonString(), capture.Tenant.ToJsonString()]));
        exportedText.Should().NotContain(LocalExportTestFixture.TokenCanary)
            .And.NotContain(LocalExportTestFixture.PasswordCanary)
            .And.NotContain(LocalExportTestFixture.ConnectionCanary)
            .And.Contain("reauthorize");

        await using var cp = CreateControlPlane();
        await using var tenant = await new TenantFactory(_tenantConnection, _schema)
            .CreateAsync(LocalExportTestFixture.TenantId);
        (await cp.Users.CountAsync()).Should().Be(1);
        (await cp.Tenants.CountAsync()).Should().Be(1);
        (await cp.ActionAssignments.CountAsync()).Should().Be(1);
        (await tenant.DomainEvents.CountAsync()).Should().Be(2);
        (await tenant.Documents.CountAsync()).Should().Be(1);
        (await tenant.DomainEvents.OrderBy(e => e.SequenceNumber).FirstAsync()).Data
            .Should().Contain(LocalExportTestFixture.TokenCanary);
        (await tenant.Conventions.SingleAsync()).Body.Should().Contain(LocalExportTestFixture.PasswordCanary);
    }

    private async Task SeedAsync()
    {
        var now = new DateTime(2026, 11, 28, 0, 0, 0, DateTimeKind.Utc);
        var user = new User
        {
            Id = LocalExportTestFixture.UserId,
            Email = "local@example.test",
            IsActive = true,
            Settings = $"{{\"token\":\"{LocalExportTestFixture.TokenCanary}\",\"theme\":\"dark\"}}",
            CreatedAt = now,
            UpdatedAt = now,
        };
        var tenant = new Tenant
        {
            Id = LocalExportTestFixture.TenantId,
            OwnerId = user.Id,
            Type = "personal",
            Name = "Local",
            Slug = "u-local",
            Settings = "{}",
            CreatedAt = now,
            UpdatedAt = now,
        };
        await using (var cp = CreateControlPlane())
        {
            cp.Users.Add(user);
            cp.Tenants.Add(tenant);
            cp.TenantMemberships.Add(new TenantMembership
            {
                Id = Guid.NewGuid(), UserId = user.Id, TenantId = tenant.Id, Role = "owner", JoinedAt = now,
            });
            cp.ActionAssignments.Add(new ActionAssignment
            {
                Id = Guid.NewGuid(), UserId = user.Id, TargetKind = "action", TargetKey = "tool:file_read",
                MinAutonomy = 5, Version = 1, Note = $"password={LocalExportTestFixture.PasswordCanary}",
                CreatedAt = now, UpdatedAt = now,
            });
            cp.ActionAuthorizations.Add(new ActionAuthorization
            {
                Id = Guid.NewGuid(), UserId = user.Id, CorrelationId = "correlation", TargetKind = "action",
                TargetKey = "tool:file_read", State = "granted", Scope = "single-use", RequestedAtUtc = now,
                Reason = $"token={LocalExportTestFixture.TokenCanary}",
            });
            cp.ProviderSettings.Add(new ProviderSetting
            {
                Id = Guid.NewGuid(), UserId = user.Id, Scope = "principal", ProviderKey = "anthropic",
                DefaultModel = "claude-sonnet", Enabled = true, UpdatedAt = now,
            });
            await cp.SaveChangesAsync();
            user.TenantId = tenant.Id;
            await cp.SaveChangesAsync();
        }

        var definitionId = Guid.NewGuid();
        var firstEventId = Guid.NewGuid();
        await using var db = await new TenantFactory(_tenantConnection, _schema).CreateAsync(tenant.Id);
        db.DomainEvents.AddRange(
            new DomainEvent
            {
                Id = firstEventId, TenantId = tenant.Id, Type = "DOCUMENT.CREATED", IssueNumber = 47,
                Tags = "{}", Metadata = "{}",
                Data = $"{{\"nested\":{{\"token\":\"{LocalExportTestFixture.TokenCanary}\"}},\"safe\":\"kept\"}}",
                CreatedAt = now,
            },
            new DomainEvent
            {
                Id = Guid.NewGuid(), TenantId = tenant.Id, Type = "DOCUMENT.ACCEPTED", IssueNumber = 47,
                Tags = "{}", Metadata = "{}", Data = "{}", CreatedAt = now,
            });
        var documentId = Guid.NewGuid();
        db.Documents.Add(new DocumentInstance
        {
            Id = documentId, TenantId = tenant.Id, DocumentType = "decomposition", IssueId = "47",
            ProducedByRole = "developer", ProducedByAction = "implement-feature", SchemaVersion = 1,
            Revision = 1, Status = "accepted", CorrelatingEventId = firstEventId,
            BodyJson = $"{{\"title\":\"safe\",\"connectionString\":\"{LocalExportTestFixture.ConnectionCanary}\"}}",
            CreatedAt = now, UpdatedAt = now,
        });
        db.Conventions.Add(new Convention
        {
            Id = Guid.NewGuid(), TenantId = tenant.Id, Role = "developer", Action = "implement-feature",
            Body = $"safe password={LocalExportTestFixture.PasswordCanary}", Enabled = true, Version = 1,
            CreatedAt = now, UpdatedAt = now,
        });
        db.BudgetConfigs.Add(new BudgetConfig
        {
            Id = Guid.NewGuid(), TenantId = tenant.Id, AccountId = tenant.Id.ToString(), LimitUsd = 10,
            AlertThreshold = 0.8, PeriodDays = 30, CreatedAt = now, UpdatedAt = now,
        });
        db.PromptOverrides.Add(new PromptOverride
        {
            Id = Guid.NewGuid(), UserId = user.Id, Scope = "role", Role = "developer",
            Action = "implement-feature", Template = "Implement", MaxTokens = 4096, Version = 1,
            CreatedAt = now, UpdatedAt = now,
        });
        db.WorkflowDefinitions.Add(new WorkflowDefinition
        {
            Id = definitionId, TenantId = tenant.Id, Name = "local", Version = 1, Steps = "[]",
            SyncedAt = now, CreatedAt = now, UpdatedAt = now,
        });
        db.WorkflowInstances.Add(new WorkflowInstance
        {
            Id = Guid.NewGuid(), TenantId = tenant.Id, DefinitionId = definitionId, Status = "completed",
            Variables = $"{{\"nested\":{{\"password\":\"{LocalExportTestFixture.PasswordCanary}\"}}}}",
            CreatedAt = now, UpdatedAt = now, StartedAt = now, CompletedAt = now,
        });
        await db.SaveChangesAsync();
    }

    private ControlPlaneDbContext CreateControlPlane() => CreateControlPlaneOptions(_controlPlaneConnection);

    private static ControlPlaneDbContext CreateControlPlaneOptions(string connection)
    {
        var options = new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__ControlPlaneMigrationsHistory"));
        ControlPlaneDbContext.ConfigureControlPlaneWarnings(options);
        return new ControlPlaneDbContext(options.Options);
    }

    private sealed class ControlPlaneFactory(string connection) : IDbContextFactory<ControlPlaneDbContext>
    {
        public ControlPlaneDbContext CreateDbContext() => CreateControlPlaneOptions(connection);
        public Task<ControlPlaneDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());
    }

    private sealed class TenantFactory(string connection, string schema) : ITenantDbContextFactory
    {
        public ValueTask<TenantDbContext> CreateAsync(
            Guid tenantId,
            CancellationToken cancellationToken = default)
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__TenantMigrationsHistory", schema))
                .Options;
            return ValueTask.FromResult(new TenantDbContext(options, tenantId));
        }
    }
}
