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
- `GET /api/kpis?tenant=STEAM` — Total Revenue, Total Orders, Total Customers, Average Order Value for that tenant
- `GET /api/orders?tenant=STEAM` — orders for that tenant (latest 100)
- `GET /api/orders/{orderId}?tenant=STEAM` — one order with its lines
- `POST /api/support/grant` — `{reason, tenant, durationMinutes}`; calls `SP_SUPPORT_GRANT` (support/admin only)
- `GET /api/support/status` — last 5 grant log entries for the caller (support/admin only)
- `GET /api/support/customers` — masked customers through `V_SUPPORT_CUSTOMER`; 0 rows without an active grant (support/admin only)
- `GET /api/usage` — query counts and seconds by role and query tag, last 7 days (any logged-in role)
- `GET /api/health` — API status

Run, in two terminals:
- Backend: `cd app`, copy `.env.example` to `.env` and fill in the passwords, then `mvn spring-boot:run`. Wait for `Started CapstoneApplication`. API on `http://localhost:8080`.
- Frontend: `cd frontend`, then `npm install`, then `npm run dev`. UI on `http://localhost:5173`.

## Part C: React UI

React is a display layer only. It calls the Spring Boot API and shows what comes back. It does not connect to Snowflake and does not filter rows.

Login first: pick "Steam Valve Corporation", "Electronic Arts", or "Platform Support". There is no tenant switcher after login — the logged-in role fixes the tenant. Login calls `POST /api/auth/login` and stores the session token; every API call sends it as `Authorization: Bearer`.

Demo credentials (shown on the login screen):
- `steam_analyst` — Tenant A Analyst, STEAM
- `ea_analyst` — Tenant B Analyst, EA
- `support_user` — Platform Support, all tenants (grant-gated)

Pages, after login (tenant analysts):
- Dashboard: KPI cards (Total Revenue, Total Orders, Total Customers, Average Order Value) and recent transactions
- Orders: orders table for your tenant; click a row to see its lines
- Audit Log: API request runner (pick an endpoint and a tenant, run it, see the live 200/403 response, the equivalent cURL command with your token, and the Snowflake SQL equivalent), plus a real-time access log table
- Evidence: four scripted live checks — own KPIs (revenue must match 656,950.40 for STEAM / 854,522.10 for EA), cross-tenant KPIs (must be 403), own orders, cross-tenant orders (must be 403) — with a PASS/FAIL verdict per check
- Usage: warehouse query counts and seconds by role and query tag, last 7 days

Pages, after login (support):
- Support: break-glass grant form (reason, tenant, duration up to 8 hours), grant status with a live countdown, and masked customers (names masked to first letter, 0 rows without an active grant)
- Audit Log: session scope and access log
- Usage: same warehouse usage view

Verify:
- Log in as Tenant A: STEAM only, revenue 656,950.40, 200 orders, 20 customers. Evidence panel: 4/4 passed. The Audit Log runner for EA shows 403.
- Log out, log in as Tenant B: EA only, revenue 854,522.10, 200 orders, 20 customers. Evidence panel: 4/4 passed. The Audit Log runner for STEAM shows 403.
- Log in as support: the Support tab shows 0 customers before a grant. Request a grant for STEAM (reason at least 10 characters, 60 minutes): status shows it active with a countdown, and masked customers now list STEAM's 20 customers with names like `P*** [REDACTED PII]`.
- From a terminal, with the API running, this must return 401 (no token): `curl "http://localhost:8080/api/kpis?tenant=EA"`

## Limits

- The demo login passwords are hardcoded in `AuthService.java`. This is a demo identity provider, not real authentication; production would use an external IdP.
- The support gate covers the data views. It does not cover warehouse-level actions.
- The S3 stage still uses an IAM-user access key, because the org RCP/SCP blocks the Snowflake storage integration AssumeRole path. See `docs/05_runbook.md`.
- `sql/sql-05-support.sql` and `sql/sql-06-access-tests.sql` are obsolete: they assume ARYAN05 holds the tenant roles.

## Done when

- Power BI Tenant A report shows only STEAM, Tenant B report shows only EA (Part A, later on the Windows laptop)
- Spring Boot API runs locally, returns the right KPIs per role, returns 403 for the other tenant, and 401 without a token
- React UI runs locally, login goes through the server-side session, the Evidence panel passes 4/4 for both tenant roles, and the support console shows masked customers only while a grant is active
- App and frontend code, plus this guide, committed and pushed
