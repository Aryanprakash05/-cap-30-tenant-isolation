-- =============================================================================
-- FILE: 01_users_and_roles.sql
-- PROJECT: Capstone – CAP-30 Tenant Isolation
-- PURPOSE: Create dedicated per-principal Snowflake users, bind each to its
--          matching role, and clean up any cross-tenant grants on ARYAN05.
-- RUN AS:  ACCOUNTADMIN
-- NOTE:    Initial passwords are placeholders – MUST be rotated before the
--          account is handed to any real user. Set the real password via:
--            ALTER USER <name> SET PASSWORD = '<secret>';
--          or provision via your secrets manager / CI environment variable.
-- =============================================================================

USE ROLE ACCOUNTADMIN;

-- ---------------------------------------------------------------------------
-- SECTION 1: Create dedicated application users
-- Snowflake supports CREATE USER IF NOT EXISTS (available since 2023).
-- Each user is pinned to exactly one role; no secondary roles are activated.
-- ---------------------------------------------------------------------------

-- ── Tenant A application user (STEAM) ───────────────────────────────────────
-- SECURITY NOTE: Replace 'ChangeMe_T1@2026!' with a strong secret before use.
CREATE USER IF NOT EXISTS TENANT_A_USER
    PASSWORD              = 'ChangeMe_T1@2026!'   -- !! MUST BE CHANGED BEFORE PRODUCTION USE !!
    DEFAULT_ROLE          = TENANT_A_ANALYST
    DEFAULT_SECONDARY_ROLES = ()             -- prevents privilege escalation via secondary roles
    MUST_CHANGE_PASSWORD  = FALSE
    COMMENT               = 'Application user for Tenant A (STEAM). One role only. Never use for admin tasks.';

-- ── Tenant B application user (EA) ──────────────────────────────────────────
-- SECURITY NOTE: Replace 'ChangeMe_T2@2026!' with a strong secret before use.
CREATE USER IF NOT EXISTS TENANT_B_USER
    PASSWORD              = 'ChangeMe_T2@2026!'   -- !! MUST BE CHANGED BEFORE PRODUCTION USE !!
    DEFAULT_ROLE          = TENANT_B_ANALYST
    DEFAULT_SECONDARY_ROLES = ()
    MUST_CHANGE_PASSWORD  = FALSE
    COMMENT               = 'Application user for Tenant B (EA). One role only. Never use for admin tasks.';

-- ── Support user (break-glass access, governed by SP_SUPPORT_GRANT) ─────────
-- SECURITY NOTE: Replace 'ChangeMe_Sup@2026!' with a strong secret before use.
CREATE USER IF NOT EXISTS SUPPORT_USER
    PASSWORD              = 'ChangeMe_Sup@2026!'  -- !! MUST BE CHANGED BEFORE PRODUCTION USE !!
    DEFAULT_ROLE          = CAPSTONE_SUPPORT
    DEFAULT_SECONDARY_ROLES = ()
    MUST_CHANGE_PASSWORD  = FALSE
    COMMENT               = 'Support engineer break-glass user. Access requires SP_SUPPORT_GRANT invocation.';

-- ── Power BI service account for Tenant A ───────────────────────────────────
-- SECURITY NOTE: Replace 'ChangeMe_PBI_A@2026!' with a strong secret before use.
CREATE USER IF NOT EXISTS POWERBI_A_USER
    PASSWORD              = 'ChangeMe_PBI_A@2026!' -- !! MUST BE CHANGED BEFORE PRODUCTION USE !!
    DEFAULT_ROLE          = POWERBI_TENANT_A
    DEFAULT_SECONDARY_ROLES = ()
    MUST_CHANGE_PASSWORD  = FALSE
    COMMENT               = 'Power BI service account for Tenant A (STEAM) dashboard. Read-only analytics views.';

