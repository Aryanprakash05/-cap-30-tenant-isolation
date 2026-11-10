# CAP-30 — Task 7: Usage monitoring

## Scope

Monitor the single warehouse `CAPSTONE_WH` (X-Small, single cluster, auto-suspend 60 seconds) and separate workloads by role and query tag. A resource monitor caps spend.

## Warehouse

`CAPSTONE_WH` was created in Task 3: X-Small, single cluster, auto-suspend 60 seconds, initially suspended. No second warehouse is used, so all tenant workloads share one warehouse and are separated by role and query tag instead.

## Resource monitor

`CAPSTONE_RM` caps the warehouse at 10 credits. It notifies at 80% of the quota and suspends the warehouse at 100%. The monitor is attached to `CAPSTONE_WH`.

## Query tags

Each session sets a query tag before running queries, so the history can be grouped by tenant and role:

```
ALTER SESSION SET QUERY_TAG = 'tenant=STEAM,role=TENANT_A_ANALYST';
```

```
ALTER SESSION SET QUERY_TAG = 'tenant=EA,role=TENANT_B_ANALYST';
```

The tag is a session setting. It must be set after switching role and before running the queries to tag.

## Monitoring queries

Run as ACCOUNTADMIN:

- Warehouse metering: credits used by `CAPSTONE_WH` per hour, from `SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY`.
- Queries by role and tag: count and total elapsed time grouped by `ROLE_NAME` and `QUERY_TAG`, from `SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY`, last 7 days.
- Queries by role: count grouped by `ROLE_NAME` only, last 7 days.

## Notes

- `ACCOUNT_USAGE` views lag behind real time, often by 45 minutes to 3 hours. A query run just now may not appear in the history immediately. Wait, then re-run the check.
- Query tags are session settings, not role settings. The tag stays set when the role is switched in the same session, so the history can show rows where the tag does not match the role (for example ACCOUNTADMIN running with the EA tag, or TENANT_B_ANALYST running with the STEAM tag). Set the tag fresh after each role switch for clean separation.
- `WAREHOUSE_METERING_HISTORY` shows credits per hour, not per query. Per-query cost is not directly available; role and tag grouping is the separation that matters for this task.
- The 10-credit quota is a cap for the project, not a forecast. The warehouse has been X-Small with auto-suspend 60 seconds throughout, so usage stays low.

## Done when

- Resource monitor `CAPSTONE_RM` exists and is attached to `CAPSTONE_WH`
- Query tags set for a tenant A and a tenant B session, with queries run under each tag
- Metering query returns `CAPSTONE_WH` rows
- Query history grouped by role and tag returns rows for both tenant roles