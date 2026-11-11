-- =============================================================================
-- FILE: 06_support_revoke.sql
-- PROJECT: Capstone - CAP-30 Tenant Isolation
-- PURPOSE: End a support break-glass grant early (revoke) and record it, so
-- the access history can tell revoked apart from expired.
-- RUN AS:  ACCOUNTADMIN
-- =============================================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CAPSTONE_WH;
USE DATABASE CAPSTONE_DB;
USE SCHEMA TENANT_DATA;

-- New column: a revoked grant keeps its row, with REVOKED_AT set. Without
-- it, a revoked grant is indistinguishable from an expired one.
ALTER TABLE SUPPORT_ACCESS_LOG ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP_NTZ;

-- ---------------------------------------------------------------------------
-- SP_SUPPORT_REVOKE(): end the caller's active grants now.
-- EXECUTE AS OWNER so the procedure can UPDATE the log (CAPSTONE_SUPPORT has
-- no direct write on TENANT_DATA). CURRENT_USER() is still the caller, so
-- the revoke only ever ends the caller's own grants.
-- Ending a grant sets EXPIRY to now as well: the secure views gate on
-- expiry > CURRENT_TIMESTAMP(), so the data view locks immediately.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE TENANT_DATA.SP_SUPPORT_REVOKE()
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    v_rows INT;
BEGIN
    UPDATE TENANT_DATA.SUPPORT_ACCESS_LOG
       SET revoked_at = CURRENT_TIMESTAMP(),
           expiry     = CURRENT_TIMESTAMP()
     WHERE accessed_by = CURRENT_USER()
       AND expiry > CURRENT_TIMESTAMP()
       AND revoked_at IS NULL;
    v_rows := SQLROWCOUNT;
    IF (v_rows = 0) THEN
        RETURN 'NO_ACTIVE_GRANT: No active grant to end for ' || CURRENT_USER() || '.';
    END IF;
    RETURN 'REVOKED: Ended ' || v_rows || ' active grant(s) for ' || CURRENT_USER() || '.';
END;
$$;

GRANT USAGE ON PROCEDURE TENANT_DATA.SP_SUPPORT_REVOKE() TO ROLE CAPSTONE_SUPPORT;
GRANT USAGE ON PROCEDURE TENANT_DATA.SP_SUPPORT_REVOKE() TO ROLE CAPSTONE_ADMIN;
GRANT USAGE ON SCHEMA CAPSTONE_DB.TENANT_DATA TO ROLE CAPSTONE_SUPPORT;
GRANT USAGE ON SCHEMA CAPSTONE_DB.TENANT_DATA TO ROLE CAPSTONE_ADMIN;

-- V_SUPPORT_LOG gains the new column so the API history endpoint can report
-- revoked vs expired. Re-created as CAPSTONE_ADMIN (owner of ANALYTICS).
USE ROLE CAPSTONE_ADMIN;
USE SCHEMA ANALYTICS;

CREATE OR REPLACE SECURE VIEW ANALYTICS.V_SUPPORT_LOG AS
SELECT log_id, accessed_by, tenant_id, granted_tenant, reason, expiry,
       duration_minutes, accessed_at, revoked_at
FROM TENANT_DATA.SUPPORT_ACCESS_LOG
WHERE accessed_by = CURRENT_USER();

GRANT SELECT ON VIEW ANALYTICS.V_SUPPORT_LOG TO ROLE CAPSTONE_SUPPORT;
GRANT SELECT ON VIEW ANALYTICS.V_SUPPORT_LOG TO ROLE CAPSTONE_ADMIN;

USE ROLE ACCOUNTADMIN;

-- Verification
SHOW PROCEDURES LIKE 'SP_SUPPORT_REVOKE' IN SCHEMA TENANT_DATA;
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_SCHEMA = 'TENANT_DATA' AND TABLE_NAME = 'SUPPORT_ACCESS_LOG'
   AND COLUMN_NAME = 'REVOKED_AT';
