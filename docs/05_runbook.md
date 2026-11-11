# Runbook — CAP-30 Hardening (dedicated users, break-glass, CI)

## What changed

The original setup ran everything through one user (ARYAN05) that held all
six roles plus ACCOUNTADMIN. Any credential with that user could switch roles
and read both tenants, so the isolation was only as strong as the UI. The
hardening moves the boundary into Snowflake:

- Five dedicated users, one role each: TENANT_A_USER, TENANT_B_USER,
  SUPPORT_USER, POWERBI_A_USER, POWERBI_B_USER (`sql/01_users_and_roles.sql`).
  ARYAN05 keeps CAPSTONE_ADMIN only.
- ANALYTICS views owned by CAPSTONE_ADMIN, PUBLIC revoked
  (`sql/02_harden_views.sql`). A zero-copy backup schema ANALYTICS_BACKUP is
  kept for rollback.
- Break-glass is database-enforced: `SP_SUPPORT_GRANT` records a grant with
  an expiry, and every ANALYTICS view returns 0 rows for CAPSTONE_SUPPORT
  unless an active grant exists for that user (`sql/03_support_procedure.sql`).
  Customer names in the support view are masked.
- Backend connects per role with the dedicated user's credentials and sets a
  query tag on every connection. Login is server-side sessions; the X-Role
  header is no longer accepted (`app/`).
- Tests run as the dedicated users: T0–T9 in `tests/run_access_tests.py`,
  T10–T19 in `tests/test_isolation_extended.py`. CI runs lint, both suites,
  and the API + frontend builds (`.github/workflows/test.yml`).
- Terraform for the S3 bucket and stage IAM policy (`infra/main.tf`).
- One-command demo (`demo/run_demo.sh`).

## Order of operations — follow this sequence

Running 01 revokes the tenant roles from ARYAN05. After that, the old test
runner, the old Task 6 SQL file, the old backend, and `demo/run_demo.sh`
as previously written all stop working until the steps below are done.
Do not run 01 until the GitHub secrets in step 1 are set.

### 1. GitHub secrets (repo Settings → Secrets and variables → Actions)

Keep the existing SNOWFLAKE_ACCOUNT, SNOWFLAKE_HOST, SNOWFLAKE_USER and
SNOWFLAKE_PASSWORD. Add:

- SNOWFLAKE_ADMIN_USER = ARYAN05
- SNOWFLAKE_TENANT_A_USER = TENANT_A_USER
- SNOWFLAKE_TENANT_A_PASSWORD = (password set in step 2)
- SNOWFLAKE_TENANT_B_USER = TENANT_B_USER
- SNOWFLAKE_TENANT_B_PASSWORD = (password set in step 2)
- SNOWFLAKE_SUPPORT_USER = SUPPORT_USER
- SNOWFLAKE_SUPPORT_PASSWORD = (password set in step 2)
- SNOWFLAKE_POWERBI_A_USER = POWERBI_A_USER
- SNOWFLAKE_POWERBI_A_PASSWORD = (password set in step 2)
- SNOWFLAKE_POWERBI_B_USER = POWERBI_B_USER
- SNOWFLAKE_POWERBI_B_PASSWORD = (password set in step 2)

### 2. Snowflake — users, then rotate the placeholder passwords

Run `sql/01_users_and_roles.sql` as ACCOUNTADMIN in Snowsight. It creates
the five users with placeholder passwords that are visible in the repo, so
rotate them immediately, in the same session, with strong passwords typed
directly in the worksheet (never in chat):

```sql
ALTER USER TENANT_A_USER SET PASSWORD = '<strong-password>';
ALTER USER TENANT_B_USER SET PASSWORD = '<strong-password>';
ALTER USER SUPPORT_USER SET PASSWORD = '<strong-password>';
ALTER USER POWERBI_A_USER SET PASSWORD = '<strong-password>';
ALTER USER POWERBI_B_USER SET PASSWORD = '<strong-password>';
```

