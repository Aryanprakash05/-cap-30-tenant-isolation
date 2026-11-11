# CAP-30 — Task 8: Power BI layer, API, and React UI

## Scope

Three parts. Power BI connects to Snowflake as the tenant Power BI users and reads only the secure views. Spring Boot exposes a read-only API over the same views, and React calls that API. The API enforces access with server-side sessions: a login returns a token that maps to one Snowflake role, and every request carries that token. The Snowflake connection is opened as that role, so the secure view is a second check behind the API check. Power BI is deferred — it runs on the Windows laptop later. Spring Boot (Part B) and React (Part C) run locally now.

## Part A: Power BI (deferred)

Connect Power BI to Snowflake as the dedicated tenant user, not as ARYAN05.

Connection:
- Server: `FQ39967.ap-southeast-7.aws.snowflakecomputing.com`
- Warehouse: `CAPSTONE_WH`
- Database: `CAPSTONE_DB`, schema `ANALYTICS`
- Tenant A report: user `POWERBI_A_USER`, role `POWERBI_TENANT_A`
- Tenant B report: user `POWERBI_B_USER`, role `POWERBI_TENANT_B`
- Authentication: the user's own Snowflake password (set after `sql/01_users_and_roles.sql`)

Use DirectQuery. Do not configure Power BI RLS: isolation comes from the secure views, and adding a second filter would hide a failure in the view layer instead of proving it works.

Tables to import, from `ANALYTICS` only:
- `V_KPIS` — one row per tenant, with Total Orders, Total Customers, Total Revenue, Average Order Value
- `V_CUSTOMER` — customers for the tenant
- `V_ORDERS` — orders for the tenant
- `V_ORDER_LINE` — order lines for the tenant

Do not import from `TENANT_DATA`. The Power BI users have no access to it.

Report, one page per tenant or one report per tenant:
- KPI cards: Total Revenue, Total Orders, Total Customers, Average Order Value (from `V_KPIS`)
- Revenue by product category (from `V_ORDER_LINE` joined to `V_PRODUCT`)
- Orders by month (from `V_ORDERS`)
- Top customers by revenue (from `V_CUSTOMER` joined to `V_ORDER_LINE`)

Verify: the Tenant A report shows only STEAM (revenue 656,950.40). The Tenant B report shows only EA (revenue 854,522.10). If a report shows both tenants, the wrong user or role was used.

## Part B: Spring Boot API

Spring Boot is a read-only API. It does not filter rows in Java. It passes the caller's role through to Snowflake and lets the secure view do the filtering.

Access is enforced in two places:
1. The API checks the session against the tenant on every request. Login (`POST /api/auth/login`) validates the username and password server-side and returns a token. Every data request sends `Authorization: Bearer <token>`. `TENANT_A_ANALYST` maps to `STEAM`, `TENANT_B_ANALYST` maps to `EA`. A request for the other tenant returns 403 with `"Role TENANT_A_ANALYST is not allowed to access tenant EA"`. A request with no token, or an unknown token, returns 401. The old `X-Role` header is not accepted.
2. The Snowflake connection is opened as that role, with `USE SECONDARY ROLES NONE`, and the query reads the secure view with the role's tenant as the filter. If the API check were bypassed, the view still returns only that role's tenant.

Setup, local only:
- Java 17, Spring Boot 3, Snowflake JDBC driver
- `application.properties` holds the Snowflake connection: account, warehouse `CAPSTONE_WH`, database `CAPSTONE_DB`, schema `ANALYTICS`, host
- One credential per role, all from environment variables (see `.env.example`): `SNOWFLAKE_TENANT_A_USER` / `SNOWFLAKE_TENANT_A_PASSWORD`, `SNOWFLAKE_TENANT_B_USER` / `SNOWFLAKE_TENANT_B_PASSWORD`, `SNOWFLAKE_SUPPORT_USER` / `SNOWFLAKE_SUPPORT_PASSWORD`, `SNOWFLAKE_POWERBI_A_USER` / `SNOWFLAKE_POWERBI_A_PASSWORD`, `SNOWFLAKE_POWERBI_B_USER` / `SNOWFLAKE_POWERBI_B_PASSWORD`, `SNOWFLAKE_ADMIN_USER` / `SNOWFLAKE_PASSWORD`. The API connects as the dedicated user for each role; the admin connection is used only for usage stats.
- Every API connection sets a query tag: `tenant=<STEAM|EA|MULTI>,role=<ROLE>,workload=api`.

