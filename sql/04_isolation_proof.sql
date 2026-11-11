-- =============================================================================
-- FILE: 04_isolation_proof.sql
-- PROJECT: Capstone - CAP-30 Tenant Isolation
-- PURPOSE: Direct SQL evidence test script designed to be run as dedicated users
--          proving database-side tenant isolation, base-table denial, and secondary role blocks.
-- =============================================================================

USE WAREHOUSE CAPSTONE_WH;
USE DATABASE CAPSTONE_DB;

-- =============================================================================
-- BLOCK 1: TENANT_A_USER (Run in session authenticated as TENANT_A_USER)
-- Role assigned: TENANT_A_ANALYST (Default)
-- Expected Tenant: STEAM only
-- =============================================================================
USE ROLE TENANT_A_ANALYST;
USE SECONDARY ROLES NONE;

-- 1.1 Own Tenant KPIs & Customers:
-- EXPECTED: Exactly 1 row for STEAM (200 orders, 20 customers, 656950.40 revenue)
SELECT * FROM ANALYTICS.V_KPIS;

-- EXPECTED: Exactly 20 customers returned
SELECT COUNT(*) AS steam_customers_visible FROM ANALYTICS.V_CUSTOMER;

-- 1.2 Cross-Tenant Query Attempt (Direct WHERE filter for other tenant):
-- EXPECTED: 0 rows returned
SELECT COUNT(*) AS ea_customers_visible_to_a FROM ANALYTICS.V_CUSTOMER WHERE tenant_id = 'EA';
SELECT COUNT(*) AS ea_orders_visible_to_a FROM ANALYTICS.V_ORDERS WHERE tenant_id = 'EA';

-- 1.3 Direct Base-Table Access Attempt (Direct bypass test):
-- EXPECTED: SQL access control error: Insufficient privileges to operate on schema 'TENANT_DATA'
SELECT COUNT(*) FROM TENANT_DATA.CUSTOMER;

-- 1.4 Secondary Role Widening Attempt:
-- EXPECTED: Even if SECONDARY ROLES ALL is invoked, access does not expand because user only possesses TENANT_A_ANALYST
USE SECONDARY ROLES ALL;
SELECT COUNT(*) AS ea_customers_after_secondary FROM ANALYTICS.V_CUSTOMER WHERE tenant_id = 'EA';
-- EXPECTED: 0 rows

-- 1.5 Privilege Escalation Attempt (Switching to Tenant B role):
-- EXPECTED: SQL access control error: Role 'TENANT_B_ANALYST' does not exist or not authorized
USE ROLE TENANT_B_ANALYST;


-- =============================================================================
-- BLOCK 2: TENANT_B_USER (Run in session authenticated as TENANT_B_USER)
-- Role assigned: TENANT_B_ANALYST (Default)
-- Expected Tenant: EA only
-- =============================================================================
USE ROLE TENANT_B_ANALYST;
USE SECONDARY ROLES NONE;

-- 2.1 Own Tenant KPIs & Customers:
-- EXPECTED: Exactly 1 row for EA (200 orders, 20 customers, 854522.10 revenue)
SELECT * FROM ANALYTICS.V_KPIS;

-- EXPECTED: Exactly 20 customers returned
SELECT COUNT(*) AS ea_customers_visible FROM ANALYTICS.V_CUSTOMER;

-- 2.2 Cross-Tenant Query Attempt:
-- EXPECTED: 0 rows returned
SELECT COUNT(*) AS steam_customers_visible_to_b FROM ANALYTICS.V_CUSTOMER WHERE tenant_id = 'STEAM';
SELECT COUNT(*) AS steam_orders_visible_to_b FROM ANALYTICS.V_ORDERS WHERE tenant_id = 'STEAM';

-- 2.3 Direct Base-Table Access Attempt:
-- EXPECTED: SQL access control error: Insufficient privileges on schema 'TENANT_DATA'
SELECT COUNT(*) FROM TENANT_DATA.ORDERS;


-- =============================================================================
-- BLOCK 3: SUPPORT_USER (Run in session authenticated as SUPPORT_USER)
-- Role assigned: CAPSTONE_SUPPORT
-- =============================================================================
USE ROLE CAPSTONE_SUPPORT;
USE SECONDARY ROLES NONE;

-- 3.1 Querying without an active break-glass grant:
-- EXPECTED: 0 rows (Database-enforced fail-closed gate)
SELECT COUNT(*) AS support_without_grant FROM ANALYTICS.V_CUSTOMER;

-- 3.2 Requesting Break-Glass Grant via Stored Procedure:
-- Justification: Investigating order discrepancy ticket #INC-8921
CALL TENANT_DATA.SP_SUPPORT_GRANT('Investigating order discrepancy ticket #INC-8921 for STEAM tenant', 'STEAM', 30);

-- 3.3 Querying customer data with active grant:
-- EXPECTED: 20 rows visible for STEAM, 0 rows for EA
SELECT tenant_id, COUNT(*) FROM ANALYTICS.V_CUSTOMER GROUP BY tenant_id;

-- 3.4 Support View with Redacted PII:
-- EXPECTED: customer_name is masked (e.g., 'A*** [REDACTED PII]')
SELECT customer_id, tenant_id, customer_name, city FROM ANALYTICS.V_SUPPORT_CUSTOMER LIMIT 5;


-- =============================================================================
-- BLOCK 4: AUDIT & RECONCILIATION AS CAPSTONE_ADMIN
-- =============================================================================
USE ROLE CAPSTONE_ADMIN;

-- 4.1 Verify Support Access Log records:
-- EXPECTED: Shows accessed_by, tenant_id, reason, expiry, and duration
SELECT log_id, accessed_by, tenant_id, granted_tenant, reason, expiry, accessed_at
FROM TENANT_DATA.SUPPORT_ACCESS_LOG
ORDER BY log_id DESC
LIMIT 5;
