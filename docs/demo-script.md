# CAP-30 — 5-minute demo script: DataVault

Run the backend and the frontend first (see `docs/task-08-guide.md`). Keep Snowsight open in a second window for the direct-SQL moment in minute 4. The script is six beats; each one shows a different part of the isolation story. Timings are approximate — the Evidence run takes about 30 seconds because the support checks open and close a real grant.

## 0:00 — The problem, on the sign-in screen (30 seconds)

Point at the sign-in screen. "DataVault is a SaaS analytics product. Several customer companies share one Snowflake warehouse. Each customer must see only its own sales data. Support must be able to help a customer without standing access to their data. And the provider must prove isolation, not promise it."

Point at the diagram: two vaults, one warehouse, a wall between them. "Your data stays yours. Every access is logged. Verified by direct database tests." No login yet — the point is the problem, not the form.

## 0:30 — Tenant A: Steam Valve Corporation (1 minute)

Sign in as Steam (demo accounts panel → Autofill → Sign in). Land on the Dashboard.

"Steam sees its own numbers: revenue 656,950.40, 200 orders, 20 customers. These come from the secure view for the Steam role — the page never filters anything." Hover a KPI to show the definition. Point at the charts: revenue by month, by channel, by category, top customers. "All of this is Steam's data. Nothing here is EA's."

Open an order row to show the line items. Then click the "Data isolation: verified" chip — but say: "This chip only claims verified after a test run. It says 'not run yet' until we run it. We will run it in minute 3."

## 1:30 — Try to break it (1 minute)

Go to Security & Evidence. "Now the part that matters. I am logged in as Steam. Watch what happens when I ask for the other tenant's data."

Click "Read EA KPIs". The panel shows the result after the call: 403, "Role TENANT_A_ANALYST is not allowed to access tenant EA", no Snowflake query was issued. "The API refused before Snowflake was even asked. And that is the first layer only — the secure view would return zero rows even if the API check were bypassed."

Do the same for EA orders. Then open the request runner, pick `/api/orders` with tenant EA, run it, and show the SQL tab: the exact query a reviewer can paste into a worksheet. "A 403 alone is not proof. The proof is the next step."

## 2:30 — Run the isolation tests (1 minute)

Click "Run isolation tests". Ten checks run against the live database:

1. Steam reads its own KPIs — 1 row, revenue matches 656,950.40.
2. Steam reads EA customers through the view — 0 rows.
3. EA reads its own KPIs — 1 row, 854,522.10.
4. EA reads Steam customers — 0 rows.
5. Steam reads the base table directly — denied (SQLState 42501).
6. EA reads the base table directly — denied.
7. Secondary-role bypass: Steam turns on all secondary roles, EA still returns 0.
8. Support without a grant — 0 rows.
9. Support with a 1-minute grant — 20 Steam customers, logged, then the grant is revoked by the test itself.
10. Support after the revoke — 0 rows again.

"Every check shows its Snowflake query ID. Copy one, paste it into QUERY_HISTORY in Snowsight, and you see the exact query, the role that ran it, and the query tag. That is the query-level evidence."

Scroll to the recorded Direct-SQL proof section: the base-table denial and the cross-tenant zero, run in Snowsight on 11 Nov 2026. "That is the same proof, done by hand, outside the UI."

## 3:30 — Tenant B, then support (1 minute)

Sign out, sign in as EA. "Same product, different tenant. EA sees 854,522.10, 200 orders, 20 customers. The Evidence suite passes the same way."

Sign out, sign in as Platform Support. The Support Console shows "No active grant — data locked". Click "Prove the lock": the masked-customers call returns 0 rows. "Support has no standing access. Nothing to see."

Request a grant: tenant STEAM, reason "Investigating order discrepancy ticket #INC-8921 for STEAM tenant", 30 minutes. The banner appears with a live countdown. Masked customers now list Steam's 20 customers — names masked to one letter. "Support can help, with a reason, a time limit, and a log entry. The names are masked because support does not need them."

Click "End access now". The data view locks again. The history table shows the grant as revoked, with who, when, why, and how long it lasted.

## 4:30 — Usage & Cost (30 seconds)

Go to Usage & Cost. "Isolation is one half of the problem. The other half is knowing what the shared warehouse costs, per tenant."

Show the cost summary: metered credits for the last 7 days, split into STEAM, EA, SHARED platform work, and UNTAGGED work, with the estimated cost at $2.40 per credit (the Standard list price for AWS Asia Pacific (Thailand), where this account lives). Point at the resource monitor meter: CAPSTONE_RM, 10-credit cap. "If one tenant's workload spikes, we see whose it was, from the query tags."

## Close (one sentence)

"One warehouse, two tenants, zero cross-tenant reads — and every claim on this screen links to a test you can re-run or a query you can look up."
