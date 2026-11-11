"""
Extended isolation tests for CAP-30.
Runs AFTER run_access_tests.py passes.
Tests T10-T19: support workflow, fail-closed, secondary-role widening, reconciliation.

Usage:
    SNOWFLAKE_PASSWORD=... pytest tests/test_isolation_extended.py -v
    SNOWFLAKE_PASSWORD=... SNOWFLAKE_TENANT_A_PASSWORD=... SNOWFLAKE_TENANT_B_PASSWORD=... \\
        SNOWFLAKE_SUPPORT_PASSWORD=... pytest tests/test_isolation_extended.py -v
    # For expiry test (takes 70+ seconds):
    SLOW_TESTS=1 ... pytest tests/test_isolation_extended.py -v -k test_support_expired_grant_denied
"""

import os
import time

import pytest
import snowflake.connector

# ---------------------------------------------------------------------------
# Connection configuration
# ---------------------------------------------------------------------------

ACCOUNT   = os.environ.get("SNOWFLAKE_ACCOUNT", "FQ39967")
HOST      = os.environ.get("SNOWFLAKE_HOST", "FQ39967.ap-southeast-7.aws.snowflakecomputing.com")
WAREHOUSE = "CAPSTONE_WH"
DATABASE  = "CAPSTONE_DB"

# Admin creds (for setup/teardown and T10 control)
ADMIN_USER = os.environ.get("SNOWFLAKE_ADMIN_USER", "ARYAN05")
ADMIN_PASS = os.environ.get("SNOWFLAKE_ADMIN_PASSWORD") or os.environ.get("SNOWFLAKE_PASSWORD")

# Dedicated user creds
TENANT_A_USER = os.environ.get("SNOWFLAKE_TENANT_A_USER", "TENANT_A_USER")
TENANT_A_PASS = os.environ.get("SNOWFLAKE_TENANT_A_PASSWORD")
TENANT_B_USER = os.environ.get("SNOWFLAKE_TENANT_B_USER", "TENANT_B_USER")
TENANT_B_PASS = os.environ.get("SNOWFLAKE_TENANT_B_PASSWORD")
SUPPORT_USER  = os.environ.get("SNOWFLAKE_SUPPORT_USER", "SUPPORT_USER")
SUPPORT_PASS  = os.environ.get("SNOWFLAKE_SUPPORT_PASSWORD")


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------

def _connect(user, password, role=None):
    """Open a Snowflake connection for the given user/password, optionally
    setting the default role at connection time."""
    kwargs = dict(
        user=user,
        password=password,
        account=ACCOUNT,
        host=HOST,
        warehouse=WAREHOUSE,
        database=DATABASE,
    )
    if role:
        kwargs["role"] = role
    return snowflake.connector.connect(**kwargs)


def _exec(conn, sql, role=None, secondary_roles="NONE"):
    """Execute *sql* on *conn*, optionally switching role first.

    Always issues USE SECONDARY ROLES <secondary_roles> before the query so
    test intent is explicit and not affected by session defaults.
    """
    cur = conn.cursor()
    try:
        if role:
            cur.execute(f"USE ROLE {role}")
        cur.execute(f"USE SECONDARY ROLES {secondary_roles}")
        cur.execute(f"USE WAREHOUSE {WAREHOUSE}")
        cur.execute(sql)
        return cur.fetchall()
    finally:
        cur.close()


def _scalar(conn, sql, role=None, secondary_roles="NONE"):
    """Return the first column of the first row as a Python scalar."""
    rows = _exec(conn, sql, role=role, secondary_roles=secondary_roles)
    return rows[0][0] if rows else None


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def admin_conn():
    """Session-scoped admin (ARYAN05 / ACCOUNTADMIN) connection."""
    if not ADMIN_PASS:
        pytest.skip("SNOWFLAKE_PASSWORD / SNOWFLAKE_ADMIN_PASSWORD not set")
    conn = _connect(ADMIN_USER, ADMIN_PASS)
    yield conn
    conn.close()


@pytest.fixture(scope="function")
def support_conn():
    """Function-scoped connection as SUPPORT_USER (role CAPSTONE_SUPPORT)."""
    if not SUPPORT_PASS:
        pytest.skip("SNOWFLAKE_SUPPORT_PASSWORD not set")
    conn = _connect(SUPPORT_USER, SUPPORT_PASS, role="CAPSTONE_SUPPORT")
    yield conn
    conn.close()


