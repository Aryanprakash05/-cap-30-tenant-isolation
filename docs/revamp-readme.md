# CAP-30 — DataVault UI revamp: what changed and why

This is the design record for the Task 8 frontend revamp (11 Nov 2026). It is written for the viva: each decision states what was done, why, and where the proof lives. Nothing here claims security the backend does not enforce.

## The problem the UI has to show

A SaaS analytics provider serves several customer companies from one shared Snowflake warehouse. Three things must be true at once: each customer sees only its own sales data; support can help a customer without standing access to their data; and the provider must prove isolation, not promise it. The evaluator checks this with direct SQL that bypasses the UI, so the UI's job is to make the same evidence visible — not to be the enforcement.

## What the old UI did wrong

The previous frontend was a working technical demo, not a product. A decorative WebGL orb filled the sign-in hero and said nothing about the product. Internal jargon (role names, `ROLE_TENANT_MAP`, `CURRENT_ROLE()`) appeared on customer screens. The request runner announced "Expected Result: 403" before the call ran, so a PASS was decided before any evidence existed. The support workflow, the isolation evidence, and the cost view were missing or partial: usage showed query counts and seconds but never credits or cost per tenant. Demo credentials sat in a static box with passwords visible.

## What changed

### Sign-in

The orb is gone. The hero now shows a tenant-boundary diagram: two vaults (Steam, EA) separated by a wall, sitting on one shared warehouse, with three plain-language value points — "Your data stays yours", "Every access is logged", "Verified by direct database tests". Customer tiles are separate from the staff card: support sign-in is visually distinct (purple, labelled "Staff sign-in — Staff access is time-limited and audited"), because support is not a customer. Demo accounts live behind a collapsible panel; passwords are filled by an Autofill button and never displayed. Login calls `POST /api/auth/login`; the token lives in memory only, never in localStorage, and every request sends it as `Authorization: Bearer`. The `X-Role` header is gone from the frontend entirely.

### Dashboard

KPI cards carry plain-language definitions on hover. Charts come from a new endpoint, `GET /api/analytics/summary` — revenue by month, by channel, by category, top 10 customers and products — because the old endpoints return order headers only, and revenue/category charts cannot be derived from them. An isolation chip ("Data isolation: verified") opens a drawer with the last Evidence run; it says "Evidence not run yet" until a run passes, so the claim is never hardcoded.

### Security & Evidence

This is where the internal detail lives — the only screen that names roles and enforcement. It has four parts:

1. **Who am I to the database** — username, Snowflake role, data scope, and where enforcement lives (secure views + role map inside Snowflake).
2. **Run isolation tests** — a server-side suite of 10 checks (`POST /api/evidence/run`): each tenant reads its own KPIs, each tenant reads the other's customers (0 rows), each tenant reads the base table (denied, SQLState 42501), a secondary-role bypass attempt (still 0 rows), and support without a grant (0 rows), with a grant (20 rows, logged, then revoked by the test), and after the revoke (0 rows again). Every check returns its Snowflake query ID, so any result can be looked up in `QUERY_HISTORY`. The suite never revokes a grant it did not create: if a real grant is already open, the support checks skip with a reason instead of ending someone's access.
3. **Try to break it** — the reviewer clicks "Read EA KPIs" as Steam and sees the 403 after the call, with Expected vs Actual shown only after the result. A 403 alone is not presented as proof; the proof is the test suite and the query IDs.
4. **Request runner** — kept here, with Response / cURL / SQL tabs and a request log carrying query IDs, plus a recorded Direct-SQL proof section (base-table denial, cross-tenant zero) from `sql/04_isolation_proof.sql`, labelled as recorded evidence, not a live call.

### Support Console

Three steps, in order: request access (tenant, reason of at least 10 characters, duration 15–480 minutes), the data view, and the access history. Before any grant the screen says "No active grant — data locked" and offers a "Prove the lock" button that calls the masked-customers endpoint and shows it returned 0 rows. With a grant, masked customers and the granted tenant's orders appear, and a banner shows a live countdown with "End access now" — which calls the new `POST /api/support/revoke` and ends the grant in Snowflake (`SP_SUPPORT_REVOKE`, `sql/06_support_revoke.sql`). The history table shows who, tenant, reason, time, and status (active / expired / revoked), with revoked distinguished from expired by the new `revoked_at` column on `SUPPORT_ACCESS_LOG`.

### Usage & Cost

`GET /api/usage` now returns cost attribution: metered credits from `WAREHOUSE_METERING_HISTORY` (last 7 days) split per tenant by each tenant's share of tagged query time, with an estimated cost. The credit price is configurable (`SNOWFLAKE_CREDIT_PRICE_USD`, default $2.40) — $2.40 is the Standard on-demand list price for AWS Asia Pacific (Thailand), verified from Snowflake's Service Consumption Table effective 9 Nov 2026; the account lives in that region, so the old $2.00 US default understated cost by 20%. The page also shows daily credits, the resource monitor meter (CAPSTONE_RM, 10-credit cap), and usage by role and query tag. Staff also see ingestion health and system health; analysts see only their own tenant's cost bucket.

