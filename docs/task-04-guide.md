# CAP-30 — Task 4: Isolation control

## Scope

Enforce tenant isolation at the database layer with RBAC and secure views. Standard Edition has no row access policies, so the control is role-based secure views joined to an entitlement table. No analyst role has access to the base tables.

## Roles

| Role | Tenant |
| --- | --- |
| TENANT\_A\_ANALYST | STEAM |
| TENANT\_B\_ANALYST | EA |
| POWERBI\_TENANT\_A | STEAM |
| POWERBI\_TENANT\_B | EA |
| CAPSTONE\_SUPPORT | ALL |
| CAPSTONE\_ADMIN | ALL |

All six roles are granted to user `ARYAN05` for testing. In production each role would be granted to itsown user.

## Entitlement table

`TENANT_DATA.ROLE_TENANT_MAP` maps each role to its tenant. Support and admin map to `ALL`. A role with no row in this table sees nothing through the views.

## Secure views

Six secure views in `ANALYTICS`, one per base table plus a KPI view:

| View | Source |
| --- | --- |
| V\_TENANT | TENANT\_DATA.TENANT |
| V\_CUSTOMER | TENANT\_DATA.CUSTOMER |
| V\_PRODUCT | TENANT\_DATA.PRODUCT |
| V\_ORDERS | TENANT\_DATA.ORDERS |
| V\_ORDER\_LINE | TENANT\_DATA.ORDER\_LINE |
| V\_KPIS | ORDER\_LINE joined to ORDERS, aggregated per tenant |

Each view joins `ROLE_TENANT_MAP` on `CURRENT_ROLE()` and returns only rows where the mapped tenant matches the row's tenant, or where the mapped tenant is `ALL`.

## Grants

- USAGE on warehouse `CAPSTONE_WH`, database `CAPSTONE_DB`, and schema `ANALYTICS` to all six roles.
- SELECT on all views in `ANALYTICS` to all six roles.
- No USAGE on schema `TENANT_DATA` and no SELECT on any base table is granted to any analyst or Power BI role. Base-table access is denied at the schema level.

## Verification

Tested with secondary roles disabled (`USE SECONDARY ROLES NONE`), so only the tested role's privileges apply:

- As `TENANT_A_ANALYST`: `V_KPIS` returns only STEAM (revenue 656,950.40, 200 orders, 20 customers); `V_CUSTOMER` count is 20.
- As `TENANT_B_ANALYST`: `V_KPIS` returns only EA (revenue 854,522.10, 200 orders, 20 customers); `V_CUSTOMER` count is 20.
- As `TENANT_A_ANALYST`: `SELECT COUNT(*) FROM TENANT_DATA.CUSTOMER` fails — schema `TENANT_DATA` does not exist or not authorized.

Note: testing as user `ARYAN05` requires `USE SECONDARY ROLES NONE` after `USE ROLE`, because `ARYAN05` also holds ACCOUNTADMIN and it otherwise leaks into the test as a secondary role.

## Done when

- 6 roles created and granted to the test user
- `ROLE_TENANT_MAP` has 6 rows with the mappings above
- 6 secure views exist in `ANALYTICS`
- Analyst and Power BI roles have SELECT on the views only, no access to base tables
- Tenant A sees only STEAM, Tenant B sees only EA, base-table access denied