@pytest.fixture(scope="function")
def tenant_a_conn():
    """Function-scoped connection as TENANT_A_USER (role TENANT_A_ANALYST)."""
    if not TENANT_A_PASS:
        pytest.skip("SNOWFLAKE_TENANT_A_PASSWORD not set")
    conn = _connect(TENANT_A_USER, TENANT_A_PASS, role="TENANT_A_ANALYST")
    yield conn
    conn.close()


@pytest.fixture(scope="function")
def tenant_b_conn():
    """Function-scoped connection as TENANT_B_USER (role TENANT_B_ANALYST)."""
    if not TENANT_B_PASS:
        pytest.skip("SNOWFLAKE_TENANT_B_PASSWORD not set")
    conn = _connect(TENANT_B_USER, TENANT_B_PASS, role="TENANT_B_ANALYST")
    yield conn
    conn.close()


# ---------------------------------------------------------------------------
# T10 — Support denied without an active grant
# ---------------------------------------------------------------------------

def test_support_denied_without_grant(admin_conn, support_conn):
    """T10: CAPSTONE_SUPPORT with no active grant → V_CUSTOMER returns 0 rows.

    Design: V_SUPPORT_CUSTOMER (and all analytics views when queried through
    CAPSTONE_SUPPORT) check for an active row in SUPPORT_ACCESS_LOG via an
    EXISTS sub-query inside the view body.  When none exists the JOIN produces
    0 rows — fail-closed by design.
    """
    # Ensure no active grant exists for SUPPORT_USER
    _exec(
        admin_conn,
        f"DELETE FROM {DATABASE}.TENANT_DATA.SUPPORT_ACCESS_LOG "
        f"WHERE accessed_by = '{SUPPORT_USER}' AND expiry > CURRENT_TIMESTAMP()",
        role="ACCOUNTADMIN",
    )

    count = _scalar(
        support_conn,
        f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER",
        role="CAPSTONE_SUPPORT",
        secondary_roles="NONE",
    )
    assert count == 0, (
        f"Expected 0 rows without an active support grant, got {count}"
    )


# ---------------------------------------------------------------------------
# T11 — Support allowed after SP_SUPPORT_GRANT is called
# ---------------------------------------------------------------------------

def test_support_allowed_after_grant(admin_conn, support_conn):
    """T11: After calling SP_SUPPORT_GRANT for STEAM, CAPSTONE_SUPPORT can
    query STEAM customers but NOT EA customers.

    The grant is requested AS the support user: the procedure runs as owner
    for the INSERT but logs CURRENT_USER(), so the grant row belongs to
    SUPPORT_USER and the view gate (which matches on CURRENT_USER()) opens
    for exactly that user. V_CUSTOMER is per-tenant scoped: its EXISTS clause
    is correlated on the row's tenant_id, so a STEAM grant opens STEAM rows
    only. V_SUPPORT_CUSTOMER applies the same scope and additionally masks
    customer_name.
    """
    # Clean any stale grant
    _exec(
        admin_conn,
        f"DELETE FROM {DATABASE}.TENANT_DATA.SUPPORT_ACCESS_LOG "
        f"WHERE accessed_by = '{SUPPORT_USER}' AND expiry > CURRENT_TIMESTAMP()",
        role="ACCOUNTADMIN",
    )

    # Issue a fresh 60-minute grant for STEAM, as the support user.
    _exec(
        support_conn,
        "CALL " + DATABASE + ".TENANT_DATA.SP_SUPPORT_GRANT("
        "'Investigating order STE_O001 for automated test', 'STEAM', 60)",
        role="CAPSTONE_SUPPORT",
    )

    # Support user should now see STEAM customers
    steam_count = _scalar(
        support_conn,
        f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER WHERE tenant_id = 'STEAM'",
        role="CAPSTONE_SUPPORT",
        secondary_roles="NONE",
    )
    assert steam_count == 20, (
        f"Expected 20 STEAM customers after grant, got {steam_count}"
    )

    # The STEAM grant must not open EA rows in V_CUSTOMER either.
    ea_vcustomer = _scalar(
        support_conn,
        f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER WHERE tenant_id = 'EA'",
        role="CAPSTONE_SUPPORT",
        secondary_roles="NONE",
    )
    assert ea_vcustomer == 0, (
        f"Expected 0 EA rows in V_CUSTOMER when grant is for STEAM only, got {ea_vcustomer}"
    )

    # V_SUPPORT_CUSTOMER is scoped the same way and masks customer_name.
    ea_count = _scalar(
        support_conn,
        f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_SUPPORT_CUSTOMER WHERE tenant_id = 'EA'",
        role="CAPSTONE_SUPPORT",
        secondary_roles="NONE",
    )
    assert ea_count == 0, (
        f"Expected 0 EA rows in V_SUPPORT_CUSTOMER when grant is for STEAM only, got {ea_count}"
    )