## New backend pieces (approved in the design brief)

| Change | Why |
|---|---|
| `GET /api/analytics/summary` | Dashboard charts need revenue by month/channel/category and top customers/products; no existing endpoint returns them. |
| `POST /api/support/revoke` + `SP_SUPPORT_REVOKE` + `revoked_at` column (`sql/06_support_revoke.sql`) | "End access now" must end the grant in Snowflake, and history must distinguish revoked from expired. Run 06 in Snowsight before restarting the backend. |
| `GET /api/support/history` | Access history with statuses; the old status endpoint only returned the last 5 entries. |
| `POST /api/evidence/run` | The 10-check suite must run server-side, against the live database, with real query IDs. A frontend-only check would prove nothing. |
| `GET /api/ingestion` | Staff-only ingestion health (files loaded, rows loaded vs rejected, with reasons). |
| `?tenant` optional on `/api/kpis`, `/api/orders`, `/api/orders/{id}` | Analysts should not have to name their own tenant on every call; the service derives it from the session role and still returns 403 on a mismatch. Existing calls with `?tenant` keep working. |
| Credit price default $2.00 → $2.40 | The account is in ap-southeast-7 (Thailand); $2.40 is the verified Standard list price there. |

## What was deliberately not done

- No new dependencies. Charts are hand-rolled SVG; the CI frontend build is already fragile (see the package-lock history), and a chart library was not worth the risk.
- No admin login. AuthService has no admin user, so staff-only endpoints (`/api/ingestion`, the staff Usage sections) are gated to `CAPSTONE_SUPPORT`. The admin role exists in Snowflake for setup only.
- No Power BI RLS. Power BI reads the secure views directly (Part A), so a view failure is visible instead of hidden behind a second filter.
- No row access policies, masking policies, or multi-cluster warehouse. Snowflake Standard Edition does not have them; isolation stays RBAC + secure views + the role-to-tenant map, which is the brief's equivalent control.
- The resource-monitor cap (10 credits) is a constant from the Task 7 design, not parsed from `SHOW RESOURCE MONITORS` — the parse was judged too fragile to trust in the UI.

## Honest limits

- The demo login passwords are hardcoded in `AuthService.java` and in the frontend's autofill constants. This is a demo identity provider, not real authentication; production would use an external IdP. The passwords are never rendered as text in the UI.
- The evidence suite's support checks skip when a real grant is already open. That keeps the suite side-effect-free, but it means the full 10/10 only shows when no grant is active.
- Usage figures come from `ACCOUNT_USAGE`, which lags 45 minutes to 3 hours, so fresh credits appear late. The credit split is by share of tagged query time — a proxy for billed time, not the meter itself. The page says so.
- The support gate covers the data views. It does not cover warehouse-level actions.
- The S3 stage still uses an IAM-user access key, because the org RCP/SCP blocks the Snowflake storage integration AssumeRole path. See `docs/05_runbook.md`.

## Polish pass — 11 Nov 2026

After the first revamp I said the login was fine but the rest looked AI-generated, and sent screenshots of the Dashboard, Security & Evidence, and Usage & Cost. The screenshots showed two real problems, not just taste:

- The line charts were broken: the highest point was clipped at the top of the chart and the axis labels overlapped. Cause: the y-axis top tick could sit below the largest value. Fixed by making the top tick always cover the max, and by switching monthly revenue and daily credits from line charts to bar charts.
- The copy read like documentation pasted into the UI: a subtitle under every heading, a paragraph banner explaining the numbers. Cut to one line where it adds anything; the Usage method note is now a single footnote.

Visual system, changed with it: four KPI cards became one stats strip with hairline dividers; card shadows removed (hairline borders only); base type 13px; tables denser with hairline row dividers; the pager hides when there is one page. The login screen, top bar and sidebar are unchanged.

## Second polish pass — 11 Nov 2026

I said the UI still looked unprofessional and extremely AI-generated, and to leave the login page alone. The first polish had only changed the paint and kept the same template — card grid, four KPI boxes, two-column chart grid — which is the AI dashboard template itself.

This pass rebuilt the structure: the card grid is gone. Every inner screen is now flat report sections separated by hairlines. Numbers sit in a plain row with no box around them. The Dashboard has a full-width revenue chart, channel/category stacked beside a wide top-customers table, and full-width product and order tables. Evidence puts the test-results table full-width on its own section, and the Try-to-break-it result is a plain verdict line instead of a tinted box. Support shows the grant as a single status line with a dot instead of a banner. Login, top bar and sidebar are unchanged.

## Recolour — 11 Nov 2026

