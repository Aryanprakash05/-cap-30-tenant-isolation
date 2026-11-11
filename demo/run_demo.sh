#!/bin/bash
# =============================================================
#  CAP-30 · One-command reproducible demo script
#  Demonstrates tenant isolation end-to-end without the UI.
#  Prerequisites: snowsql CLI, Python 3.11+, and the env vars below.
#
#  Each step connects as the dedicated user for that role. The admin user
#  (ARYAN05) no longer holds any tenant role since sql/01, so it cannot
#  impersonate tenants with USE ROLE any more — that is the point.
#
#  Required env vars (set them in your shell; never paste secrets in chat):
#    SNOWFLAKE_ADMIN_PASSWORD     (ARYAN05)
#    SNOWFLAKE_TENANT_A_PASSWORD  (TENANT_A_USER)
#    SNOWFLAKE_TENANT_B_PASSWORD  (TENANT_B_USER)
#    SNOWFLAKE_SUPPORT_PASSWORD   (SUPPORT_USER)
#  Optional: SNOWFLAKE_HOST (default FQ39967.ap-southeast-7.aws.snowflakecomputing.com)
# =============================================================
set -euo pipefail

ACCOUNT="${SNOWFLAKE_HOST:-FQ39967.ap-southeast-7.aws.snowflakecomputing.com}"
ADMIN="${SNOWFLAKE_ADMIN_USER:-ARYAN05}"
TENANT_A="${SNOWFLAKE_TENANT_A_USER:-TENANT_A_USER}"
TENANT_B="${SNOWFLAKE_TENANT_B_USER:-TENANT_B_USER}"
SUPPORT="${SNOWFLAKE_SUPPORT_USER:-SUPPORT_USER}"
DB="CAPSTONE_DB"
WH="CAPSTONE_WH"

# Preflight: snowsql + passwords must exist before step 1.
if ! command -v snowsql &> /dev/null; then
  echo "snowsql is not installed. Install SnowSQL, then re-run this script."
  echo "https://docs.snowflake.com/en/user-guide/snowsql-install-config"
  exit 1
fi
for var in SNOWFLAKE_ADMIN_PASSWORD SNOWFLAKE_TENANT_A_PASSWORD SNOWFLAKE_TENANT_B_PASSWORD SNOWFLAKE_SUPPORT_PASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "Missing env var: $var (export it in this shell, then re-run)."
    exit 1
  fi
done

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║   CAP-30 · Snowflake Multi-Tenant Isolation Demo       ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Helper: run a SQL block as a given user and print the result.
# Usage: sfu <user> <password> <label> <sql>
sfu() {
  local user="$1"; local password="$2"; local label="$3"; local sql="$4"
  echo "──────────────────────────────────────────────"
  echo "▶  $label  (as $user)"
  echo "──────────────────────────────────────────────"
  snowsql -a "$ACCOUNT" -u "$user" --password "$password" \
    -d "$DB" -w "$WH" -q "$sql" -o friendly=false -o timing=true 2>&1 | head -40
  echo ""
}

echo "STEP 1 — Tenant A (STEAM): own data visible"
sfu "$TENANT_A" "$SNOWFLAKE_TENANT_A_PASSWORD" "Tenant A KPIs" \
  "USE ROLE TENANT_A_ANALYST; USE SECONDARY ROLES NONE; SELECT * FROM ANALYTICS.V_KPIS;"

echo "STEP 2 — Tenant B (EA): own data visible"
sfu "$TENANT_B" "$SNOWFLAKE_TENANT_B_PASSWORD" "Tenant B KPIs" \
  "USE ROLE TENANT_B_ANALYST; USE SECONDARY ROLES NONE; SELECT * FROM ANALYTICS.V_KPIS;"

echo "STEP 3 — Tenant A DENIED access to EA data"
sfu "$TENANT_A" "$SNOWFLAKE_TENANT_A_PASSWORD" "Cross-tenant denial" \
  "USE ROLE TENANT_A_ANALYST; USE SECONDARY ROLES NONE; SELECT COUNT(*) AS ea_rows_visible_to_a FROM ANALYTICS.V_CUSTOMER WHERE tenant_id = 'EA';"