Endpoints:
- `POST /api/auth/login` — `{username, password}` → `{token, role, tenant, username}`
- `POST /api/auth/logout` — invalidates the token
- `GET /api/kpis` — Total Revenue, Total Orders, Total Customers, Average Order Value for the caller's tenant. `?tenant` is optional: when given, the service checks it against the session role and returns 403 on a mismatch. Analysts can omit it.
- `GET /api/orders` — orders for the caller's tenant (latest 100); `?tenant` optional, same rule
- `GET /api/orders/{orderId}` — one order with its lines; `?tenant` optional, same rule
- `GET /api/analytics/summary` — revenue by month, by channel, by category, top 10 customers, top 10 products (for the caller's tenant). Feeds the Dashboard charts.
- `POST /api/support/grant` — `{reason, tenant, durationMinutes}`; calls `SP_SUPPORT_GRANT` (support/admin only)
- `POST /api/support/revoke` — ends the caller's active grants now; calls `SP_SUPPORT_REVOKE` (support/admin only). Needs `sql/06_support_revoke.sql` run first.
- `GET /api/support/status` — the caller's active grants (support/admin only)
- `GET /api/support/history` — last 50 grant log entries with status active / expired / revoked (support/admin only)
- `GET /api/support/customers` — masked customers through `V_SUPPORT_CUSTOMER`; 0 rows without an active grant (support/admin only)
- `POST /api/evidence/run` — runs the server-side isolation test suite (10 checks) and returns each check with expected, actual, PASS/FAIL, row count, HTTP status, Snowflake query ID, and timestamp (any logged-in role)
- `GET /api/usage` — query counts and seconds by role and query tag, last 7 days (any logged-in role), plus a cost summary: metered warehouse credits from `WAREHOUSE_METERING_HISTORY` split per tenant by each tenant's share of tagged query time, with an estimated cost at `SNOWFLAKE_CREDIT_PRICE_USD` (default $2.40, the Standard on-demand list price for AWS Asia Pacific (Thailand), verified from Snowflake's Service Consumption Table effective 9 Nov 2026 — set it to your region's rate if your account is elsewhere), plus daily credits for the last 7 days and the resource monitor (CAPSTONE_RM, 10-credit cap)
- `GET /api/ingestion` — ingestion health from `INGESTION_LOG` and `INGESTION_ERRORS` (staff only)
- `GET /api/health` — API status, Snowflake connectivity, warehouse name/state/size

Run the new SQL first, then restart the backend. `sql/06_support_revoke.sql` adds `revoked_at` to `SUPPORT_ACCESS_LOG` and creates `SP_SUPPORT_REVOKE`. Run it in Snowsight as ACCOUNTADMIN, then restart the backend — the status/history endpoints read `revoked_at`, so the backend breaks if it is restarted before 06 runs.

Every data endpoint also returns an `X-Snowflake-Query-Id` response header with the Snowflake query ID of the statement that served the request. The UI shows it in the Audit Log runner and the Evidence checks, so any result can be looked up in `QUERY_HISTORY` to verify the exact query, role, and tag.

Run, in two terminals. Spring Boot does not read `.env`: export the passwords in the same terminal that starts the backend.
- Backend: `cd app`, then export the password variables from `.env` (for example `set -a; source ../.env; set +a`), then `mvn spring-boot:run`. Wait for `Started CapstoneApplication`. API on `http://localhost:8080`.
- Frontend: `cd frontend`, then `npm install`, then `npm run dev`. UI on `http://localhost:5173`.

## Part C: React UI

React is a display layer only. It calls the Spring Boot API and shows what comes back. It does not connect to Snowflake and does not filter rows. The product is called DataVault: one shared warehouse, two tenants, zero cross-tenant reads.

Login first: pick "Steam Valve Corporation", "Electronic Arts", or the staff card "Platform Support". There is no tenant switcher after login — the logged-in role fixes the tenant. Login calls `POST /api/auth/login` and keeps the session token in memory only (never localStorage). Every API call sends it as `Authorization: Bearer`. Demo accounts sit behind a collapsible "Demo accounts (evaluation only)" panel; the passwords are filled in by an Autofill button and never shown on screen.

Pages, after login (tenant analysts):
- Dashboard: KPI cards (Total Revenue, Total Orders, Total Customers, Average Order Value, each with a plain-language definition on hover) and charts from `/api/analytics/summary` — revenue by month, by channel, by category, top 10 customers, top 10 products — then the Orders explorer (search, channel filter, click a row to see its lines). A "Data isolation: verified" chip opens a drawer with the last Evidence run; it only claims verified after a run has passed.
- Security & Evidence: who you are to the database (username, Snowflake role, data scope, and where the enforcement lives), a "Run isolation tests" button that runs the server-side 10-check suite, a "Try to break it" panel that really calls the other tenant's KPIs and orders and shows Expected vs Actual only after the call, the API request runner (endpoint and tenant, then Response / cURL / SQL tabs and a request log with Snowflake query IDs), a recorded Direct-SQL proof section from `sql/04_isolation_proof.sql` (base-table read denied, cross-tenant WHERE returns 0), and the SQL a reviewer can paste into a worksheet.
- Usage & Cost: total credits and estimated cost for the last 7 days, queries, the resource monitor meter (CAPSTONE_RM, 10-credit cap), daily credits chart, cost split per tenant (STEAM, EA, SHARED platform work, UNTAGGED work without a tag), and usage by role and query tag. All dollar figures use the $2.40/credit Thailand Standard rate unless `SNOWFLAKE_CREDIT_PRICE_USD` is set.

Pages, after login (support):
- Support Console: three steps. Step 1 requests access (tenant, reason of at least 10 characters, duration 15–480 minutes). Step 2 is the data view: before any grant it shows "No active grant — data locked" and a "Prove the lock" button that calls the masked-customers endpoint and shows it returned 0 rows; with a grant it shows masked customers and the granted tenant's orders. Step 3 is the access history table (who, tenant, reason, granted, expires, duration, status active / expired / revoked). An active grant shows a banner with a live countdown and an "End access now" button, which calls `POST /api/support/revoke`.
- Security & Evidence: same as analysts, plus support-specific checks in the suite.
- Usage & Cost: same as analysts, plus ingestion health (files loaded, rows loaded vs rejected, with reasons) and system health (API status, Snowflake connectivity, warehouse state) — staff only.

Verify:
- Log in as Tenant A: STEAM only, revenue 656,950.40, 200 orders, 20 customers. Evidence panel: 10/10 passed (support tests run when no grant is open). "Try to break it" on EA KPIs shows 403 after the call.
- Usage tab shows the cost summary: total metered credits for CAPSTONE_WH (last 7 days) split into STEAM, EA, SHARED, and UNTAGGED, with an estimated cost per tenant at $2.40/credit. Evidence checks each show a Snowflake query ID — look one up in `QUERY_HISTORY` to verify the exact query, role, and tag.
- Log out, log in as Tenant B: EA only, revenue 854,522.10, 200 orders, 20 customers. Evidence panel: 10/10 passed. "Try to break it" on STEAM shows 403.
- Log in as support: the Support Console shows "No active grant — data locked" and 0 customers. Request a grant for STEAM (reason at least 10 characters, 30 minutes): the banner shows it active with a countdown, and masked customers now list STEAM's 20 customers with names like `A*** [REDACTED PII]`. Click "End access now": the data view locks again, and the history row shows status revoked.
- From a terminal, with the API running, this must return 401 (no token): `curl "http://localhost:8080/api/kpis?tenant=EA"`

## Limits

- The demo login passwords are hardcoded in `AuthService.java`. This is a demo identity provider, not real authentication; production would use an external IdP.
- The support gate covers the data views. It does not cover warehouse-level actions.
- The S3 stage still uses an IAM-user access key, because the org RCP/SCP blocks the Snowflake storage integration AssumeRole path. See `docs/05_runbook.md`.
- `sql/sql-05-support.sql` and `sql/sql-06-access-tests.sql` are obsolete: they assume ARYAN05 holds the tenant roles.

## Done when

- Power BI Tenant A report shows only STEAM, Tenant B report shows only EA (Part A, later on the Windows laptop)
- Spring Boot API runs locally, returns the right KPIs per role, returns 403 for the other tenant, and 401 without a token
- React UI runs locally, login goes through the server-side session, the Evidence suite passes 10/10 for both tenant roles (support checks run when no grant is open; they skip, with a reason, when one is), and the support console shows masked customers only while a grant is active, locks again on revoke, and records the revoked status in history
- App and frontend code, plus this guide, committed and pushed