# ---------------------------------------------------------------------------
# T12 — Support is denied after the grant expires
# ---------------------------------------------------------------------------

def test_support_expired_grant_denied(admin_conn, support_conn):
    """T12: A 1-minute grant expires after 70 seconds → V_CUSTOMER returns 0.

    Skipped unless SLOW_TESTS=1 is set — this test sleeps for 70 seconds.
    """
    if not os.environ.get("SLOW_TESTS"):
        pytest.skip(
            "Skipping expiry test — set SLOW_TESTS=1 to run (takes 70+ seconds)"
        )
    if not SUPPORT_PASS:
        pytest.skip("SNOWFLAKE_SUPPORT_PASSWORD not set")

    # Clean any existing active grant
    _exec(
        admin_conn,
        f"DELETE FROM {DATABASE}.TENANT_DATA.SUPPORT_ACCESS_LOG "
        f"WHERE accessed_by = '{SUPPORT_USER}' AND expiry > CURRENT_TIMESTAMP()",
        role="ACCOUNTADMIN",
    )

    # Issue a 1-minute grant, as the support user.
    _exec(
        support_conn,
        "CALL " + DATABASE + ".TENANT_DATA.SP_SUPPORT_GRANT("
        "'Automated expiry test', 'STEAM', 1)",
        role="CAPSTONE_SUPPORT",
    )

    # Wait 70 seconds for the 60-second grant to expire
    time.sleep(70)

    with _connect(SUPPORT_USER, SUPPORT_PASS, role="CAPSTONE_SUPPORT") as support_conn:
        count = _scalar(
            support_conn,
            f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER",
            role="CAPSTONE_SUPPORT",
            secondary_roles="NONE",
        )
    assert count == 0, (
        f"Expected 0 rows after grant expired, got {count}"
    )


# ---------------------------------------------------------------------------
# T13 — USE SECONDARY ROLES ALL does not widen access for a dedicated user
# ---------------------------------------------------------------------------

def test_secondary_role_widening_blocked_dedicated_user(tenant_a_conn):
    """T13: TENANT_A_USER with USE SECONDARY ROLES ALL still sees 0 EA rows.

    Isolation holds for two independent reasons:
    (a) TENANT_A_USER has only TENANT_A_ANALYST granted — USE SECONDARY ROLES ALL
        activates every role granted to the user, but since only one role exists
        there is nothing extra to activate.
    (b) The view body uses CURRENT_ROLE(), not CURRENT_SECONDARY_ROLES().
        Even if secondary roles were broader, the isolation JOIN uses the primary
        role to look up ROLE_TENANT_MAP, so the filter cannot be widened by
        secondary roles alone.
    """
    # USE SECONDARY ROLES ALL is a valid statement — should not raise
    _exec(tenant_a_conn, "SELECT 1", role="TENANT_A_ANALYST", secondary_roles="ALL")

    # Now query EA data — expect 0 rows
    count = _scalar(
        tenant_a_conn,
        f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER WHERE tenant_id = 'EA'",
        role="TENANT_A_ANALYST",
        secondary_roles="ALL",
    )
    assert count == 0, (
        f"Expected 0 EA rows even with SECONDARY ROLES ALL, got {count}. "
        "Isolation must hold at the view layer, not the application layer."
    )


# ---------------------------------------------------------------------------
# T14 — Fail-closed: deleting the ROLE_TENANT_MAP entry produces 0 rows
# ---------------------------------------------------------------------------

