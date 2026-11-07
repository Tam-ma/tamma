using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tamma.Data.Migrations.ControlPlane
{
    /// <inheritdoc />
    public partial class AddAgentRunWaits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "agent_run_waits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: true),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Repository = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    BranchName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    SessionId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    InstallationId = table.Column<long>(type: "bigint", nullable: true),
                    WorkflowInstanceId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    BookmarkName = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    BookmarkTenantId = table.Column<Guid>(type: "uuid", nullable: true),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValue: "pending"),
                    WorkflowRunId = table.Column<long>(type: "bigint", nullable: true),
                    DispatchedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_run_waits", x => x.Id);
                    table.CheckConstraint("ck_agent_run_waits_principal_xor", "(\"UserId\" IS NOT NULL AND \"TenantId\" IS NULL) OR (\"UserId\" IS NULL AND \"TenantId\" IS NOT NULL)");
                    table.CheckConstraint("ck_agent_run_waits_status", "\"Status\" IN ('pending','received','timed_out')");
                });

            migrationBuilder.CreateIndex(
                name: "IX_agent_run_waits_match",
                table: "agent_run_waits",
                columns: new[] { "InstallationId", "Repository", "BranchName", "Status" });

            migrationBuilder.CreateIndex(
                name: "UX_agent_run_waits_principal_run",
                table: "agent_run_waits",
                columns: new[] { "TenantId", "UserId", "Repository", "BranchName", "SessionId" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_run_waits");
        }
    }
}
