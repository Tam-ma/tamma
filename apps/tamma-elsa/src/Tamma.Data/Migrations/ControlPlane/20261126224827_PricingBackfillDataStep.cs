using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tamma.Data.Migrations.ControlPlane
{
    /// <summary>
    /// Story 34-10 (AC1, AC2, AC7, AC9) — idempotent, data-only control-plane
    /// backfill converting legacy <c>plans."Quotas"</c> JSONB into structured
    /// <c>plan_entitlements</c> rows and guaranteeing every non-deleted tenant
    /// has an <c>active</c> <c>tenant_plan_assignments</c> row.
    ///
    /// <para>All inserts carry <c>NOT EXISTS</c> guards so re-applying is a
    /// verified no-op. No DDL changes.</para>
    /// </summary>
    public partial class PricingBackfillDataStep : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1a. Legacy Plan.Quotas llmTokensPerMonth -> plan_entitlements ('llm_tokens').
            //     -1 sentinel becomes NULL (unlimited). Insert-missing-only.
            migrationBuilder.Sql(@"
INSERT INTO plan_entitlements (""Id"", ""PlanId"", ""MetricKey"", ""LimitValue"", ""Period"", ""OverageMode"")
SELECT gen_random_uuid(),
       p.""Id"",
       'llm_tokens',
       NULLIF((p.""Quotas""->>'llmTokensPerMonth')::bigint, -1),
       'monthly',
       'block'
FROM plans p
WHERE p.""Quotas"" IS NOT NULL
  AND jsonb_typeof(p.""Quotas"") = 'object'
  AND (p.""Quotas"" ? 'llmTokensPerMonth')
  AND jsonb_typeof(p.""Quotas""->'llmTokensPerMonth') IN ('number', 'null')
  AND NOT EXISTS (
      SELECT 1 FROM plan_entitlements e
      WHERE e.""PlanId"" = p.""Id"" AND e.""MetricKey"" = 'llm_tokens'
  );
");

            // 1b. Legacy Plan.Quotas seats -> plan_entitlements ('seats').
            //     -1 sentinel becomes NULL (unlimited). concurrentWorkflows is intentionally not mapped.
            migrationBuilder.Sql(@"
INSERT INTO plan_entitlements (""Id"", ""PlanId"", ""MetricKey"", ""LimitValue"", ""Period"", ""OverageMode"")
SELECT gen_random_uuid(),
       p.""Id"",
       'seats',
       NULLIF((p.""Quotas""->>'seats')::bigint, -1),
       'total',
       'block'
FROM plans p
WHERE p.""Quotas"" IS NOT NULL
  AND jsonb_typeof(p.""Quotas"") = 'object'
  AND (p.""Quotas"" ? 'seats')
  AND jsonb_typeof(p.""Quotas""->'seats') IN ('number', 'null')
  AND NOT EXISTS (
      SELECT 1 FROM plan_entitlements e
      WHERE e.""PlanId"" = p.""Id"" AND e.""MetricKey"" = 'seats'
  );
");

            // 2. One active tenant_plan_assignment per non-deleted tenant (NOT EXISTS guarded).
            //    Resolution order: Tenant.PlanId shadow -> active Plan matching Tenant.Plan slug -> active 'free' plan.
            migrationBuilder.Sql(@"
INSERT INTO tenant_plan_assignments
  (""Id"", ""TenantId"", ""PlanId"", ""PlanVersion"", ""Status"", ""EffectiveFrom"",
   ""AssignedByUserId"", ""Reason"", ""CreatedAt"", ""UpdatedAt"")
SELECT gen_random_uuid(),
       t.""Id"",
       COALESCE(p.""Id"", s.""Id"", f.""Id""),
       COALESCE(p.""Version"", s.""Version"", f.""Version"", 1),
       'active',
       now(),
       NULL,
       'backfill: 34-10',
       now(),
       now()
FROM tenants t
LEFT JOIN plans p ON p.""Id"" = t.""PlanId""
LEFT JOIN plans s ON s.""Slug"" = t.""Plan"" AND s.""Status"" = 'active'
LEFT JOIN plans f ON f.""Slug"" = 'free' AND f.""Status"" = 'active'
WHERE t.""DeletedAt"" IS NULL
  AND COALESCE(p.""Id"", s.""Id"", f.""Id"") IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM tenant_plan_assignments a
      WHERE a.""TenantId"" = t.""Id"" AND a.""Status"" = 'active'
  );
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Pre-production rollback: remove only backfill-stamped assignments;
            // structured plan_entitlements are owned by PlansSeeder / Story 34-1.
            migrationBuilder.Sql(
                @"DELETE FROM tenant_plan_assignments WHERE ""Reason"" = 'backfill: 34-10';");
        }
    }
}
