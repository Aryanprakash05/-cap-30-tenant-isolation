#!/bin/bash
# =============================================================================
# FILE: run_all.sh
# PROJECT: Capstone - CAP-30 Tenant Isolation
# PURPOSE: Sequentially execute idempotent deployment and verification SQL scripts.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source .env if present (set -a exports every variable it defines)
if [ -f "$REPO_ROOT/.env" ]; then
    echo "Loading environment variables from $REPO_ROOT/.env"
    set -a
    # shellcheck disable=SC1091
    source "$REPO_ROOT/.env"
    set +a
fi

ACCOUNT="${SNOWFLAKE_ACCOUNT:-FQ39967}"
USER="${SNOWFLAKE_ADMIN_USER:-ARYAN05}"

echo "=========================================================="
echo " Running CAP-30 Snowflake SQL Deployment Scripts"
echo " Account: $ACCOUNT | User: $USER"
echo "=========================================================="

run_sql() {
    local file="$1"
    echo ""
    echo ">>> Executing: $file"
    if command -v snowsql &> /dev/null; then
        snowsql -a "$ACCOUNT" -u "$USER" -f "$file"
    else
        echo "snowsql command not found. Please run the script in Snowflake Web UI / Worksheet."
    fi
}

run_sql "$SCRIPT_DIR/01_users_and_roles.sql"
run_sql "$SCRIPT_DIR/02_harden_views.sql"
run_sql "$SCRIPT_DIR/03_support_procedure.sql"
# 04_isolation_proof.sql is NOT run here: it is interactive, assumes a
# separate session per user (TENANT_A_USER, TENANT_B_USER, SUPPORT_USER),
# and contains intentional denials that stop this script under set -e.
# Run it by hand in Snowsight, or use demo/run_demo.sh instead.
run_sql "$SCRIPT_DIR/05_reconciliation.sql"

echo ""
echo "=========================================================="
echo " All scripts executed successfully."
echo "=========================================================="
