using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tamma.Data.Migrations.ControlPlane
{
    /// <summary>
    /// Story 43-18 (AC1) — <c>action_level_overrides</c>: platform-scope
    /// overrides of the catalog's shipped zone table
    /// (<c>ActionDescriptor.DefaultMinAutonomy</c>).
    ///
    /// <para><b>Why raw idempotent SQL instead of <c>CreateTable</c></b>
    /// (identical survival pattern to <see cref="AddActionGovernance"/>):
    /// <c>action_level_overrides</c> is deliberately EXCLUDED from the
    /// destructive startup DROP list in <c>Tamma.Api/Program.cs</c> so operator
    /// level overrides survive redeploys, while <c>__ControlPlaneMigrationsHistory</c>
    /// is rebuilt. Re-running this migration against an existing table must be
    /// <c>IF NOT EXISTS</c>-idempotent.</para>
    ///
    /// <para><b>No FK to <c>tenants</c>/<c>users</c></b> — those tables are wiped
    /// on restart, and a CASCADE would delete surviving overrides.</para>
    ///
    /// <para><b>No numeric CHECK on <c>Level</c></b> — deliberate (AC1, mirroring
    /// Story 43-5 AC3/D5): validation of the detent range and consequence floor
    /// lives domain-side in <c>ActionLevelOverrideValidator</c>.</para>
    /// </summary>
    public partial class AddActionLevelOverrides : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TABLE IF NOT EXISTS action_level_overrides (
                    "Id" uuid NOT NULL DEFAULT gen_random_uuid(),
                    "ActionKey" character varying(200) NOT NULL,
                    "Level" integer NOT NULL,
                    "Note" character varying(500) NULL,
                    "Version" integer NOT NULL DEFAULT 1,
                    "CreatedBy" uuid NULL,
                    "UpdatedBy" uuid NULL,
                    "CreatedAt" timestamp with time zone NOT NULL DEFAULT now(),
                    "UpdatedAt" timestamp with time zone NOT NULL DEFAULT now(),
                    CONSTRAINT "PK_action_level_overrides" PRIMARY KEY ("Id")
                );

                CREATE UNIQUE INDEX IF NOT EXISTS ux_action_level_overrides_action_key
                    ON action_level_overrides ("ActionKey");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS action_level_overrides;");
        }
    }
}