-- ── Power BI service account for Tenant B ───────────────────────────────────
-- SECURITY NOTE: Replace 'ChangeMe_PBI_B@2026!' with a strong secret before use.
CREATE USER IF NOT EXISTS POWERBI_B_USER
    PASSWORD              = 'ChangeMe_PBI_B@2026!' -- !! MUST BE CHANGED BEFORE PRODUCTION USE !!
    DEFAULT_ROLE          = POWERBI_TENANT_B
    DEFAULT_SECONDARY_ROLES = ()
    MUST_CHANGE_PASSWORD  = FALSE
    COMMENT               = 'Power BI service account for Tenant B (EA) dashboard. Read-only analytics views.';

-- ---------------------------------------------------------------------------
-- SECTION 2: Grant each role to exactly its matching user
-- Principle of least privilege: one user → one role.
-- ---------------------------------------------------------------------------

-- Tenant A: analyst role → TENANT_A_USER only
GRANT ROLE TENANT_A_ANALYST  TO USER TENANT_A_USER;

-- Tenant B: analyst role → TENANT_B_USER only
GRANT ROLE TENANT_B_ANALYST  TO USER TENANT_B_USER;

-- Support: CAPSTONE_SUPPORT → SUPPORT_USER only
GRANT ROLE CAPSTONE_SUPPORT  TO USER SUPPORT_USER;

-- Power BI Tenant A: POWERBI_TENANT_A → POWERBI_A_USER only
GRANT ROLE POWERBI_TENANT_A  TO USER POWERBI_A_USER;

-- Power BI Tenant B: POWERBI_TENANT_B → POWERBI_B_USER only
GRANT ROLE POWERBI_TENANT_B  TO USER POWERBI_B_USER;

-- ---------------------------------------------------------------------------
-- SECTION 3: Revoke cross-tenant roles from the admin user ARYAN05
-- ARYAN05 retains CAPSTONE_ADMIN for setup/maintenance purposes only.
-- Removing these roles ensures that the admin account cannot accidentally
-- query tenant data via a tenant-scoped role.
-- ---------------------------------------------------------------------------

-- Revoke tenant-scoped analyst roles from admin user
REVOKE ROLE TENANT_A_ANALYST  FROM USER ARYAN05;
REVOKE ROLE TENANT_B_ANALYST  FROM USER ARYAN05;

-- Revoke Power BI roles from admin user
REVOKE ROLE POWERBI_TENANT_A  FROM USER ARYAN05;
REVOKE ROLE POWERBI_TENANT_B  FROM USER ARYAN05;

-- Revoke support role from admin user (admin should use CAPSTONE_ADMIN instead)
REVOKE ROLE CAPSTONE_SUPPORT  FROM USER ARYAN05;

-- ARYAN05 retains CAPSTONE_ADMIN — required for schema/warehouse administration.
-- To verify: SHOW GRANTS TO USER ARYAN05; — should show only CAPSTONE_ADMIN.

-- ---------------------------------------------------------------------------
-- SECTION 4: Verification queries
-- Run each block and inspect the output. Each user should show exactly one
-- role grant; ARYAN05 should show no tenant-scoped roles.
-- ---------------------------------------------------------------------------

-- Check grants to each dedicated user
SHOW GRANTS TO USER TENANT_A_USER;
SHOW GRANTS TO USER TENANT_B_USER;
SHOW GRANTS TO USER SUPPORT_USER;
SHOW GRANTS TO USER POWERBI_A_USER;
SHOW GRANTS TO USER POWERBI_B_USER;

-- Check ARYAN05 no longer holds tenant-scoped roles
SHOW GRANTS TO USER ARYAN05;

-- Check role-to-user grantees (confirms no unexpected principals hold the roles)
SHOW GRANTS OF ROLE TENANT_A_ANALYST;
SHOW GRANTS OF ROLE TENANT_B_ANALYST;
SHOW GRANTS OF ROLE CAPSTONE_SUPPORT;
SHOW GRANTS OF ROLE POWERBI_TENANT_A;
SHOW GRANTS OF ROLE POWERBI_TENANT_B;

-- List all users to confirm creation
SHOW USERS LIKE 'TENANT_%';
SHOW USERS LIKE 'SUPPORT_%';
SHOW USERS LIKE 'POWERBI_%';
