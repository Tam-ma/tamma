using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tamma.Data.Migrations.ControlPlane
{
    /// <inheritdoc />
    public partial class AddBillingUsageRollup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "ByokTokensIn",
                table: "platform_analytics_hourly",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "ByokTokensOut",
                table: "platform_analytics_hourly",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "PlatformTokensIn",
                table: "platform_analytics_hourly",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "PlatformTokensOut",
                table: "platform_analytics_hourly",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "billing_meter_event_buffer",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    StripeCustomerId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    EventName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    BillingMode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "platform"),
                    Value = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    PeriodStart = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EventTimestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReportedToStripe = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    StripeEventId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    LastAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AttemptCount = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    LastError = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_billing_meter_event_buffer", x => x.Id);
                    table.CheckConstraint("ck_billing_meter_event_buffer_billing_mode", "\"BillingMode\" IN ('platform','byok')");
                    table.ForeignKey(
                        name: "FK_billing_meter_event_buffer_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "billing_usage_rollup",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    PeriodStart = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PeriodEnd = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PlatformInputTokens = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    PlatformOutputTokens = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    ByokInputTokens = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    ByokOutputTokens = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    PlatformCostUsd = table.Column<decimal>(type: "numeric(20,4)", precision: 20, scale: 4, nullable: false, defaultValue: 0m),
                    BillableAmountUsd = table.Column<decimal>(type: "numeric(20,4)", precision: 20, scale: 4, nullable: false, defaultValue: 0m),
                    Seats = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    LastSourceCursor = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_billing_usage_rollup", x => x.Id);
                    table.ForeignKey(
                        name: "FK_billing_usage_rollup_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_billing_meter_event_buffer_Pending",
                table: "billing_meter_event_buffer",
                column: "CreatedAt",
                filter: "\"ReportedToStripe\" = FALSE");

            migrationBuilder.CreateIndex(
                name: "IX_billing_meter_event_buffer_TenantId_PeriodStart_EventName",
                table: "billing_meter_event_buffer",
                columns: new[] { "TenantId", "PeriodStart", "EventName" });

            migrationBuilder.CreateIndex(
                name: "UX_billing_meter_event_buffer_IdempotencyKey",
                table: "billing_meter_event_buffer",
                column: "IdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_billing_usage_rollup_TenantId_PeriodStart",
                table: "billing_usage_rollup",
                columns: new[] { "TenantId", "PeriodStart" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "billing_meter_event_buffer");

            migrationBuilder.DropTable(
                name: "billing_usage_rollup");

            migrationBuilder.DropColumn(
                name: "ByokTokensIn",
                table: "platform_analytics_hourly");

            migrationBuilder.DropColumn(
                name: "ByokTokensOut",
                table: "platform_analytics_hourly");

            migrationBuilder.DropColumn(
                name: "PlatformTokensIn",
                table: "platform_analytics_hourly");

            migrationBuilder.DropColumn(
                name: "PlatformTokensOut",
                table: "platform_analytics_hourly");
        }
    }
}