echo "  ^^^ Expected: 0 rows"

echo "STEP 4 — Tenant B DENIED access to STEAM data"
sfu "$TENANT_B" "$SNOWFLAKE_TENANT_B_PASSWORD" "Cross-tenant denial B" \
  "USE ROLE TENANT_B_ANALYST; USE SECONDARY ROLES NONE; SELECT COUNT(*) AS steam_rows_visible_to_b FROM ANALYTICS.V_ORDERS WHERE tenant_id = 'STEAM';"
echo "  ^^^ Expected: 0 rows"

echo "STEP 5 — Support WITHOUT grant → 0 rows (DB-enforced)"
sfu "$SUPPORT" "$SNOWFLAKE_SUPPORT_PASSWORD" "Support no grant" \
  "USE ROLE CAPSTONE_SUPPORT; USE SECONDARY ROLES NONE; SELECT COUNT(*) AS customers_visible FROM ANALYTICS.V_CUSTOMER;"
echo "  ^^^ Expected: 0 rows (no active grant in SUPPORT_ACCESS_LOG)"

echo "STEP 6 — Support GRANTS access via stored procedure (as SUPPORT_USER, so the grant is logged under the support user)"
sfu "$SUPPORT" "$SNOWFLAKE_SUPPORT_PASSWORD" "Support break-glass" \
  "USE ROLE CAPSTONE_SUPPORT; USE SECONDARY ROLES NONE; CALL TENANT_DATA.SP_SUPPORT_GRANT('Demo viva: investigating STEAM order reconciliation issue', 'STEAM', 60);"

echo "STEP 7 — Support WITH grant → data visible (redacted PII)"
sfu "$SUPPORT" "$SNOWFLAKE_SUPPORT_PASSWORD" "Support with grant" \
  "USE ROLE CAPSTONE_SUPPORT; USE SECONDARY ROLES NONE; SELECT * FROM ANALYTICS.V_SUPPORT_CUSTOMER LIMIT 5;"
echo "  ^^^ customer_name shows first initial + *** only"

echo "STEP 8 — Base-table access DENIED for tenant roles"
# Expected failure: the denial is the correct outcome, so do not let set -e stop the demo here.
sfu "$TENANT_A" "$SNOWFLAKE_TENANT_A_PASSWORD" "Base table denial" \
  "USE ROLE TENANT_A_ANALYST; USE SECONDARY ROLES NONE; SELECT COUNT(*) FROM TENANT_DATA.CUSTOMER;" || true
echo "  ^^^ Expected: SQL access control error (access denied)"

echo "STEP 9 — Support audit log (every access is logged)"
sfu "$ADMIN" "$SNOWFLAKE_ADMIN_PASSWORD" "Support audit trail" \
  "USE ROLE ACCOUNTADMIN; SELECT accessed_by, tenant_id, reason, expiry, (expiry > CURRENT_TIMESTAMP()) AS is_active FROM TENANT_DATA.SUPPORT_ACCESS_LOG ORDER BY log_id DESC LIMIT 5;"

echo "STEP 10 — Python test suites (28 original + 10 extended checks)"
echo "──────────────────────────────────────────────"
echo "▶  Running run_access_tests.py"
echo "──────────────────────────────────────────────"
python tests/run_access_tests.py
echo ""
echo "──────────────────────────────────────────────"
echo "▶  Running extended isolation tests (T10-T19)"
echo "──────────────────────────────────────────────"
python -m pytest tests/test_isolation_extended.py -v
echo ""

echo "╔════════════════════════════════════════════════════════╗"
echo "║   Demo complete. All isolation controls proven.        ║"
echo "║   Security boundary: Snowflake (not the UI).           ║"
echo "╚════════════════════════════════════════════════════════╝"
