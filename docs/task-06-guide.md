# CAP-30 — Task 6: Access tests

## Scope

Repeatable access tests for the isolation control from Task 4 and the support workflow from Task 5. Each test is run as the named role, with secondary roles off, so only that role's privileges apply.

Run one test block at a time from `sql-06-access-tests.sql`. Do not run the whole file at once: the denial tests fail by design, and a failure stops the rest of the file.

## Tests

| Test | Role | Check | Expected |
| --- | --- | --- | --- |
| T1 | TENANT_A_ANALYST | Counts in all views, V_KPIS | 1 tenant, 20 customers, 12 products, 200 orders, 411 order lines; V_KPIS STEAM only — 200 orders, 20 customers, 656,950.40 revenue, 3,284.75 average order value |
| T2 | TENANT_B_ANALYST | Counts in all views, V_KPIS | 1 tenant, 20 customers, 12 products, 200 orders, 426 order lines; V_KPIS EA only — 200 orders, 20 customers, 854,522.10 revenue, 4,272.61 average order value |
| T3 | TENANT_A_ANALYST | EA rows visible to A | 0 customers, 0 orders, 0 KPI rows |
| T4 | TENANT_B_ANALYST | STEAM rows visible to B | 0 customers, 0 orders, 0 KPI rows |
| T5 | TENANT_A_ANALYST | Base-table read | Fails — schema `TENANT_DATA` does not exist or not authorized |
| T6 | TENANT_B_ANALYST | Base-table read | Fails — schema `TENANT_DATA` does not exist or not authorized |
| T7 | CAPSTONE_SUPPORT, then ACCOUNTADMIN | Support sees both tenants, access logged | V_KPIS returns both rows (EA and STEAM); V_CUSTOMER count is 40; SUPPORT_ACCESS_LOG has 1 row |
| T8 | POWERBI_TENANT_A, POWERBI_TENANT_B | Power BI roles see only their tenant | A: V_KPIS STEAM only. B: V_KPIS EA only |
| T9 | ACCOUNTADMIN, then TENANT_B_ANALYST | Revoke and re-grant | After the revoke, B's V_CUSTOMER query fails. After the re-grant, it returns 20 again |

## Notes

- T3 and T4 were already run once during Task 4 (B sees 0 STEAM rows, 20 EA customers). They are repeated here so the full set can be re-run in one pass.
- T7 does not insert a new log row. It checks the 1 row logged in Task 5. A new support access needs a new log row first, as in Task 5.
- T9 must end with the re-grant. If the test stops after the revoke, `TENANT_B_ANALYST` is left without SELECT on `V_CUSTOMER`. The last block in the file restores it and confirms the count is 20 again.
- Every test block starts with `USE SECONDARY ROLES NONE`. Without it, ACCOUNTADMIN held by the test user leaks into the test and the denial tests pass incorrectly.

## Done when

- T1 and T2 return only the role's own tenant, with counts matching the source CSVs
- T3 and T4 return 0 for the other tenant
- T5 and T6 fail with the schema authorization error
- T7 returns both tenants for support, with 1 row in SUPPORT_ACCESS_LOG
- T8 returns only the matching tenant for each Power BI role
- T9 fails after the revoke and returns 20 after the re-grant