def test_fail_closed_empty_role_map(admin_conn, tenant_a_conn):
    """T14: Removing TENANT_A_ANALYST from ROLE_TENANT_MAP → view returns 0 rows.

    Restoration is in a finally block to ensure ROLE_TENANT_MAP is never left
    in a broken state even if the assertion fails.
    """
    # Capture current map entry for TENANT_A_ANALYST
    saved = _exec(
        admin_conn,
        f"SELECT role_name, tenant_id, note FROM {DATABASE}.TENANT_DATA.ROLE_TENANT_MAP "
        f"WHERE role_name = 'TENANT_A_ANALYST'",
        role="ACCOUNTADMIN",
    )
    assert saved, "TENANT_A_ANALYST must have an entry in ROLE_TENANT_MAP before this test"
    role_name, tenant_id, note = saved[0]

    try:
        # Delete the entry — this should make the view fail-closed
        _exec(
            admin_conn,
            f"DELETE FROM {DATABASE}.TENANT_DATA.ROLE_TENANT_MAP "
            f"WHERE role_name = 'TENANT_A_ANALYST'",
            role="ACCOUNTADMIN",
        )

        count = _scalar(
            tenant_a_conn,
            f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER",
            role="TENANT_A_ANALYST",
            secondary_roles="NONE",
        )
        assert count == 0, (
            f"Expected 0 rows with TENANT_A_ANALYST removed from ROLE_TENANT_MAP, got {count}"
        )
    finally:
        # Always restore the entry
        note_escaped = (note or "").replace("'", "''")
        _exec(
            admin_conn,
            f"INSERT INTO {DATABASE}.TENANT_DATA.ROLE_TENANT_MAP (role_name, tenant_id, note) "
            f"VALUES ('{role_name}', '{tenant_id}', '{note_escaped}')",
            role="ACCOUNTADMIN",
        )

    # Verify restoration — tenant_a_conn needs a fresh cursor after the map change
    restored_count = _scalar(
        tenant_a_conn,
        f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER",
        role="TENANT_A_ANALYST",
        secondary_roles="NONE",
    )
    assert restored_count == 20, (
        f"Expected 20 rows after restoring ROLE_TENANT_MAP, got {restored_count}"
    )


# ---------------------------------------------------------------------------
# T15 — Fail-closed: a typo in the role map entry produces 0 rows
# ---------------------------------------------------------------------------

def test_fail_closed_typo_role_map(admin_conn, tenant_a_conn):
    """T15: Updating TENANT_A_ANALYST to 'TENANT_A_ANALYST_TYPO' → 0 rows.

    This models a configuration error (e.g., role renamed without updating the
    map).  The view JOIN on CURRENT_ROLE() finds no matching entry and the
    result set is empty — fail-closed, not fail-open.
    """
    try:
        _exec(
            admin_conn,
            f"UPDATE {DATABASE}.TENANT_DATA.ROLE_TENANT_MAP "
            f"SET role_name = 'TENANT_A_ANALYST_TYPO' "
            f"WHERE role_name = 'TENANT_A_ANALYST'",
            role="ACCOUNTADMIN",
        )

        count = _scalar(
            tenant_a_conn,
            f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER",
            role="TENANT_A_ANALYST",
            secondary_roles="NONE",
        )
        assert count == 0, (
            f"Expected 0 rows when role_name has a typo in ROLE_TENANT_MAP, got {count}"
        )
    finally:
        # Restore the correct role_name
        _exec(
            admin_conn,
            f"UPDATE {DATABASE}.TENANT_DATA.ROLE_TENANT_MAP "
            f"SET role_name = 'TENANT_A_ANALYST' "
            f"WHERE role_name = 'TENANT_A_ANALYST_TYPO'",
            role="ACCOUNTADMIN",
        )


# ---------------------------------------------------------------------------
# T16 — SQL injection via tenant_id filter cannot bypass view isolation
# ---------------------------------------------------------------------------

