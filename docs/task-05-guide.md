# CAP-30 — Task 5: Roles and support workflow

## Scope

Define the role model, the break-glass process for support access, and the admin assumptions. Support can access all tenants, but only through the secure views and only with a log entry.

## Roles

| Role | Tenant | Access |
| --- | --- | --- |
| TENANT\_A\_ANALYST | STEAM | Secure views, STEAM rows only |
| TENANT\_B\_ANALYST | EA | Secure views, EA rows only |
| POWERBI\_TENANT\_A | STEAM | Secure views, STEAM rows only |
| POWERBI\_TENANT\_B | EA | Secure views, EA rows only |
| CAPSTONE\_SUPPORT | ALL | Secure views, all rows, logged |
| CAPSTONE\_ADMIN | ALL | Setup only, not routine queries |

Analyst and Power BI roles have no access to base tables. Support and admin map to `ALL` in `ROLE_TENANT_MAP`.

## Break-glass process

Support access to tenant data follows these steps, in order:

1. Switch to `CAPSTONE_SUPPORT` and disable secondary roles.
2. Insert a row into `TENANT_DATA.SUPPORT_ACCESS_LOG` with who accessed, which tenant, and why.
3. Query the secure views in `ANALYTICS` only. Never query base tables directly.
4. Switch back to the normal role when done.

The log row must be inserted before the query, not after. An access without a log row is a process violation.

Example, run as ACCOUNTADMIN:

```
INSERT INTO SUPPORT_ACCESS_LOG (accessed_by, tenant_id, reason) VALUES
('ARYAN05', 'STEAM', 'Investigating order discrepancy reported by Tenant A');
```

Then as `CAPSTONE_SUPPORT`:

```
SELECT * FROM ANALYTICS.V_KPIS;
```

This returns both tenants, because support maps to `ALL`. The log entry is the audit trail for that access.

## Admin assumptions

- `CAPSTONE_ADMIN` is for setup only: creating objects, granting roles, changing the role map. It is not used for routine tenant queries.
- The admin role is held by the platform owner. It is not granted to tenant analysts or the Power BI service users.
- `ACCOUNTADMIN` (Snowflake system role) is used for setup in this project. In production it would be a separate admin user, not the account owner.
- Role grants are managed by the admin. An analyst cannot grant themselves access to another tenant.

## Done when

- Break-glass process documented
- Support access logged in `SUPPORT_ACCESS_LOG` with who, tenant, reason, timestamp
- Support query verified: returns all tenants via secure views
- Admin assumptions documented