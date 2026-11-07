using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tamma.Data.Migrations.ControlPlane
{
    /// <summary>
    /// Story 43-6 (2026-11-07) — a group-scope row may carry NO threshold, so
    /// PUT /api/actions/policy/groups/{group}/enforce can store an enforce-only
    /// opinion without re-levelling the group. Mode rows still must be NULL;
    /// action rows still must be NOT NULL.
    /// </summary>
    public partial class RelaxGroupRowThreshold : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_action_assignments_mode_row",
                table: "action_assignments");

            migrationBuilder.AddCheckConstraint(
                name: "ck_action_assignments_mode_row",
                table: "action_assignments",
                sql: "(\"TargetKind\" = 'mode' AND \"MinAutonomy\" IS NULL) OR (\"TargetKind\" = 'action' AND \"MinAutonomy\" IS NOT NULL) OR \"TargetKind\" = 'group'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The old CHECK cannot hold a threshold-less group row; drop them
            // (an enforce-only group opinion) rather than invent a threshold.
            migrationBuilder.Sql(
                "DELETE FROM action_assignments WHERE \"TargetKind\" = 'group' AND \"MinAutonomy\" IS NULL;");

            migrationBuilder.DropCheckConstraint(
                name: "ck_action_assignments_mode_row",
                table: "action_assignments");

            migrationBuilder.AddCheckConstraint(
                name: "ck_action_assignments_mode_row",
                table: "action_assignments",
                sql: "(\"TargetKind\" = 'mode') = (\"MinAutonomy\" IS NULL)");
        }
    }
}