def test_sql_injection_tenant_filter(tenant_a_conn):
    """T16: Parameterised injection attempt via tenant_id returns 0 EA rows.

    Attack surface: an attacker attempts to pass a crafted tenant_id value such
    as "EA' OR '1'='1" hoping to bypass the WHERE clause filter.  Two defences
    apply:

    1. Parameterised queries: the connector sends the value as a bind parameter
       so the injection is never interpreted as SQL.
    2. View-level isolation: even if the WHERE clause could be manipulated, the
       view JOIN on CURRENT_ROLE() ensures only STEAM rows are ever in the
       result set for TENANT_A_ANALYST.  The WHERE clause is applied AFTER the
       view filter.

    Proof of (2): querying with an explicit IN ('EA', 'STEAM') filter still
    returns only the 20 STEAM rows — the view cannot be widened by any WHERE
    clause the caller writes.
    """
    cur = tenant_a_conn.cursor()
    try:
        cur.execute(f"USE ROLE TENANT_A_ANALYST")
        cur.execute("USE SECONDARY ROLES NONE")
        cur.execute(f"USE WAREHOUSE {WAREHOUSE}")

        # Parameterised query — injection value is treated as a literal string
        cur.execute(
            f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER "
            f"WHERE tenant_id = %s",
            ("EA' OR '1'='1",),
        )
        injection_count = cur.fetchone()[0]
        assert injection_count == 0, (
            f"Parameterised injection attempt returned {injection_count} rows; expected 0"
        )

        # Even an explicit IN clause covering both tenants cannot bypass the view
        cur.execute(
            f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER "
            f"WHERE tenant_id IN ('EA', 'STEAM')"
        )
        in_count = cur.fetchone()[0]
        assert in_count == 20, (
            f"Expected 20 (STEAM only) with IN ('EA','STEAM'), got {in_count}. "
            "The view filter on CURRENT_ROLE() supersedes the caller's WHERE clause."
        )
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# T17 — Revenue reconciliation: stored vs recomputed
# ---------------------------------------------------------------------------

def test_revenue_reconciliation(admin_conn):
    """T17: SUM(revenue) == SUM(qty * unit_price * (1 - discount_pct/100)).

    Verifies that the pre-computed revenue column in ORDER_LINE is consistent
    with the formula across all rows and per tenant.

    Known values: STEAM 656,950.40 | EA 854,522.10 | Total 1,511,472.50
    """
    rows = _exec(
        admin_conn,
        f"""
        SELECT
            ROUND(SUM(quantity * unit_price * (1 - discount_pct / 100)), 2) AS recomputed,
            ROUND(SUM(revenue), 2)                                           AS stored,
            ABS(ROUND(SUM(revenue)
                - SUM(quantity * unit_price * (1 - discount_pct / 100)), 2)) AS variance
        FROM {DATABASE}.TENANT_DATA.ORDER_LINE
        """,
        role="ACCOUNTADMIN",
    )
    recomputed, stored, variance = float(rows[0][0]), float(rows[0][1]), float(rows[0][2])
    assert variance < 0.01, (
        f"Revenue reconciliation variance {variance} >= 0.01 "
        f"(recomputed={recomputed}, stored={stored})"
    )

    # Per-tenant checks
    per_tenant = _exec(
        admin_conn,
        f"""
        SELECT
            tenant_id,
            ROUND(SUM(quantity * unit_price * (1 - discount_pct / 100)), 2) AS recomputed
        FROM {DATABASE}.TENANT_DATA.ORDER_LINE
        GROUP BY tenant_id
        ORDER BY tenant_id
        """,
        role="ACCOUNTADMIN",
    )
    per_tenant_map = {r[0]: float(r[1]) for r in per_tenant}

    assert abs(per_tenant_map.get("STEAM", 0) - 656950.40) < 0.01, (
        f"STEAM revenue mismatch: {per_tenant_map.get('STEAM')} vs expected 656950.40"
    )
    assert abs(per_tenant_map.get("EA", 0) - 854522.10) < 0.01, (
        f"EA revenue mismatch: {per_tenant_map.get('EA')} vs expected 854522.10"
    )


# ---------------------------------------------------------------------------
# T18 — Dedicated users cannot query base tables
# ---------------------------------------------------------------------------

