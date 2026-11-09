# CAP-30 — Task 1: What this project is about

## The problem

A SaaS company gives analytics to more than one customer, but they all share the same Snowflake warehouse. So the main question is simple: how do you stop one customer seeing another customer's data?

That is what this project is trying to prove. Not just in the app or in Power BI, but in the database itself. Because if someone runs SQL directly and skips the app, the isolation still has to hold. If it only works because of a filter in Power BI, it is not really secure.

There are two tenants in this demo. Tenant A is Steam Valve Corporation, Tenant B is Electronic Arts. They have different customers and different orders, so if any rows leak across, it will be easy to spot.

## Who is involved

Tenant A analyst — works for Steam Valve Corporation. Uses the role TENANT\_A\_ANALYST. Should only ever see Tenant A rows, through the secure views.

Tenant B analyst — works for Electronic Arts. Uses TENANT\_B\_ANALYST. Same thing, only Tenant B rows.

Platform admin — CAPSTONE\_ADMIN. Sets up the tables, views, roles and grants. Does not use the analyst views for day-to-day looking at data.

Support — CAPSTONE\_SUPPORT. This is the break-glass role. It can see all tenants, but only when there is a real support case, and every time it is used that gets written to SUPPORT\_ACCESS\_LOG.

Power BI user — one role per tenant, for example POWERBI\_TENANT\_A. It connects to that tenant's secure view only, nothing else.

Evaluator — can run direct SQL as any analyst role, to check what is allowed and what is denied.

## The rules for the data

Every row in the fact tables has a tenant\_id. If a row does not have a proper tenant, an analyst should not be able to see it.

Analysts get no SELECT on the base tables at all — no TENANT, CUSTOMER, ORDERS or ORDER\_LINE directly. They only get SELECT on the secure views.

A secure view works out who is asking by checking CURRENT\_ROLE(), looking that role up in ROLE\_TENANT\_MAP, and then only showing rows for that tenant.

Support is kept separate. It has its own view for all tenants, and it is only meant to be used through the support workflow, with a log entry.

All the data is made up. No real customer or employee data is used anywhere.

And this is all on Snowflake Standard Edition.

## The data

Two tenants, about 20 customers each, and about 200 orders each, with order lines. That is enough to test with, and small enough to check by hand.

A few bad rows are put in on purpose, to see how ingestion handles them: one malformed row, one row with a missing or unknown tenant, and one duplicate order line. They should go to an error table, not just disappear quietly.

## How to tell if it works

This is not something to just claim. Each of these should be testable later:

1. Run a query as Tenant A on the secure view. Only Tenant A rows come back, and the count matches the source CSV.
2. Same for Tenant B. Only Tenant B rows.
3. Try SELECT \* FROM ORDERS as either analyst. It should be denied.
4. As Tenant A, try WHERE tenant\_id = 'B'. Still only Tenant A rows should come back.
5. Support can query all tenants through the support view, and a row gets added to SUPPORT\_ACCESS\_LOG for it.
6. Revoke a grant, then run the same query again. It should now be denied.
7. Power BI logged in as Tenant A only shows Tenant A numbers.
8. Warehouse usage can be checked by role in QUERY\_HISTORY and WAREHOUSE\_METERING\_HISTORY.
9. The React app logged in as Tenant A only shows Tenant A numbers too. It only talks to the Spring Boot API, it never talks to Snowflake directly.

## The KPIs

All of these are per tenant, not across both tenants together.

Total Revenue is the sum of order line revenue for that tenant. Total Orders is the number of distinct orders for that tenant. Total Customers is the number of distinct customers who have at least one order. Average Order Value is just Total Revenue divided by Total Orders.

## What is being assumed

I only have Standard Edition, so row access policies are not an option — those need Enterprise. Same for column masking and multi-cluster warehouses. So the isolation here is done with roles, secure views, and a role-to-tenant mapping table instead. That is a limit of the edition, not a choice to skip security.

Time Travel is 1 day on Standard.

There is one warehouse, X-Small, single cluster, auto-suspend after 60 seconds, auto-resume on. Workloads are told apart later with query tags and by role, not by having a warehouse per workload.

Data comes in as Python to S3, then to a Snowflake stage, then COPY INTO the tables.

Spring Boot is the app layer. It does not decide who sees what on its own — it passes the tenant role through to Snowflake and queries the secure view.

React is the frontend. It calls the Spring Boot API and shows that tenant's numbers. It does not decide isolation either, and it never queries Snowflake or the base tables directly.

This is a solo project, so one person is doing all of it.

## What could go wrong

An admin or support role could query the base tables directly, since they have more access. That is why who holds those roles is written down, and why support use is logged.

Another risk is thinking a Power BI filter is enough. It is not, which is why Power BI only ever reads the secure view, never the base tables.

And the evaluator might change a rule, take away a permission, or send in a bad record. That is what the negative tests and the ingestion error table are for in the later tasks.

## Repo layout

```
/sql        — Snowflake setup, tables, views, grants, tests
/python     — synthetic data generator, validation, ingestion
/app        — Spring Boot app
/frontend   — React UI, calls the Spring Boot API only
/powerbi    — report notes and connection details
/docs       — scope, ERD, design notes, runbook, demo script
/tests      — negative access tests and expected results
AI_USAGE_LOG.md
README.md
```

## 