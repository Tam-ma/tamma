using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tamma.Data.Migrations.Tenant
{
    /// <inheritdoc />
    public partial class AddProjectAutomationMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AutomationMode",
                table: "projects",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "off");

            migrationBuilder.AddCheckConstraint(
                name: "ck_projects_automation_mode",
                table: "projects",
                sql: "\"AutomationMode\" IN ('off','assist','auto')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_projects_automation_mode",
                table: "projects");

            migrationBuilder.DropColumn(
                name: "AutomationMode",
                table: "projects");
        }
    }
}