def test_base_table_denied_dedicated_user(tenant_a_conn, tenant_b_conn):
    """T18: Dedicated tenant users receive access-denied on TENANT_DATA tables.

    TENANT_A_USER / TENANT_A_ANALYST: SELECT on TENANT_DATA.CUSTOMER → error.
    TENANT_B_USER / TENANT_B_ANALYST: SELECT on TENANT_DATA.ORDERS  → error.

    This tests that the TENANT_DATA schema has no SELECT grants to analyst
    roles — only the secure views in ANALYTICS are exposed.
    """
    with pytest.raises(Exception, match=r"(?i)(insufficient privileges|SQL access control error|does not exist or not authorized)"):
        _exec(
            tenant_a_conn,
            f"SELECT COUNT(*) FROM {DATABASE}.TENANT_DATA.CUSTOMER",
            role="TENANT_A_ANALYST",
            secondary_roles="NONE",
        )

    with pytest.raises(Exception, match=r"(?i)(insufficient privileges|SQL access control error|does not exist or not authorized)"):
        _exec(
            tenant_b_conn,
            f"SELECT COUNT(*) FROM {DATABASE}.TENANT_DATA.ORDERS",
            role="TENANT_B_ANALYST",
            secondary_roles="NONE",
        )


# ---------------------------------------------------------------------------
# T19 — View counts match base table counts per role
# ---------------------------------------------------------------------------

def test_view_count_matches_base_table_per_role(admin_conn, tenant_a_conn, tenant_b_conn, support_conn):
    """T19: V_CUSTOMER count per role matches the base table count per tenant.

    - ACCOUNTADMIN: base CUSTOMER table has 20 STEAM + 20 EA = 40 rows
    - TENANT_A_ANALYST: V_CUSTOMER returns exactly 20 (STEAM only)
    - TENANT_B_ANALYST: V_CUSTOMER returns exactly 20 (EA only)
    - CAPSTONE_SUPPORT (via the dedicated support user): returns 0 when no
      active grant is present — documented as the expected state after T10
      cleanup. The admin connection cannot USE ROLE CAPSTONE_SUPPORT: 01
      revoked it from ARYAN05 on purpose.
    """
    # Ground truth from base table
    base_rows = _exec(
        admin_conn,
        f"SELECT tenant_id, COUNT(*) FROM {DATABASE}.TENANT_DATA.CUSTOMER GROUP BY tenant_id ORDER BY tenant_id",
        role="ACCOUNTADMIN",
    )
    base_map = {r[0]: r[1] for r in base_rows}
    assert base_map.get("STEAM") == 20, f"Base table: expected 20 STEAM, got {base_map.get('STEAM')}"
    assert base_map.get("EA") == 20,    f"Base table: expected 20 EA, got {base_map.get('EA')}"

    # TENANT_A_ANALYST via dedicated user
    a_count = _scalar(
        tenant_a_conn,
        f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER",
        role="TENANT_A_ANALYST",
        secondary_roles="NONE",
    )
    assert a_count == 20, f"TENANT_A_ANALYST expected 20, got {a_count}"

    # TENANT_B_ANALYST via dedicated user
    b_count = _scalar(
        tenant_b_conn,
        f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER",
        role="TENANT_B_ANALYST",
        secondary_roles="NONE",
    )
    assert b_count == 20, f"TENANT_B_ANALYST expected 20, got {b_count}"

    # CAPSTONE_SUPPORT via the dedicated support user (no active grant expected
    # at this point). The admin connection cannot USE ROLE CAPSTONE_SUPPORT.
    # NOTE: T11 may have left an active grant; we clean it here to verify fail-closed.
    _exec(
        admin_conn,
        f"DELETE FROM {DATABASE}.TENANT_DATA.SUPPORT_ACCESS_LOG "
        f"WHERE accessed_by = '{SUPPORT_USER}' AND expiry > CURRENT_TIMESTAMP()",
        role="ACCOUNTADMIN",
    )
    support_count = _scalar(
        support_conn,
        f"SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.V_CUSTOMER",
        role="CAPSTONE_SUPPORT",
        secondary_roles="NONE",
    )
    # With no active grant, CAPSTONE_SUPPORT should see 0 rows (fail-closed).
    # If this returns non-zero, the grant cleanup above did not work or the view
    # does not gate on SUPPORT_ACCESS_LOG — document the finding rather than fail hard.
    assert support_count == 0, (
        f"CAPSTONE_SUPPORT with no active grant expected 0, got {support_count}. "
        "If the support view does not gate on SUPPORT_ACCESS_LOG when querying "
        "V_CUSTOMER (vs V_SUPPORT_CUSTOMER), this may be an intentional design "
        "limitation — document it in 07_known_limitations.md."
    )
