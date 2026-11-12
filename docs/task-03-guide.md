# CAP-30 — Task 3: Environment, synthetic data, ingestion

## Scope

Generate synthetic data, load it into Snowflake, verify counts and revenue match. Isolation is Task 4; Task 3 covers data generation and ingestion only.

## Part 1 — Generate the CSVs

Run from the repo root:

```
python3 python/generate_data.py
```

Output: `data/` with 10 files, one folder per tenant. Seed 30, so counts are repeatable. Each file holds only one tenant's rows — no file mixes the two companies.

| File | Rows |
| --- | --- |
| tenants.csv | 2 |
| STEAM/customers.csv | 20 |
| EA/customers.csv | 20 |
| STEAM/products.csv | 12 |
| EA/products.csv | 12 |
| STEAM/orders.csv | 200 |
| EA/orders.csv | 200 |
| STEAM/order\_lines.csv | 411 |
| EA/order\_lines.csv | 426 |
| edge\_cases.csv | 3 bad rows, kept separate |

Expected revenue:

| Tenant | Revenue |
| --- | --- |
| STEAM | 656,950.40 |
| EA | 854,522.10 |
| Total | 1,511,472.50 |

All names, game titles, customers and orders are synthetic. No real Steam or EA titles, no real people.

`edge_cases.csv` contains 3 bad rows by design: missing tenant\_id, unknown tenant with invalid date, duplicate order\_line\_id with non-numeric quantity. Rejected and logged, not loaded.

If counts differ from the table above, stop and investigate before loading.

## Part 2 — S3 and IAM

1. Create a private bucket, `cap-30-tenant-data-aryan` (append a suffix if taken, use that name consistently). Block all public access.
2. Upload the 10 files to `cap30/`, keeping the folder layout: `STEAM/` and `EA/` under `cap30/`, with `tenants.csv` and `edge_cases.csv` at the top level.
3. Create IAM role `capstone-snowflake-role` with policy `capstone-snowflake-s3-read` (`s3:ListBucket` and `s3:GetObject` on this bucket only).

Note: org RCP/SCP policies in the accounts used for this project block cross-account `sts:AssumeRole` from Snowflake. The storage integration was therefore replaced with an IAM user (`capstone-snowflake-user`) whose access keys are supplied in the stage via `CREDENTIALS`. This is a workaround, not the preferred method; the integration design is retained in the repo and in the Task 10 limitations.

## Part 3 — Snowflake setup and load

Run as ACCOUNTADMIN in a Snowflake worksheet.

`sql/03-setup.sql` creates warehouse `CAPSTONE_WH` (X-Small, auto-suspend 60s, auto-resume), database `CAPSTONE_DB`, schemas `TENANT_DATA` and `ANALYTICS`, all 9 tables, and file format `CAPSTONE_CSV_FORMAT`.

`sql/03-load.sql` creates the stage, lists it, empties the tables with `TRUNCATE` so the script is re-runnable, loads each per-tenant CSV with `COPY INTO` (one COPY per tenant per table, 9 COPYs total, `ON_ERROR = 'ABORT_STATEMENT'`), then runs count checks, revenue check, orphan checks, and ingestion log inserts. If the TENANT copy ever loads 0 rows, re-run that one COPY on its own.

Verification criteria:

- Counts: 2 / 40 / 24 / 400 / 837
- Revenue: STEAM 656,950.40, EA 854,522.10
- Orphan checks: 0, 0, 0
- `INGESTION_LOG`: 10 rows (9 LOADED, 1 REJECTED)
- `INGESTION_ERRORS`: 3 rows

## Done when

- 10 files in S3: 8 per-tenant files under `cap30/STEAM/` and `cap30/EA/`, plus `tenants.csv` and `edge_cases.csv` under `cap30/`
- Table counts match: 2, 40, 24, 400, 837
- Revenue matches per tenant
- Orphan checks all 0
- `INGESTION_LOG` has one row per file; 3 edge-case rows logged as rejected