Verify with the checks at the end of the file: each dedicated user shows
exactly one role grant, and `SHOW GRANTS TO USER ARYAN05` shows no
tenant-scoped roles.

### 3. Snowflake — harden views, then support procedure

Run `sql/02_harden_views.sql` as ACCOUNTADMIN, then
`sql/03_support_procedure.sql` as ACCOUNTADMIN. Order matters: 03 creates
its views as CAPSTONE_ADMIN, which only works after 02 has transferred
ownership and granted it SELECT on the base tables.

### 4. Snowflake — proof and reconciliation

Run `sql/05_reconciliation.sql` as ACCOUNTADMIN. Expected: counts 2 / 40 /
24 / 400 / 837, revenue STEAM 656950.40 and EA 854522.10, variance 0,
orphan checks 0.

Run `sql/04_isolation_proof.sql` by hand, one block per session, logged in
as the user named in each block (TENANT_A_USER, TENANT_B_USER,
SUPPORT_USER). It cannot be run top-to-bottom in a single session. Expected:
A sees STEAM only, B sees EA only, base-table reads denied, support sees 0
rows before the grant and masked STEAM rows after it.

### 5. Tests (local)

From the repo root, with the passwords exported in the shell:

```bash
python tests/run_access_tests.py
python -m pytest tests/test_isolation_extended.py -v
```

Expected: 28/28, then 10 passed (T10–T19). T12 takes 70 seconds and only
runs with `SLOW_TESTS=1`. Then push: CI runs the same suites plus lint and
both builds.

### 6. Backend

Copy `.env.example` to `.env` and fill in the five user passwords from
step 2. Start the API from `app/`:

```bash
SNOWFLAKE_PASSWORD='<admin-password>' mvn spring-boot:run
```

Login is `POST /api/auth/login` with the demo usernames (steam_analyst,
ea_analyst, support_user). Every data call needs the Bearer token from the
login response. The old X-Role header no longer works.

### 7. Frontend — not done yet

The React app still sends the X-Role header and does the demo login in the
browser. Do not deploy the new backend on its own: the current frontend
gets 401 on every call. The frontend rework (Bearer-token login, support
console, isolation evidence and usage panels) is the next step.

## Rollback

If 02 or 03 breaks the views, restore the backup taken by 02:

```sql
USE ROLE ACCOUNTADMIN;
DROP SCHEMA CAPSTONE_DB.ANALYTICS;
ALTER SCHEMA CAPSTONE_DB.ANALYTICS_BACKUP RENAME TO ANALYTICS;
```

Then re-run 02 from Section 2 onward. To undo 01, re-grant the roles to
ARYAN05 (`GRANT ROLE TENANT_A_ANALYST TO USER ARYAN05;` and the same for
the other five) and drop the dedicated users if they are not needed.

## Known limitations (state these honestly in the viva)

- The five placeholder passwords in `sql/01_users_and_roles.sql` are in the
  repo. They are only safe because step 2 rotates them immediately; until
  rotated, anyone with repo access knows them.
- The demo login passwords in `AuthService.java` (steam_analyst,
  ea_analyst, support_user) are hardcoded in source. This is a demo identity
  provider, not real authentication; production would use an external IdP.
- The support gate covers data views. It does not cover warehouse-level
  actions (a support user cannot create objects, but that is out of scope).
- The S3 stage still uses an IAM-user access key, because the org RCP/SCP
  blocks the Snowflake storage integration AssumeRole path. The Terraform
  file documents this and names the integration as the target architecture.
  The IAM-user key pair shared in chat on 2026-11-10 still needs rotating.
- `sql/sql-05-support.sql` and `sql/sql-06-access-tests.sql` are obsolete:
  they assume ARYAN05 holds the tenant roles. Use the test suites and
  `sql/04_isolation_proof.sql` instead.
- Power BI is still pending on the Windows laptop. The connection uses
  POWERBI_A_USER / POWERBI_B_USER with DirectQuery; isolation comes from
  the secure views, not from Power BI RLS (deliberately not configured).