Palette sampled from the Order Validation Pipeline screenshot: deep green `#19422c` (header, numbers, primary text), mid green `#276a3f` (accents, Steam charts), pale page `#f5f9f6`, hairlines `#d5e0d8`, muted text `#606d65`. The tokens are redefined inside `.app-shell` only, so the login page — which lives outside the shell — keeps its ink/teal look untouched. EA keeps its amber so the two tenants stay distinguishable. No layout or copy changed in this pass; colours only.

## Figma revamp — 11 Nov 2026

Rebuilt the inner screens on the Tesla Reports dashboard from the Figma community file: white cards with soft shadows and 14px radius on a pale page, a white sidebar with a pale-pill active nav item, page title with an action on the right and a divider below, KPI cards (small grey label, large bold number, sparklines on revenue and orders), a tall bar chart rising from pale tracks, ranked progress-bar lists for channel/category/products, and a leaderboard list for top customers. The Figma blue (#4679F9) is replaced by the forest green from the Order Validation Pipeline screenshot (#276a3f, pale green #e7f0e8). No top bar: brand, nav, data scope and sign-out live in the sidebar. The flat report style from the earlier polish pass was removed. The login page is untouched. No backend or API contract change; no fake filter pills and no rank-movement triangles, because the data does not support them.

## Sidebar fix — 11 Nov 2026

The sidebar was a flex column stretched to the full height of the page, so its bottom group (data scope, user, sign-out) only appeared after scrolling to the very bottom. It is now sticky (`position: sticky; top: 0; height: 100vh`), so it stays pinned to the viewport while the main content scrolls. Also fixed: the Online channel pill was blue because `.chip-info` hardcoded `#0369a1`; it now uses the `--info` token, so it is deep green like the rest of the scheme.

## Sign-in form recolour — 11 Nov 2026

The form side of the sign-in page was still in the old palette (grey-blue page, teal tile, purple staff card, ink button, blue focus ring). The green tokens are now scoped to `.login-form-wrap`, so the dark hero on the left keeps its ink/teal look: pale green page, deep green button, mid-green selected Steam tile, green focus rings. The staff card is stone, not purple — the same treatment as the staff chips inside the app. The "I AM SIGNING IN AS" label is sentence case now. EA keeps its amber.

## Sign-in form rebuild — 11 Nov 2026

Recolouring the form was not enough: the pick-a-card structure was the template. The two tenant tiles and the staff card are gone. The company is now a segmented control (Steam / EA, selected pill deep green) with the tenant's blurb as one small line underneath; choosing a company fills both fields, password masked and never shown. Staff is a quiet link under the form that opens a stone staff notice with a way back — never a peer tile. The demo-accounts panel is gone, replaced by one quiet footer line naming the three demo usernames. The dark hero is untouched.

## Apple pass (2026-11-11, after the sign-in rebuild)

Aryan asked for the whole app to feel Apple-like, fonts included, and pointed at the emilkowalski apple-design skill (`npx skills add https://github.com/emilkowalski/skills --skill apple-design`). The skill was installed and read first; the pass follows its typography (§15), materials (§12), response (§1) and reduced-motion (§14) sections. CSS only, in `src/index.css` and one line in `src/main.jsx`; no layout, colour, copy or backend change.

- **Fonts:** the system font stack is now first — `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui` — so the app renders in SF Pro on the Mac and falls back to the system font elsewhere. The Inter import is removed from `main.jsx`, so the bundled Inter woff2 files drop out of the build. The `@fontsource-variable/inter` dependency stays in `package.json` so the lockfile is untouched. Tracking was already size-specific (page titles and KPI values −0.02em, the 34px hero headline −0.03em, body near 0) and was kept; body leading is 1.55.
- **Materials:** the sidebar and the Evidence drawer are translucent (`backdrop-filter: blur(20px) saturate(180%)` on the sidebar, 24px on the drawer, with a dimmed, slightly blurred backdrop behind the drawer). The green palette, the dark sign-in hero and the segmented sign-in control are unchanged.
- **Response:** buttons, nav items, pills and the segmented control scale to 0.97–0.98 on pointer-down (100ms ease-out), so feedback lands on press, not on release.
- **Radii:** cards 14px → 16px, buttons 7px → 10px, inputs and search box 6px → 9px.
- **Reduced motion / transparency:** press feedback, shimmer and the meter transition are disabled under `prefers-reduced-motion`; translucent surfaces go solid under `prefers-reduced-transparency`.
- **Not done:** no spring library (Motion/Framer Motion) was added — the same no-new-dependencies rule as the charts, and the CI frontend build is already fragile. The press scale and 100ms transitions are the CSS approximation of the skill's critically damped default; no gesture-driven drag or sheet exists in the app to need real springs.

Verified on the VM: `npm run build` passes (2,102 modules, 2.54s — one fewer than before, the Inter import), the built CSS contains the SF Pro stack, `backdrop-filter`, the scale feedback and both media queries, and no Inter font files remain in `dist/assets`. Synced to the Mac 2026-11-11 18:19 IST (`src/index.css` 35,853 B, `src/main.jsx` 443 B); the dev server hot-reloads, no rebuild needed.
