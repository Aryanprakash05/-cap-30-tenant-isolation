-- =============================================================================
-- FILE: 02_harden_views.sql
-- PROJECT: Capstone – CAP-30 Tenant Isolation
-- PURPOSE: Harden the ANALYTICS schema by:
--            1. Cloning the schema as a rollback snapshot
--            2. Transferring view + schema ownership to CAPSTONE_ADMIN
--            3. Revoking PUBLIC access to both schemas
-- RUN AS:  ACCOUNTADMIN
-- ROLLBACK: If anything goes wrong, restore with:
--             DROP SCHEMA CAPSTONE_DB.ANALYTICS;
--             ALTER SCHEMA CAPSTONE_DB.ANALYTICS_BACKUP RENAME TO ANALYTICS;
--           Then re-run from SECTION 2 onward.
-- =============================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE CAPSTONE_DB;

-- ---------------------------------------------------------------------------
-- SECTION 1: Clone ANALYTICS schema as a rollback snapshot
-- The clone is a zero-copy snapshot taken at the current time. Any changes
-- made to ANALYTICS after this point do NOT affect ANALYTICS_BACKUP.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS CAPSTONE_DB.ANALYTICS_BACKUP
    CLONE CAPSTONE_DB.ANALYTICS
    COMMENT = 'Zero-copy rollback snapshot of ANALYTICS taken before CAP-30 hardening. Created by 02_harden_views.sql.';

-- ---------------------------------------------------------------------------
-- SECTION 2: Transfer ownership of all ANALYTICS views to CAPSTONE_ADMIN
-- REVOKE CURRENT GRANTS drops any existing privilege grants on the view so
-- that the new owner starts with a clean grant list.
-- Views in scope: V_TENANT, V_CUSTOMER, V_PRODUCT, V_ORDERS,
--                 V_ORDER_LINE, V_KPIS
-- ---------------------------------------------------------------------------

-- The new view owner must be able to read the base tables, or every view
-- query fails with insufficient privileges. Analysts and support still get
-- no base-table access: this grant is for CAPSTONE_ADMIN (setup) only.
GRANT SELECT ON ALL TABLES IN SCHEMA CAPSTONE_DB.TENANT_DATA TO ROLE CAPSTONE_ADMIN;

GRANT OWNERSHIP ON VIEW CAPSTONE_DB.ANALYTICS.V_TENANT
    TO ROLE CAPSTONE_ADMIN REVOKE CURRENT GRANTS;

GRANT OWNERSHIP ON VIEW CAPSTONE_DB.ANALYTICS.V_CUSTOMER
    TO ROLE CAPSTONE_ADMIN REVOKE CURRENT GRANTS;

GRANT OWNERSHIP ON VIEW CAPSTONE_DB.ANALYTICS.V_PRODUCT
    TO ROLE CAPSTONE_ADMIN REVOKE CURRENT GRANTS;

GRANT OWNERSHIP ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDERS
    TO ROLE CAPSTONE_ADMIN REVOKE CURRENT GRANTS;

GRANT OWNERSHIP ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDER_LINE
    TO ROLE CAPSTONE_ADMIN REVOKE CURRENT GRANTS;

GRANT OWNERSHIP ON VIEW CAPSTONE_DB.ANALYTICS.V_KPIS
    TO ROLE CAPSTONE_ADMIN REVOKE CURRENT GRANTS;

-- ---------------------------------------------------------------------------
-- SECTION 3: Transfer ownership of the ANALYTICS schema itself
-- After this, CAPSTONE_ADMIN can create/alter objects in ANALYTICS.
-- ACCOUNTADMIN retains the ability to override via MANAGE GRANTS.
-- ---------------------------------------------------------------------------

GRANT OWNERSHIP ON SCHEMA CAPSTONE_DB.ANALYTICS
    TO ROLE CAPSTONE_ADMIN REVOKE CURRENT GRANTS;

-- ---------------------------------------------------------------------------
-- SECTION 4: Re-grant SELECT on all views to the roles that need them
-- Ownership transfer with REVOKE CURRENT GRANTS removed existing SELECT grants,
-- so we must explicitly re-grant them under the new owner.
-- Switch to CAPSTONE_ADMIN to issue the grants from the owning role.
-- ---------------------------------------------------------------------------

USE ROLE CAPSTONE_ADMIN;

-- Tenant A analyst and its Power BI counterpart
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_TENANT     TO ROLE TENANT_A_ANALYST;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_CUSTOMER   TO ROLE TENANT_A_ANALYST;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_PRODUCT    TO ROLE TENANT_A_ANALYST;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDERS     TO ROLE TENANT_A_ANALYST;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDER_LINE TO ROLE TENANT_A_ANALYST;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_KPIS       TO ROLE TENANT_A_ANALYST;

GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_TENANT     TO ROLE POWERBI_TENANT_A;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_CUSTOMER   TO ROLE POWERBI_TENANT_A;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_PRODUCT    TO ROLE POWERBI_TENANT_A;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDERS     TO ROLE POWERBI_TENANT_A;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDER_LINE TO ROLE POWERBI_TENANT_A;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_KPIS       TO ROLE POWERBI_TENANT_A;

-- Tenant B analyst and its Power BI counterpart
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_TENANT     TO ROLE TENANT_B_ANALYST;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_CUSTOMER   TO ROLE TENANT_B_ANALYST;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_PRODUCT    TO ROLE TENANT_B_ANALYST;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDERS     TO ROLE TENANT_B_ANALYST;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDER_LINE TO ROLE TENANT_B_ANALYST;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_KPIS       TO ROLE TENANT_B_ANALYST;

GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_TENANT     TO ROLE POWERBI_TENANT_B;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_CUSTOMER   TO ROLE POWERBI_TENANT_B;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_PRODUCT    TO ROLE POWERBI_TENANT_B;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDERS     TO ROLE POWERBI_TENANT_B;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDER_LINE TO ROLE POWERBI_TENANT_B;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_KPIS       TO ROLE POWERBI_TENANT_B;

-- CAPSTONE_SUPPORT (break-glass reads go through the gated views; see 03)
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_TENANT     TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_CUSTOMER   TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_PRODUCT    TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDERS     TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDER_LINE TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW CAPSTONE_DB.ANALYTICS.V_KPIS       TO ROLE CAPSTONE_SUPPORT;

-- CAPSTONE_ADMIN full access on ANALYTICS schema
GRANT USAGE ON SCHEMA CAPSTONE_DB.ANALYTICS TO ROLE CAPSTONE_ADMIN;
GRANT USAGE ON SCHEMA CAPSTONE_DB.ANALYTICS TO ROLE TENANT_A_ANALYST;
GRANT USAGE ON SCHEMA CAPSTONE_DB.ANALYTICS TO ROLE TENANT_B_ANALYST;
GRANT USAGE ON SCHEMA CAPSTONE_DB.ANALYTICS TO ROLE POWERBI_TENANT_A;
GRANT USAGE ON SCHEMA CAPSTONE_DB.ANALYTICS TO ROLE POWERBI_TENANT_B;
GRANT USAGE ON SCHEMA CAPSTONE_DB.ANALYTICS TO ROLE CAPSTONE_SUPPORT;

-- Switch back to ACCOUNTADMIN for the deny steps
USE ROLE ACCOUNTADMIN;

-- ---------------------------------------------------------------------------
-- SECTION 5: Explicit DENY — revoke PUBLIC access to raw data schemas
-- PUBLIC is a built-in role that every user inherits. Revoking privileges from
-- PUBLIC here ensures no unauthenticated or low-privilege principal can browse
-- or query TENANT_DATA or the backup schema.
-- ---------------------------------------------------------------------------

-- Block PUBLIC from the raw data schema
REVOKE ALL PRIVILEGES ON SCHEMA CAPSTONE_DB.TENANT_DATA   FROM ROLE PUBLIC;

-- Block PUBLIC from the analytics schema (tenant roles get explicit grants above)
REVOKE ALL PRIVILEGES ON SCHEMA CAPSTONE_DB.ANALYTICS      FROM ROLE PUBLIC;

-- Block PUBLIC from the backup schema
REVOKE ALL PRIVILEGES ON SCHEMA CAPSTONE_DB.ANALYTICS_BACKUP FROM ROLE PUBLIC;

-- ---------------------------------------------------------------------------
-- SECTION 6: Verification queries
-- ---------------------------------------------------------------------------

-- 6a. Check schema-level grants — look for PUBLIC in the grantee_name column.
--     There should be NO rows where grantee_name = 'PUBLIC'.
SHOW GRANTS ON SCHEMA CAPSTONE_DB.ANALYTICS;
SHOW GRANTS ON SCHEMA CAPSTONE_DB.TENANT_DATA;

-- 6b. Check ownership and grants on individual views.
--     owner column should show CAPSTONE_ADMIN for all six views.
SHOW GRANTS ON VIEW CAPSTONE_DB.ANALYTICS.V_TENANT;
SHOW GRANTS ON VIEW CAPSTONE_DB.ANALYTICS.V_CUSTOMER;
SHOW GRANTS ON VIEW CAPSTONE_DB.ANALYTICS.V_PRODUCT;
SHOW GRANTS ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDERS;
SHOW GRANTS ON VIEW CAPSTONE_DB.ANALYTICS.V_ORDER_LINE;
SHOW GRANTS ON VIEW CAPSTONE_DB.ANALYTICS.V_KPIS;

-- 6c. Confirm backup schema exists and is owned by ACCOUNTADMIN
SHOW SCHEMAS LIKE 'ANALYTICS_BACKUP' IN DATABASE CAPSTONE_DB;
