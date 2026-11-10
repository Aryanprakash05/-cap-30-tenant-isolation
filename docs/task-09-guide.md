# CAP-30 — Task 9: Repeatability

## Scope

One command re-runs every verification from Tasks 3 and 6, locally and in CI. The runner checks the ingestion state and the access tests, prints PASS/FAIL per check, and exits 0 only if all checks pass. GitHub Actions runs it on every push and pull request, and it can also be started by hand.

## Files

- `tests/run_access_tests.py` — the runner, T0 plus T1–T9
- `tests/requirements.txt` — `snowflake-connector-python`
- `.github/workflows/test.yml` — the CI workflow

## What the runner checks

T0 covers the ingestion state: the stage lists the 5 CSVs, CUSTOMER 40, ORDERS 400, ORDER_LINE 837, INGESTION_LOG 6 rows. T1–T9 mirror the Task 6 SQL tests: A sees only STEAM (20 customers, 12 products, 200 orders, 411 lines, KPIs 656950.40), B sees only EA (20, 12, 200, 426, 854522.10), cross-tenant counts 0, base-table reads denied, support sees both tenants with 1 log row, Power BI roles see only their tenant, revoke denies B and re-grant restores 20. T9 re-grants inside a finally, so a failed run never leaves the role broken.

## How it connects

Credentials come from environment variables: `SNOWFLAKE_ACCOUNT` (default `FQ39967`), `SNOWFLAKE_HOST`, `SNOWFLAKE_USER` (default `ARYAN05`), `SNOWFLAKE_PASSWORD` (required, no default). The password is never in the file. Each check switches role with `USE ROLE` plus `USE SECONDARY ROLES NONE`, the same as the SQL tests.

## Run locally

Install the connector, then run with the password in the environment:

```bash
pip3 install -r tests/requirements.txt
SNOWFLAKE_PASSWORD='<your Snowflake password>' python3 tests/run_access_tests.py
```

## CI

The workflow runs on push, pull request, and manual trigger (`workflow_dispatch`). It checks out the repo, sets up Python 3.11, installs the requirements, and runs the runner with three repository secrets: `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PASSWORD` (Settings → Secrets and variables → Actions). Results are on the Actions tab; a run can be re-run from the run page ("Re-run jobs") or started by hand ("Run workflow").

## Verify

- Local run: 28/28 checks passed.
- GitHub Actions run #1, triggered by the Task 9 push (commit `67af17f`): Success, 50s, 28/28 checks passed in the job log.

## Done when

- Runner passes locally with exit 0
- Workflow runs green on push
- Guide, AI log, and README updated and committed
