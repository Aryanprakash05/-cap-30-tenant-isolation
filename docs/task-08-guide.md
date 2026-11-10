# CAP-30 — Task 8: Power BI layer and React UI

## Scope

Three parts. Power BI connects to Snowflake as the tenant Power BI roles and reads only the secure views. Spring Boot exposes a read-only API over the same views, and React calls that API. The API enforces access by role: a request for the other tenant is refused with 403, and the Snowflake connection is opened as the caller's role, so the secure view is a second check behind the API check. Power BI is deferred — it runs on the Windows laptop later. Spring Boot (Part B) and React (Part C) run locally now.

## Part A: Power BI (deferred)

Connect Power BI to Snowflake as the tenant role, not as ACCOUNTADMIN.

Connection:
- Server: `FQ39967.ap-southeast-7.aws.snowflakecomputing.com`
- Warehouse: `CAPSTONE_WH`
- Database: `CAPSTONE_DB`, schema `ANALYTICS`
- Role: `POWERBI_TENANT_A` for the Tenant A report, `POWERBI_TENANT_B` for the Tenant B report
- Authentication: Snowflake user `ARYAN05` with the role above

Tables to import, from `ANALYTICS` only:
- `V_KPIS` — one row per tenant, with Total Orders, Total Customers, Total Revenue, Average Order Value
- `V_CUSTOMER` — customers for the tenant
- `V_ORDERS` — orders for the tenant
- `V_ORDER_LINE` — order lines for the tenant

Do not import from `TENANT_DATA`. The Power BI roles have no access to it.

Report, one page per tenant or one report per tenant:
- KPI cards: Total Revenue, Total Orders, Total Customers, Average Order Value (from `V_KPIS`)
- Revenue by product category (from `V_ORDER_LINE` joined to `V_PRODUCT`)
- Orders by month (from `V_ORDERS`)
- Top customers by revenue (from `V_CUSTOMER` joined to `V_ORDER_LINE`)

Verify: the Tenant A report shows only STEAM (revenue 656,950.40). The Tenant B report shows only EA (revenue 854,522.10). If a report shows both tenants, the wrong role was used.

## Part B: Spring Boot API

Spring Boot is a read-only API. It does not filter rows in Java. It passes the caller's role through to Snowflake and lets the secure view do the filtering.

Access is enforced in two places:
1. The API checks the role against the tenant on every request. Each request must send an `X-Role` header (`TENANT_A_ANALYST` or `TENANT_B_ANALYST`). `TENANT_A_ANALYST` maps to `STEAM`, `TENANT_B_ANALYST` maps to `EA`. A request for the other tenant returns 403 with `"Role TENANT_A_ANALYST is not allowed to access tenant EA"`. An unknown role returns 400.
2. The Snowflake connection is opened as that role, with `USE SECONDARY ROLES NONE`, and the query reads the secure view with the role's tenant as the filter. If the API check were bypassed, the view still returns only that role's tenant.

Setup, local only:
- Java 17, Spring Boot 3, Snowflake JDBC driver
- `application.properties` holds the Snowflake connection: account, warehouse `CAPSTONE_WH`, database `CAPSTONE_DB`, schema `ANALYTICS`, user `ARYAN05`
- The password comes from the `SNOWFLAKE_PASSWORD` environment variable, not from the properties file

Endpoints, all read-only:
- `GET /api/kpis?tenant=STEAM` — Total Revenue, Total Orders, Total Customers, Average Order Value for that tenant
- `GET /api/orders?tenant=STEAM` — orders for that tenant (latest 100)
- `GET /api/orders/{orderId}?tenant=STEAM` — one order with its lines

Every endpoint needs the `X-Role` header. A request without a matching role and tenant is refused before Snowflake is queried.

Run, in two terminals:
- Backend: `cd app`, then `SNOWFLAKE_PASSWORD='<your Snowflake password>' mvn spring-boot:run`. Wait for `Started CapstoneApplication`. API on `http://localhost:8080`.
- Frontend: `cd frontend`, then `npm install`, then `npm run dev`. UI on `http://localhost:5173`.

## Part C: React UI

React is a display layer only. It calls the Spring Boot API and shows what comes back. It does not connect to Snowflake and does not filter rows.

Login first: pick "Tenant A Analyst" or "Tenant B Analyst". There is no tenant switcher after login — the logged-in role fixes the tenant. The UI sends that role in the `X-Role` header on every request.

Page, after login:
- KPI cards: Total Revenue, Total Orders, Total Customers, Average Order Value
- Orders table for your tenant; click a row to see its lines
- Button: "Try to access [other tenant] data" — calls the API for the other tenant with your role and shows the 403 denial on screen
- Log out button, to switch roles

Verify:
- Log in as Tenant A: STEAM only, revenue 656,950.40, 200 orders, 20 customers. The cross-tenant button shows the 403 denial for EA.
- Log out, log in as Tenant B: EA only, revenue 854,522.10, 200 orders, 20 customers. The cross-tenant button shows the 403 denial for STEAM.
- From a terminal, with the API running, this must return 403: `curl -H "X-Role: TENANT_A_ANALYST" "http://localhost:8080/api/kpis?tenant=EA"`

## Limits

The `X-Role` header is a demo identity, not authentication. Anyone who can call the API can send either role header, so the header alone does not prove who the caller is. What it does prove is the enforcement chain: the API refuses a mismatched role and tenant, and the Snowflake connection runs as the stated role against the secure views, so a caller cannot reach the other tenant's rows through the API. Real login (password, token) is out of scope for this capstone.

## Done when

- Power BI Tenant A report shows only STEAM, Tenant B report shows only EA (Part A, later on the Windows laptop)
- Spring Boot API runs locally, returns the right KPIs per role, and returns 403 for the other tenant
- React UI runs locally, login locks the user to one tenant, and the cross-tenant button shows the 403 denial for both roles
- App and frontend code, plus this guide, committed and pushed
