-- =============================================================================
-- FILE: 03_support_procedure.sql
-- PROJECT: Capstone - CAP-30 Tenant Isolation
-- PURPOSE: DB-enforced break-glass support procedure and support secure view.
-- RUN AS:  ACCOUNTADMIN
-- =============================================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CAPSTONE_WH;
USE DATABASE CAPSTONE_DB;

-- ---------------------------------------------------------------------------
-- SECTION 1: Enhance SUPPORT_ACCESS_LOG table schema
-- ---------------------------------------------------------------------------
USE SCHEMA TENANT_DATA;

ALTER TABLE SUPPORT_ACCESS_LOG ADD COLUMN IF NOT EXISTS expiry TIMESTAMP_NTZ;
ALTER TABLE SUPPORT_ACCESS_LOG ADD COLUMN IF NOT EXISTS granted_tenant VARCHAR(10);
ALTER TABLE SUPPORT_ACCESS_LOG ADD COLUMN IF NOT EXISTS duration_minutes INT;

-- ---------------------------------------------------------------------------
-- SECTION 2: Stored Procedure for Break-Glass Grant
-- Enforces:
-- 1. Reason is non-empty and at least 10 characters
-- 2. Tenant is valid ('STEAM', 'EA', or 'ALL')
-- 3. Duration is between 1 and 480 minutes (8 hours max)
-- 4. Audit record logs CURRENT_USER() as accessor with explicit expiry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE TENANT_DATA.SP_SUPPORT_GRANT(
    P_REASON VARCHAR,
    P_TENANT VARCHAR,
    P_DURATION_MINUTES INT
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    v_user VARCHAR;
    v_expiry TIMESTAMP_NTZ;
    v_tenant_norm VARCHAR;
BEGIN
    v_tenant_norm := UPPER(TRIM(NVL(P_TENANT, '')));
    
    -- 1. Reason validation
    IF (P_REASON IS NULL OR LENGTH(TRIM(P_REASON)) < 10) THEN
        RETURN 'ERROR: Reason must be at least 10 characters describing the justification.';
    END IF;

    -- 2. Target tenant validation
    IF (v_tenant_norm NOT IN ('STEAM', 'EA', 'ALL')) THEN
        RETURN 'ERROR: Target tenant must be STEAM, EA, or ALL.';
    END IF;

    -- 3. Duration boundaries (1 to 480 minutes)
    IF (P_DURATION_MINUTES IS NULL OR P_DURATION_MINUTES < 1 OR P_DURATION_MINUTES > 480) THEN
        RETURN 'ERROR: Duration must be between 1 and 480 minutes.';
    END IF;

    v_user := CURRENT_USER();
    v_expiry := DATEADD(minute, P_DURATION_MINUTES, CURRENT_TIMESTAMP());

    INSERT INTO TENANT_DATA.SUPPORT_ACCESS_LOG
        (accessed_by, tenant_id, reason, granted_tenant, expiry, duration_minutes)
    VALUES
        (:v_user, :v_tenant_norm, :P_REASON, :v_tenant_norm, :v_expiry, :P_DURATION_MINUTES);

    RETURN 'GRANTED: Support access granted to ' || :v_user || ' for tenant [' || :v_tenant_norm || '] until ' || TO_VARCHAR(:v_expiry, 'YYYY-MM-DD HH24:MI:SS UTC');
END;
$$;

-- Grant USAGE on the procedure to the support and admin roles
GRANT USAGE ON PROCEDURE TENANT_DATA.SP_SUPPORT_GRANT(VARCHAR, VARCHAR, INT) TO ROLE CAPSTONE_SUPPORT;
GRANT USAGE ON PROCEDURE TENANT_DATA.SP_SUPPORT_GRANT(VARCHAR, VARCHAR, INT) TO ROLE CAPSTONE_ADMIN;

-- Callers need USAGE on the schema to invoke the procedure. USAGE alone
-- grants no SELECT on any base table, so the base-table denial is unchanged.
GRANT USAGE ON SCHEMA CAPSTONE_DB.TENANT_DATA TO ROLE CAPSTONE_SUPPORT;
GRANT USAGE ON SCHEMA CAPSTONE_DB.TENANT_DATA TO ROLE CAPSTONE_ADMIN;

-- ---------------------------------------------------------------------------
-- SECTION 3: Gate every ANALYTICS view on an active support grant
-- Runs as CAPSTONE_ADMIN: after 02_harden_views.sql it owns the ANALYTICS
-- schema and can read TENANT_DATA (02 granted it SELECT on all base tables).
-- ACCOUNTADMIN can no longer CREATE OR REPLACE these views.
--
-- Rule (same pattern on every view): a CAPSTONE_SUPPORT query returns rows
-- only when SUPPORT_ACCESS_LOG holds an active, unexpired grant for
-- CURRENT_USER() whose granted_tenant matches the row (or is 'ALL').
-- Every other role is unaffected: the first disjunct is true for them.
-- Without a grant, support sees 0 rows in every view -- fail-closed.
-- ---------------------------------------------------------------------------
USE ROLE CAPSTONE_ADMIN;
USE SCHEMA ANALYTICS;

-- Support-only view: customer rows with PII masked. EXISTS (not a JOIN) so a
-- user holding two active grants never sees the same customer twice.
CREATE OR REPLACE SECURE VIEW ANALYTICS.V_SUPPORT_CUSTOMER AS
SELECT
    c.tenant_id,
    c.customer_id,
    LEFT(c.customer_name, 1) || '*** [REDACTED PII]' AS customer_name,
    c.city,
    c.region,
    c.segment,
    c.created_at
FROM TENANT_DATA.CUSTOMER c
JOIN TENANT_DATA.ROLE_TENANT_MAP m
  ON m.role_name = CURRENT_ROLE()
 AND (m.tenant_id = c.tenant_id OR m.tenant_id = 'ALL')
WHERE EXISTS (
    SELECT 1 FROM TENANT_DATA.SUPPORT_ACCESS_LOG s
    WHERE s.accessed_by = CURRENT_USER()
      AND s.expiry > CURRENT_TIMESTAMP()
      AND (s.granted_tenant = c.tenant_id OR s.granted_tenant = 'ALL')
);

-- Support's own audit rows (used by GET /api/support/status).
CREATE OR REPLACE SECURE VIEW ANALYTICS.V_SUPPORT_LOG AS
SELECT log_id, accessed_by, tenant_id, granted_tenant, reason, expiry,
       duration_minutes, accessed_at
FROM TENANT_DATA.SUPPORT_ACCESS_LOG
WHERE accessed_by = CURRENT_USER();

-- All six base views, re-created with the support gate.
CREATE OR REPLACE SECURE VIEW ANALYTICS.V_TENANT AS
SELECT t.*
FROM TENANT_DATA.TENANT t
JOIN TENANT_DATA.ROLE_TENANT_MAP m
  ON m.role_name = CURRENT_ROLE()
 AND (m.tenant_id = t.tenant_id OR m.tenant_id = 'ALL')
WHERE (
    CURRENT_ROLE() <> 'CAPSTONE_SUPPORT'
    OR EXISTS (
        SELECT 1 FROM TENANT_DATA.SUPPORT_ACCESS_LOG s
        WHERE s.accessed_by = CURRENT_USER()
          AND s.expiry > CURRENT_TIMESTAMP()
          AND (s.granted_tenant = t.tenant_id OR s.granted_tenant = 'ALL')
    )
);

CREATE OR REPLACE SECURE VIEW ANALYTICS.V_CUSTOMER AS
SELECT c.*
FROM TENANT_DATA.CUSTOMER c
JOIN TENANT_DATA.ROLE_TENANT_MAP m
  ON m.role_name = CURRENT_ROLE()
 AND (m.tenant_id = c.tenant_id OR m.tenant_id = 'ALL')
WHERE (
    CURRENT_ROLE() <> 'CAPSTONE_SUPPORT'
    OR EXISTS (
        SELECT 1 FROM TENANT_DATA.SUPPORT_ACCESS_LOG s
        WHERE s.accessed_by = CURRENT_USER()
          AND s.expiry > CURRENT_TIMESTAMP()
          AND (s.granted_tenant = c.tenant_id OR s.granted_tenant = 'ALL')
    )
);

CREATE OR REPLACE SECURE VIEW ANALYTICS.V_PRODUCT AS
SELECT p.*
FROM TENANT_DATA.PRODUCT p
JOIN TENANT_DATA.ROLE_TENANT_MAP m
  ON m.role_name = CURRENT_ROLE()
 AND (m.tenant_id = p.tenant_id OR m.tenant_id = 'ALL')
WHERE (
    CURRENT_ROLE() <> 'CAPSTONE_SUPPORT'
    OR EXISTS (
        SELECT 1 FROM TENANT_DATA.SUPPORT_ACCESS_LOG s
        WHERE s.accessed_by = CURRENT_USER()
          AND s.expiry > CURRENT_TIMESTAMP()
          AND (s.granted_tenant = p.tenant_id OR s.granted_tenant = 'ALL')
    )
);

CREATE OR REPLACE SECURE VIEW ANALYTICS.V_ORDERS AS
SELECT o.*
FROM TENANT_DATA.ORDERS o
JOIN TENANT_DATA.ROLE_TENANT_MAP m
  ON m.role_name = CURRENT_ROLE()
 AND (m.tenant_id = o.tenant_id OR m.tenant_id = 'ALL')
WHERE (
    CURRENT_ROLE() <> 'CAPSTONE_SUPPORT'
    OR EXISTS (
        SELECT 1 FROM TENANT_DATA.SUPPORT_ACCESS_LOG s
        WHERE s.accessed_by = CURRENT_USER()
          AND s.expiry > CURRENT_TIMESTAMP()
          AND (s.granted_tenant = o.tenant_id OR s.granted_tenant = 'ALL')
    )
);

CREATE OR REPLACE SECURE VIEW ANALYTICS.V_ORDER_LINE AS
SELECT l.*
FROM TENANT_DATA.ORDER_LINE l
JOIN TENANT_DATA.ROLE_TENANT_MAP m
  ON m.role_name = CURRENT_ROLE()
 AND (m.tenant_id = l.tenant_id OR m.tenant_id = 'ALL')
WHERE (
    CURRENT_ROLE() <> 'CAPSTONE_SUPPORT'
    OR EXISTS (
        SELECT 1 FROM TENANT_DATA.SUPPORT_ACCESS_LOG s
        WHERE s.accessed_by = CURRENT_USER()
          AND s.expiry > CURRENT_TIMESTAMP()
          AND (s.granted_tenant = l.tenant_id OR s.granted_tenant = 'ALL')
    )
);

CREATE OR REPLACE SECURE VIEW ANALYTICS.V_KPIS AS
SELECT
    l.tenant_id,
    COUNT(DISTINCT l.order_id) AS total_orders,
    COUNT(DISTINCT o.customer_id) AS total_customers,
    ROUND(SUM(l.revenue), 2) AS total_revenue,
    ROUND(SUM(l.revenue) / NULLIF(COUNT(DISTINCT l.order_id), 0), 2) AS avg_order_value
FROM TENANT_DATA.ORDER_LINE l
JOIN TENANT_DATA.ORDERS o
  ON l.tenant_id = o.tenant_id AND l.order_id = o.order_id
JOIN TENANT_DATA.ROLE_TENANT_MAP m
  ON m.role_name = CURRENT_ROLE()
 AND (m.tenant_id = l.tenant_id OR m.tenant_id = 'ALL')
WHERE (
    CURRENT_ROLE() <> 'CAPSTONE_SUPPORT'
    OR EXISTS (
        SELECT 1 FROM TENANT_DATA.SUPPORT_ACCESS_LOG s
        WHERE s.accessed_by = CURRENT_USER()
          AND s.expiry > CURRENT_TIMESTAMP()
          AND (s.granted_tenant = l.tenant_id OR s.granted_tenant = 'ALL')
    )
)
GROUP BY l.tenant_id;

-- Re-grant SELECT explicitly (CREATE OR REPLACE normally keeps grants, but
-- explicit re-grants make the intended state visible and self-healing).
-- Base views: every role that had them before.
GRANT SELECT ON VIEW ANALYTICS.V_TENANT     TO ROLE TENANT_A_ANALYST;
GRANT SELECT ON VIEW ANALYTICS.V_CUSTOMER   TO ROLE TENANT_A_ANALYST;
GRANT SELECT ON VIEW ANALYTICS.V_PRODUCT    TO ROLE TENANT_A_ANALYST;
GRANT SELECT ON VIEW ANALYTICS.V_ORDERS     TO ROLE TENANT_A_ANALYST;
GRANT SELECT ON VIEW ANALYTICS.V_ORDER_LINE TO ROLE TENANT_A_ANALYST;
GRANT SELECT ON VIEW ANALYTICS.V_KPIS       TO ROLE TENANT_A_ANALYST;

GRANT SELECT ON VIEW ANALYTICS.V_TENANT     TO ROLE TENANT_B_ANALYST;
GRANT SELECT ON VIEW ANALYTICS.V_CUSTOMER   TO ROLE TENANT_B_ANALYST;
GRANT SELECT ON VIEW ANALYTICS.V_PRODUCT    TO ROLE TENANT_B_ANALYST;
GRANT SELECT ON VIEW ANALYTICS.V_ORDERS     TO ROLE TENANT_B_ANALYST;
GRANT SELECT ON VIEW ANALYTICS.V_ORDER_LINE TO ROLE TENANT_B_ANALYST;
GRANT SELECT ON VIEW ANALYTICS.V_KPIS       TO ROLE TENANT_B_ANALYST;

GRANT SELECT ON VIEW ANALYTICS.V_TENANT     TO ROLE POWERBI_TENANT_A;
GRANT SELECT ON VIEW ANALYTICS.V_CUSTOMER   TO ROLE POWERBI_TENANT_A;
GRANT SELECT ON VIEW ANALYTICS.V_PRODUCT    TO ROLE POWERBI_TENANT_A;
GRANT SELECT ON VIEW ANALYTICS.V_ORDERS     TO ROLE POWERBI_TENANT_A;
GRANT SELECT ON VIEW ANALYTICS.V_ORDER_LINE TO ROLE POWERBI_TENANT_A;
GRANT SELECT ON VIEW ANALYTICS.V_KPIS       TO ROLE POWERBI_TENANT_A;

GRANT SELECT ON VIEW ANALYTICS.V_TENANT     TO ROLE POWERBI_TENANT_B;
GRANT SELECT ON VIEW ANALYTICS.V_CUSTOMER   TO ROLE POWERBI_TENANT_B;
GRANT SELECT ON VIEW ANALYTICS.V_PRODUCT    TO ROLE POWERBI_TENANT_B;
GRANT SELECT ON VIEW ANALYTICS.V_ORDERS     TO ROLE POWERBI_TENANT_B;
GRANT SELECT ON VIEW ANALYTICS.V_ORDER_LINE TO ROLE POWERBI_TENANT_B;
GRANT SELECT ON VIEW ANALYTICS.V_KPIS       TO ROLE POWERBI_TENANT_B;

GRANT SELECT ON VIEW ANALYTICS.V_TENANT     TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW ANALYTICS.V_CUSTOMER   TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW ANALYTICS.V_PRODUCT    TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW ANALYTICS.V_ORDERS     TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW ANALYTICS.V_ORDER_LINE TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW ANALYTICS.V_KPIS       TO ROLE CAPSTONE_SUPPORT;

GRANT SELECT ON VIEW ANALYTICS.V_TENANT     TO ROLE CAPSTONE_ADMIN;
GRANT SELECT ON VIEW ANALYTICS.V_CUSTOMER   TO ROLE CAPSTONE_ADMIN;
GRANT SELECT ON VIEW ANALYTICS.V_PRODUCT    TO ROLE CAPSTONE_ADMIN;
GRANT SELECT ON VIEW ANALYTICS.V_ORDERS     TO ROLE CAPSTONE_ADMIN;
GRANT SELECT ON VIEW ANALYTICS.V_ORDER_LINE TO ROLE CAPSTONE_ADMIN;
GRANT SELECT ON VIEW ANALYTICS.V_KPIS       TO ROLE CAPSTONE_ADMIN;

-- Support-only views: support and admin only (analysts get 0 rows from them
-- anyway, but there is no reason to grant them).
GRANT SELECT ON VIEW ANALYTICS.V_SUPPORT_CUSTOMER TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW ANALYTICS.V_SUPPORT_CUSTOMER TO ROLE CAPSTONE_ADMIN;
GRANT SELECT ON VIEW ANALYTICS.V_SUPPORT_LOG TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW ANALYTICS.V_SUPPORT_LOG TO ROLE CAPSTONE_ADMIN;

-- Back to ACCOUNTADMIN for verification.
USE ROLE ACCOUNTADMIN;

-- Verification
SHOW PROCEDURES LIKE 'SP_SUPPORT_GRANT' IN SCHEMA TENANT_DATA;
SHOW GRANTS ON VIEW ANALYTICS.V_SUPPORT_CUSTOMER;
SHOW GRANTS ON VIEW ANALYTICS.V_SUPPORT_LOG;
