using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tamma.Data.Migrations.ControlPlane
{
    /// <inheritdoc />
    public partial class BillingInvoicesAndDunning : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "billing_dunning_states",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Stage = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "active"),
                    FailedAttempts = table.Column<int>(type: "integer", nullable: false),
                    CurrentInvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    LastObservedAttemptCount = table.Column<int>(type: "integer", nullable: false),
                    StageEnteredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    NextAdvanceAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PendingAdvanceTaskId = table.Column<Guid>(type: "uuid", nullable: true),
                    SuspendedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_billing_dunning_states", x => x.Id);
                    table.CheckConstraint("ck_billing_dunning_states_stage", "\"Stage\" IN ('active','past_due','grace','suspended','flagged')");
                    table.ForeignKey(
                        name: "FK_billing_dunning_states_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "billing_invoices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    StripeInvoiceId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    StripeSubscriptionId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "draft"),
                    AmountDue = table.Column<long>(type: "bigint", nullable: false),
                    AmountPaid = table.Column<long>(type: "bigint", nullable: false),
                    AmountRemaining = table.Column<long>(type: "bigint", nullable: false),
                    Currency = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValue: "usd"),
                    HostedInvoiceUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    PdfUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    PeriodStart = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PeriodEnd = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AttemptCount = table.Column<int>(type: "integer", nullable: false),
                    NextPaymentAttempt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDisputed = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    FinalizedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PaidAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_billing_invoices", x => x.Id);
                    table.CheckConstraint("ck_billing_invoices_status", "\"Status\" IN ('draft','open','paid','uncollectible','void')");
                    table.ForeignKey(
                        name: "FK_billing_invoices_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "billing_invoice_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "base"),
                    Description = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    Quantity = table.Column<long>(type: "bigint", nullable: false),
                    UnitAmount = table.Column<long>(type: "bigint", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    Currency = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValue: "usd")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_billing_invoice_lines", x => x.Id);
                    table.CheckConstraint("ck_billing_invoice_lines_kind", "\"Kind\" IN ('base','metered_overage','credit')");
                    table.ForeignKey(
                        name: "FK_billing_invoice_lines_billing_invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "billing_invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_billing_dunning_states_tenant_id",
                table: "billing_dunning_states",
                column: "TenantId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_billing_invoice_lines_invoice_id",
                table: "billing_invoice_lines",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_billing_invoices_stripe_invoice_id",
                table: "billing_invoices",
                column: "StripeInvoiceId",
                unique: true,
                filter: "\"StripeInvoiceId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_billing_invoices_tenant_created",
                table: "billing_invoices",
                columns: new[] { "TenantId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "billing_dunning_states");

            migrationBuilder.DropTable(
                name: "billing_invoice_lines");

            migrationBuilder.DropTable(
                name: "billing_invoices");
        }
    }
}
