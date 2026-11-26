using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tamma.Data.Migrations.ControlPlane
{
    /// <inheritdoc />
    public partial class AddTeamsAndRepoAccess : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "repositories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlatformKind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "github"),
                    RepoFullName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    ExternalId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Visibility = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "tenant"),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_repositories", x => x.Id);
                    table.CheckConstraint("ck_repositories_visibility", "\"Visibility\" IN ('tenant','restricted')");
                    table.ForeignKey(
                        name: "FK_repositories_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "teams",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    DefaultMemberRole = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "member"),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_teams", x => x.Id);
                    table.CheckConstraint("ck_teams_default_member_role", "\"DefaultMemberRole\" IN ('member','maintainer')");
                    table.ForeignKey(
                        name: "FK_teams_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "repo_access_grants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    RepositoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    TeamId = table.Column<Guid>(type: "uuid", nullable: true),
                    AccessLevel = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_repo_access_grants", x => x.Id);
                    table.CheckConstraint("ck_repo_access_grants_grantee_xor", "((\"UserId\" IS NOT NULL AND \"TeamId\" IS NULL) OR (\"UserId\" IS NULL AND \"TeamId\" IS NOT NULL))");
                    table.CheckConstraint("ck_repo_access_grants_level", "\"AccessLevel\" IN ('read','contribute','admin')");
                    table.ForeignKey(
                        name: "FK_repo_access_grants_repositories_RepositoryId",
                        column: x => x.RepositoryId,
                        principalTable: "repositories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_repo_access_grants_teams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "teams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_repo_access_grants_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "team_members",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    TeamId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "member"),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_team_members", x => x.Id);
                    table.CheckConstraint("ck_team_members_role", "\"Role\" IN ('member','maintainer')");
                    table.ForeignKey(
                        name: "FK_team_members_teams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "teams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_team_members_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_repo_access_grants_RepositoryId_UserId_TeamId",
                table: "repo_access_grants",
                columns: new[] { "RepositoryId", "UserId", "TeamId" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_repo_access_grants_TeamId",
                table: "repo_access_grants",
                column: "TeamId");

            migrationBuilder.CreateIndex(
                name: "IX_repo_access_grants_UserId",
                table: "repo_access_grants",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_repositories_TenantId_PlatformKind_RepoFullName",
                table: "repositories",
                columns: new[] { "TenantId", "PlatformKind", "RepoFullName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_repositories_TenantId_RepoFullName",
                table: "repositories",
                columns: new[] { "TenantId", "RepoFullName" });

            migrationBuilder.CreateIndex(
                name: "IX_team_members_TeamId_UserId",
                table: "team_members",
                columns: new[] { "TeamId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_team_members_UserId",
                table: "team_members",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_teams_TenantId",
                table: "teams",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_teams_TenantId_Name",
                table: "teams",
                columns: new[] { "TenantId", "Name" },
                unique: true);

            // Story 39-20 AC2 / D2 — grandfather backfill: seed repositories from existing
            // tenant-linked GitHub installations with Visibility = 'tenant' so existing
            // tenants keep full visibility with zero lockout. Idempotent via ON CONFLICT.
            migrationBuilder.Sql(@"
INSERT INTO repositories (""Id"", ""TenantId"", ""PlatformKind"", ""RepoFullName"", ""ExternalId"", ""Visibility"", ""CreatedAt"", ""UpdatedAt"")
SELECT
    gen_random_uuid(),
    i.""TenantId"",
    'github',
    r.""RepoFullName"",
    r.""RepoId""::text,
    'tenant',
    now(),
    now()
FROM github_installation_repos r
INNER JOIN github_installations i ON i.""Id"" = r.""InstallationEntityId""
WHERE i.""TenantId"" IS NOT NULL
  AND r.""IsActive"" = true
ON CONFLICT (""TenantId"", ""PlatformKind"", ""RepoFullName"") DO NOTHING;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "repo_access_grants");

            migrationBuilder.DropTable(
                name: "team_members");

            migrationBuilder.DropTable(
                name: "repositories");

            migrationBuilder.DropTable(
                name: "teams");
        }
    }
}
