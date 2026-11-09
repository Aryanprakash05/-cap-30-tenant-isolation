# CAP-30 — Multi-Tenant Analytics Isolation

This is a small demo of a problem most SaaS companies run into: one shared warehouse, more than one customer, and each customer should only see their own data.

The idea here is to prove that in Snowflake itself. Not just by hiding things in the app or in Power BI, but by making sure a direct SQL query still cannot pull another tenant's rows.

It is a solo project. Everything in the stack is used: Snowflake SQL, Python, S3, IAM, Power BI, Spring Boot, React, and GitHub Actions.

## The stack, in short

Snowflake is on Standard Edition. Row access policies need Enterprise, so they are not used here. Instead the isolation is done with roles, secure views, and a table that maps each role to a tenant.

Python makes the fake data and checks it. S3 is where the CSVs go first, with IAM set up so Snowflake can read them with as little access as needed. Spring Boot is the API in the middle — it passes the tenant role through and only queries the secure views. React is the frontend and only talks to that API. Power BI connects to the secure view for one tenant at a time. GitHub Actions runs the Python and SQL checks on push.

## The two tenants

Tenant A is Steam Valve Corporation. Tenant B is Electronic Arts.

They have separate customers and orders on purpose, so a leak would stand out straight away.

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

## How the isolation works

Every fact row has a tenant_id. Analyst roles cannot select from the base tables at all. They can only select from secure views, and a secure view checks the current role, looks it up in the role-to-tenant map, and filters to that tenant.

Support has a separate view that can see all tenants, but only through the support workflow, and each use is logged.

Power BI and React are not the security layer here. Power BI only reads the secure view. React only calls the Spring Boot API, which only reads the secure view.

## The demo

First, Tenant A access — a direct SQL query returns only Tenant A rows. Then Tenant B denial — the same kind of query from Tenant A does not return Tenant B rows. Then the support workflow — support can see all tenants, and that use is logged. And through all of it, the counts are checked back: CSV to Snowflake to Power BI, they should match.
