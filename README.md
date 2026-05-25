# quarterly

A locally-hosted web dashboard for running, saving, and comparing GraphQL queries against a [Ponder](https://ponder.sh/) blockchain indexing endpoint. Built for quarterly reporting workflows on Alchemix v3 on-chain data, but works with any Ponder-compatible GraphQL API.

---

## What it does

You paste a Ponder endpoint URL into the app, pick a date range, and run named queries. Results come back as paginated tables and charts. Every run is saved locally so you can compare Q1 vs Q2 numbers side by side, export CSVs, and bundle everything into a ZIP report.

**Key capabilities:**

- **Named query library** — define GraphQL queries with full metadata: pagination style, date format, field decimal scaling, chain filtering mode. Queries are saved to a local SQLite database and persist across sessions.
- **Computed columns** — define virtual columns in the Query Editor with a name, label, and arithmetic formula referencing other row fields. Computed columns appear in result tables and can be used as chart axes.
- **Timestamp extraction** — per-query configuration to parse a Unix timestamp out of an existing string field (specify source field, delimiter, position, and output field name). The extracted value behaves like a native datetime: raw/datetime toggle, chart X axis with Group By bucketing, and date range filtering.
- **Auto-pagination** — offset-based and cursor-based pagination handled automatically. Configure `result_path`, `pagination_style`, and cursor paths; the engine fetches all pages and aggregates the rows.
- **Run history** — every successful query execution is stored with its parameters, row count, page count, and full result set. Load any past run without re-fetching. Add notes to any run for future reference.
- **Cross-quarter comparison** — pin two historical runs side by side. Delta columns show absolute change and percentage change per numeric field. Rows matched by a configurable key field.
- **Charts** — bar, line, and area charts via ECharts. Dual Y-axis support, group-by time buckets (day/week/month), aggregation controls (sum, mean, median, min, max), X-axis sort order toggle, per-axis scale-to-range option, cumulative mode, per-field decimal divisors. Save named chart configurations (views) per query and restore them in one click. Export any chart as a PNG.
- **Full-text search & column controls** — filter displayed rows in real time with the search bar. Toggle column visibility with the ⚙ button. Copy the table as Markdown, HTML, or TSV.
- **Stats bar** — pick any numeric column and instantly see sum, average, min, and max. Divisors (÷1e6 / ÷1e18) applied to the table are also applied to the stats so the numbers always match.
- **Filter chips** — click any column value in the results to add it as a filter chip. Address columns resolve to human-readable labels from the Address Book.
- **Address Book** — label blockchain addresses with human-readable names, optionally scoped to a specific chain. Labels appear in result tables (click a labeled cell to copy the raw address) and in filter chips.
- **Reports** — group queries into named reports. Run all queries in a report with a shared date range in one click. Compare two report executions side by side. Download a ZIP of all result CSVs.
- **Endpoint profiles** — save multiple endpoint URLs (with optional custom headers) and switch between them in one click. Useful when working across staging and production environments or multiple chains.
- **Import / Export** — export any selection of queries, address book entries, and settings to a versioned JSON bundle. Import bundles on another instance with per-item conflict resolution (overwrite, create new, or skip) and field-level selection for query overwrites.
- **Export** — download any run as JSON or CSV. CSV export applies decimal scaling from field metadata. ZIP export bundles an entire report run.
- **Query preview** — inspect the exact GraphQL query and variables that were sent to the endpoint, useful for debugging or copying requests to external tools.
- **Schema explorer** — browse the live GraphQL schema and craft queries with embedded GraphiQL. Click **Use This Query** to populate the editor directly.
- **Built-in Alchemix queries** — three pre-built queries for MYT deposits, Alchemist deposits, and user counts ship with the app. Field metadata (18-decimal scaling for asset/share fields, timestamp formatting) is pre-configured.

---

## Architecture

```
Browser (React SPA)
  └── /api/*  HTTP
        ↓
Node.js / Express  (127.0.0.1:8790)
  ├── validateEndpoint middleware  — SSRF protection
  ├── ponder.js                   — GraphQL fetch + auto-pagination
  ├── db.js                       — SQLite (WAL mode) + migrations
  ├── export.js                   — JSON / CSV / ZIP serialisation
  └── routes/
        queries · runs · reports · export · introspect · settings
        address-labels · transfer · endpoints · proxy
              ↓  GraphQL POST (proxied, SSRF-validated)
        Ponder endpoint  (user-configured)
```

The backend is a plain Express server that proxies GraphQL requests to whatever endpoint you configure. All state — query definitions, run history, address labels, settings, endpoint profiles — lives in a single SQLite file at `backend/data/quarterly.db`.

The frontend is a Vite + React SPA. During development Vite proxies `/api` to the backend. In production you can serve the built frontend from the same Express process.

---

## Getting started

### Requirements

- Node.js 20+
- `gcc` / `make` / `python3` (for `better-sqlite3` native compilation — standard on most Linux systems; on macOS install Xcode Command Line Tools)

### Install

```bash
git clone git@github.com:imimim-username/quarterly.git
cd quarterly
npm install
```

### Run

```bash
npm run dev
```

This starts both servers concurrently:
- **Backend:** `http://127.0.0.1:8790`
- **Frontend:** `http://localhost:5173` (open this in your browser)

### First launch

1. Open `http://localhost:5173`.
2. Paste your Ponder GraphQL endpoint URL into the endpoint bar at the top. The connection dot turns green when the endpoint responds.
3. The three built-in Alchemix queries (MYT Deposits, Alchemist Deposits, User Counts) are imported automatically on first launch.
4. Select a query from the left sidebar, set a date range, and click **Run**.

---

## Walkthrough for new users

Here's a typical workflow from connecting an endpoint to a saved, charted query.

### 1. Add and verify your endpoint

Paste your Ponder GraphQL endpoint URL into the bar at the top of the page. The dot to the left of the bar shows connection status:

- **Grey** — not yet tested
- **Green** — endpoint responded successfully
- **Red** — endpoint is unreachable or returned an error

Click the **Ping** button (or press Enter in the endpoint bar) to test the connection. The latency in milliseconds is shown on success.

To save the current endpoint for later, click the **Profiles** button and choose **+ New Profile**. Give it a name and save it. You can then switch between saved profiles with a single click — useful when you work with multiple chains or environments.

### 2. Explore the schema

Once the endpoint is live, click **Introspect** (in the Query Editor toolbar) to fetch the GraphQL schema. This opens the **Schema Explorer**, which shows the live GraphQL schema via an embedded GraphiQL interface. Browse types and fields to understand what data is available, then click **Use This Query** to copy a query draft into the editor.

### 3. Create a query

Click the **+ New Query** button at the top of the left sidebar to open a blank query form. Fill in:

- **Name** — a short, descriptive name (shows in the sidebar)
- **Category** — optional grouping label (e.g. "Deposits", "General")
- **GraphQL** — paste or write your query in the editor. If you want date-range filtering, declare your date variables here (e.g. `$start: BigInt`, `$end: BigInt`).

#### Variable definitions

For each GraphQL variable your query uses, add a row in the **Variables** panel below the editor:

| Field | What to set |
|---|---|
| Name | Must match the `$variable` name in your GQL exactly |
| Source | `global_start` / `global_end` for date pickers; `user` for manual input; `none` for a fixed default |
| Default | Starting value (required for `user` and `none` sources) |

#### Execution settings

- **Result path** — dotted path from the response root to the array of rows (e.g. `data.deposits`)
- **Pagination** — choose `offset` (Ponder's `first`/`skip`) or `cursor` (Ponder's `first`/`after` + `hasNextPage`), or `none` for a single-page query
- **Date format** — `unix_seconds` for most Ponder timestamps; `unix_ms` or `iso8601` if your schema uses those
- **Chain mode** — `variable` to inject the selected chain as a GraphQL variable; `filter` to fetch all chains and filter client-side; `none` if your query isn't chain-specific

Click **Save** when done. The query appears in the sidebar immediately.

To duplicate an existing query, hover over it in the sidebar and click the **⧉** button that appears. The copy opens in the editor ready to rename and adjust.

#### Field metadata (optional but recommended)

After saving, open the **Field Meta** tab to configure per-column display:

- **Label** — human-readable column header shown in the table and chart
- **Decimals** — number of decimal places to scale by (e.g. `18` for ETH, `6` for USDC)
- **Type** — set to `unix_seconds` or `unix_ms` to have a column formatted as a date

### 4. Set the date range

The **Start** and **End** date pickers in the top bar control the time window passed to your queries. They apply globally — whichever query you run will use them.

- If a query has variables with source `global_start` or `global_end`, those variables are filled in automatically from the pickers when you click Run. The values are formatted according to the query's **Date format** setting before being sent to the GraphQL endpoint.
- If a query has no date variables, the pickers have no effect on what is fetched — but the **Results** tab will still use the date range to filter any `timestamp` column client-side, so you can narrow down a full dataset without re-running.
- Leaving a picker blank omits that bound: no start date means "from the beginning of the data"; no end date means "up to the latest".

### 5. Run a query

The left sidebar lists all saved queries grouped by category. Click any query to select it — its definition loads into the editor. Set a date range at the top if the query uses date variables, then click **Run**. Results appear in the **Results** tab as a table.

While a query is running you can click **Cancel** to abort it. A spinner and elapsed time counter show progress on long-running paginated queries.

### 6. Work with the results table

The **Results** tab shows a sortable, searchable table of all returned rows.

- **Sort** — click any column header to sort ascending; click again to sort descending.
- **Search** — type in the **Search rows…** bar to filter displayed rows by any cell value (full-text, case-insensitive). The match count updates in real time.
- **Column visibility** — click **⚙** to open the column panel. Uncheck columns you don't want to see.
- **Copy** — click **Copy ▾** to copy the visible table as Markdown, HTML, or TSV for pasting into other tools.
- **Decimal formats** — click the small `raw` / `÷1e6` / `÷1e18` badge on any integer column header to cycle the display divisor. The Stats bar (below) uses the same divisor.
- **Timestamps** — click the `raw` / `datetime` badge on a timestamp column to toggle between the raw integer and a formatted local date string.
- **Address labels** — address cells that match an Address Book entry show the label instead of the raw hex. Hover to see the raw address; click to copy it.

#### Stats bar

At the bottom of the table, the **Σ Stats** dropdown lets you pick any numeric column. Once selected, sum, average, min, and max are shown — all calculated using the same divisor applied to the column (so ÷1e18 columns show human-readable token amounts, not raw integers).

### 7. Filter the data

Above the table you'll see **filter chips** for each column that has repeated values. Click a chip value to activate it — results narrow to only rows matching that value. A common starting point is clicking a **chain** chip to focus on one chain.

Click additional chip values to add more filters. Click an active value again to remove it. Address columns in the filter chips resolve to Address Book labels when a single chain is selected.

### 8. View a chart

Click the **Chart** tab. If the query has a saved chart view, open the **Load view** dropdown and select it — the chart configures itself automatically.

To build a chart from scratch:

1. Pick an **X Field** (usually `timestamp` for time series, or a category field like `chain`).
2. Add columns to **Left Y axis** and/or **Right Y axis** from the dropdowns.
3. Choose the series type (bar, line, area) next to each axis label.
4. If X is a timestamp, use **Group By** to bucket rows by day, week, or month. The **Left agg.** and **Right agg.** dropdowns (sum, mean, median, min, max) control how values are aggregated per bucket; they are enabled whenever Group By is active.
5. Use the **X Order** button (↑ Asc / ↓ Desc) to set the sort direction of X axis values.
6. Enable **scale** on a Y axis selector to auto-fit the axis to the data range instead of starting at zero — useful when values cluster near the same number.
7. Toggle **cumulative** mode on a Y axis to show running totals instead of per-period values.
8. Click **Save view** to name and persist this configuration so you can reload it next time.

Use the ECharts toolbar (top-right of the chart) to zoom, reset, or download the chart as a PNG.

### 9. Compare two runs

Open the **History** drawer (top bar → **History**). Each row shows a past run with its date range, row count, duration, and any warnings. Click the **note** area on any run to add a free-text annotation — useful for recording what changed between quarters.

To compare two runs: click **Pin** on the first run, then **Compare** on the second. The **Compare** tab opens with a side-by-side table. Numeric columns get a delta column showing absolute and percentage change. Rows present in only one run are highlighted.

### 10. Preview a request

Click **Preview** in the Query Editor toolbar to inspect the exact GraphQL query string and variable values that will be sent to the endpoint. This is useful for debugging variable resolution or copying the request into curl / Postman / a client library.

The Preview modal also shows ready-to-run code snippets in Python, curl, TypeScript, and R.

### 11. Use reports

Click the **Reports** tab to group queries into a named report. Click **+ New Report**, add queries, then click **Run Report** to execute all of them with the current date range.

- Failures are recorded per query but don't stop the rest.
- Download a ZIP of all successful result CSVs.
- Click **Compare** on two past report runs to see a side-by-side comparison across all queries.

---

## Query definitions

Each query stores:

| Field | Description |
|---|---|
| `gql` | The GraphQL query string |
| `result_path` | Dotted path into the response to the result array (e.g. `data.deposits`) |
| `pagination_style` | `offset` · `cursor` · `none` |
| `cursor_path` | Path to the cursor string (cursor pagination only) |
| `has_next_path` | Path to the `hasNextPage` boolean (cursor pagination only) |
| `date_format` | How date variables are formatted: `unix_seconds` · `unix_ms` · `iso8601` |
| `chain_mode` | `variable` (inject chain as a GraphQL variable) · `filter` (filter client-side) · `none` |
| `chain_var_name` | GraphQL variable name for chain injection |
| `chain_field` | Result-row field used for client-side chain filtering (default: `chain`) |
| `key_field` | Row field used to match rows in CompareView (default: `id`) |
| `variable_defs` | JSON schema for all GraphQL variables (dates, pagination, user inputs) |
| `field_meta` | Per-field metadata: decimal scaling, labels, timestamp type |
| `chart_views` | Saved chart configurations (named snapshots of chart settings) |
| `computed_columns` | Virtual columns defined in the Query Editor: name, label, and arithmetic formula referencing row fields |
| `timestamp_extraction` | Per-query config to parse a Unix timestamp from a string field: source field, delimiter, position, output field name, and output label |

### Variable sources

Variables are filled from different sources at run time:

| `source` | What fills it |
|---|---|
| `global_start` | Start date from the date pickers |
| `global_end` | End date from the date pickers |
| `pagination_first` | Page size from settings |
| `pagination_skip` | Current page offset (offset pagination) |
| `pagination_after` | Current cursor (cursor pagination) |
| `user` | Manual input shown in the Variable Panel |
| `none` | Fixed value — use the `default` field |

### Field metadata

```json
{
  "assets": { "label": "Assets", "decimals": 18, "unit": "ETH" },
  "shares": { "label": "Shares", "decimals": 18, "unit": "mixWETH" },
  "timestamp": { "label": "Time", "type": "unix_seconds" }
}
```

Fields with `decimals` are displayed and exported as scaled decimal numbers (e.g. `1000000000000000000` → `1.0`). Fields with `type: "unix_seconds"` or `"unix_ms"` are formatted as local datetimes in the table.

---

## Pagination

The engine fetches all pages automatically and concatenates the rows.

**Offset-based:** injects `first` (page size) and `skip` (offset) variables. Stops when a page returns fewer rows than the page size.

**Cursor-based:** injects `first` and `after` (cursor) variables. Reads `hasNextPage` and `endCursor` from `has_next_path` / `cursor_path` in the response. Stops when `hasNextPage` is false.

**Limits (all configurable in Settings):**

| Limit | Default |
|---|---|
| Page size | 1,000 rows |
| Max pages | 50 |
| Max rows | 50,000 |
| Per-page timeout | 30 s |
| Warn at result size | 1 MB |
| Hard abort at result size | 10 MB |

---

## Address Book

The Address Book maps blockchain addresses to human-readable names. Each entry has:

- **address** — the 0x hex address
- **chain** — chain name (e.g. `arbitrumOne`, `mainnet`) or blank to match any chain
- **name** — the display label
- **notes** — optional free-text notes

Labels appear automatically in result tables wherever a cell value is a 40-character hex address. Hovering a labeled cell shows the raw address; clicking it copies the raw address to the clipboard. Filter chip labels are also resolved using the currently active chain filter as context.

---

## Charts

The chart view renders an ECharts dual-axis combo chart from query results. Controls:

- **X Field** — select any result column as the X axis
- **Left / Right Y axes** — add columns as series; choose bar, line, or area type; toggle cumulative mode; cycle decimal divisors (raw / ÷1e6 / ÷1e18); enable **scale** to auto-fit the axis to the data range
- **Group By** — when X is a timestamp field, bucket rows by day, week, or month
- **Left agg. / Right agg.** — aggregation function applied per Group By bucket: sum, mean, median, min, or max. Always visible when X is a timestamp/datetime field; greyed out when Group By is "none"
- **X Order** — toggle between ascending (↑) and descending (↓) sort of X axis values
- **Legend** — toggle the series legend

### Chart views

Save the current chart configuration under a name with **Save view**. The view captures X field, Y fields, chart types, group-by, aggregations (`leftAggregation`, `rightAggregation`), scale flags (`leftScaleY`, `rightScaleY`), X sort direction (`xSortDir`), Y modes, divisors, and legend state. Load any saved view from the dropdown to restore the configuration instantly. Views are stored per query.

---

## Reports

A **report** is a named group of queries. When you run a report:

1. Each query executes sequentially (in position order) with the current global date range.
2. Failures are recorded but don't stop the remaining queries.
3. The result shows per-query status (ok / failed).
4. Download a ZIP containing one CSV per successful query.

To compare two past report executions, click **Compare** next to any two runs in the report's history. A side-by-side view opens showing results from each query in both runs.

Reports are useful for quarterly snapshots: create a "Q2 2026" report, run it once, download the ZIP, and archive it. Next quarter you run the same report again and compare.

---

## CompareView

Select any two historical runs for the same query and click **Compare**:

- Rows are matched by `key_field` (e.g. `chain` or `id`).
- Numeric fields get a delta column showing absolute difference and percentage change.
- Rows present in one run but not the other are highlighted yellow.
- A chart overlay mode plots both runs as series on the same chart.

**Numeric field classification:** a field is treated as numeric for delta purposes if it has `decimals` set in `field_meta`, or if its value parses as a finite decimal number and is not typed as a timestamp or ID. Non-numeric fields show `—` in the delta column.

---

## Endpoint Profiles

Save frequently-used endpoints with the **Profiles** button in the top bar. Each profile stores:

- **Name** — display label
- **URL** — the GraphQL endpoint URL
- **Headers** — optional custom HTTP headers as a JSON object (e.g. `{ "Authorization": "Bearer …" }`)
- **Default flag** — one profile can be marked as default and loaded automatically on startup

Click **Use →** next to a saved profile to switch to it instantly. The endpoint bar updates and a new ping is performed.

---

## Import / Export

Use the **Import / Export** button in the top bar to move data between instances.

### Export

Choose what to include: individual queries (grouped by category, each individually checkable), the full Address Book, and/or Settings. Downloads a single versioned `.json` bundle file named `quarterly-export-YYYY-MM-DD.json`.

### Import

Drop or pick an export file. A preview step shows every item with a **New** or **Conflict** badge. For each item you can choose:

- **Overwrite** — replace the existing record. For queries, select which field groups to overwrite (GraphQL, Variables, Display, Info, Execution) independently. The **Display** group includes computed columns; the **Execution** group includes timestamp extraction.
- **Create new** — insert with an auto-suffixed name (`(imported)`, `(imported 2)`, …), preserving the existing record.
- **Skip** — leave the existing record untouched.

For address book entries, overwrite replaces the name (and notes) only — the address and chain are the unique key.

Settings show the incoming value alongside the current value so you can decide which keys to apply.

The import runs in a single database transaction — all decisions are applied atomically.

### Bundle format

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-05-20T12:00:00.000Z",
  "appVersion": "1.0.0",
  "queries": [ { "...all query fields..." } ],
  "addressLabels": [ { "address": "0x…", "chain": "mainnet", "name": "…", "notes": "…" } ],
  "settings": { "endpoint": "…", "warn_bytes": "…" }
}
```

---

## Security

The backend proxies arbitrary URLs, so several hardening measures are in place even for a localhost-only tool:

- **Binding:** Express binds to `127.0.0.1` only. Not accessible from other machines unless you explicitly pass `--host 0.0.0.0`.
- **SSRF protection:** before proxying any request, the endpoint URL is validated:
  - `http:` is only allowed to loopback addresses (`127.0.0.1`, `::1`, `localhost`).
  - `https:` rejects private IP ranges (`10.x`, `172.16.x`, `192.168.x`, link-local, IPv6 ULA).
  - DNS resolution is performed with `{ all: true }` — every A and AAAA record is checked.
  - Redirects are disabled on outbound fetches.
  - URLs with embedded credentials or blocked ports (22, 25, 465, 587) are rejected.
- **Result size limits:** results over 1 MB generate a warning; results over 10 MB abort the request.
- **Parameterised queries:** all SQLite operations use parameterised statements.
- **CSV formula injection:** cell values starting with `=`, `+`, `-`, or `@` are prefixed with `'` to prevent spreadsheet formula execution.

---

## Settings

Accessible via `GET/PUT /api/settings`. Stored in SQLite. Configurable keys:

| Key | Default | Description |
|---|---|---|
| `endpoint` | _(empty)_ | Ponder GraphQL endpoint URL |
| `page_size` | `1000` | Rows per page |
| `max_page_count` | `50` | Max pages per run |
| `max_row_count` | `50000` | Max rows per run |
| `timeout_per_page_ms` | `30000` | Per-page fetch timeout (ms) |
| `warn_bytes` | `1048576` | Result size warning threshold (1 MB) |
| `max_bytes` | `10485760` | Result size hard limit (10 MB) |
| `builtin_imported` | `0` | Set to `1` after built-in queries are imported on first launch |

---

## API reference

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | All settings as a key-value object |
| PUT | `/api/settings` | Update one or more settings keys |
| GET | `/api/settings/ping` | Ping configured endpoint; returns `{ ok, latency_ms }` |

### Queries

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/queries` | List all queries (JSON fields parsed) |
| GET | `/api/queries/:id` | Single query |
| POST | `/api/queries` | Create query |
| PUT | `/api/queries/:id` | Update query |
| DELETE | `/api/queries/:id` | Delete query (cascades runs) |
| POST | `/api/queries/import` | Bulk import from JSON array |

### Runs

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/runs` | Execute query; auto-paginate; save result |
| GET | `/api/runs?query_id=N&limit=20&offset=0` | List runs for a query (rows excluded) |
| GET | `/api/runs/:id` | Single run including full rows array |
| PATCH | `/api/runs/:id` | Update run notes (`{ notes: "..." \| null }`) |
| DELETE | `/api/runs/:id` | Delete run |

### Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports` | List reports |
| POST | `/api/reports` | Create report (`{ name, description }`) |
| GET | `/api/reports/:id` | Report with full query list |
| PUT | `/api/reports/:id` | Update report name, description, or query order |
| DELETE | `/api/reports/:id` | Delete report (cascades) |
| POST | `/api/reports/:id/run` | Execute all queries in report; returns report_run record |
| GET | `/api/reports/runs/:id` | Past report run with per-query status |

### Address Labels

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/address-labels` | List all address labels |
| GET | `/api/address-labels/:id` | Single label |
| POST | `/api/address-labels` | Create label (`{ address, name, chain?, notes? }`) |
| PUT | `/api/address-labels/:id` | Update label |
| DELETE | `/api/address-labels/:id` | Delete label |

### Endpoint Profiles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/endpoints` | List all saved profiles |
| GET | `/api/endpoints/:id` | Single profile |
| POST | `/api/endpoints` | Create profile (`{ name, url?, headers? }`) |
| PUT | `/api/endpoints/:id` | Update profile; pass `{ is_default: true }` to make it default (clears others) |
| DELETE | `/api/endpoints/:id` | Delete profile |

### Transfer (Import / Export)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/transfer/export` | Generate export bundle (`{ queryIds, includeAddressLabels, includeSettings }`) |
| POST | `/api/transfer/preview` | Dry-run analysis of a bundle; returns new/conflict status per item |
| POST | `/api/transfer/import` | Commit import with per-item conflict decisions |

### Export (run results)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export/run/:id/json` | Download run as `.json` |
| GET | `/api/export/run/:id/csv` | Download run as `.csv` (decimal scaling applied) |
| GET | `/api/export/report-run/:id/zip` | Download report run as `.zip` of CSVs |

### Introspection & proxy

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/introspect` | Proxy schema introspection; return simplified type map |
| POST | `/api/proxy` | Proxy arbitrary GraphQL POST through SSRF validation (used by Schema Explorer) |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Returns `{ ok: true }` |

---

## Running tests

### Backend (Jest)

```bash
npm test
# or
npm test --workspace=backend
```

Test files in `backend/tests/`:

| File | What it covers |
|---|---|
| `validateEndpoint.test.js` | URL validation, private-IP rejection, DNS rebinding mock, dual-stack handling |
| `ponder.test.js` | Offset/cursor/none pagination, error cases, `graphql_partial` semantics, row-cap enforcement |
| `export.test.js` | `scaledDecimal` BigInt precision, CSV flattening, formula injection, column ordering |
| `queries.test.js` | Query CRUD routes — create, list, update, delete, import |
| `runs.test.js` | Run execution, error cases, PATCH notes, GET/DELETE |
| `settings.test.js` | Settings GET/PUT/ping |
| `endpoints.test.js` | Endpoint profile CRUD, `is_default` exclusivity |

Tests that require `better-sqlite3` native compilation auto-skip if the native module is unavailable (e.g. CI without build tools).

### Frontend (Vitest)

```bash
npm test --workspace=frontend
# or from the frontend directory:
cd frontend && npx vitest run
```

Test files in `frontend/src/components/__tests__/`:

| File | What it covers |
|---|---|
| `QuerySidebar.test.jsx` | Query list rendering, search filter, selection, clone button hover/click |
| `ResultsTable.test.jsx` | Column rendering, full-text search, column visibility, stats bar picker, copy menu |
| `HistoryDrawer.test.jsx` | Run list rendering, note editing, save/cancel flow |
| `EndpointProfilesModal.test.jsx` | Profile list, create form, use/delete actions |
| `QueryPreviewModal.test.jsx` | Endpoint/GQL/variable display, tab switching, copy button |
| `EndpointBar.test.jsx` | Ping flow, schema explorer button visibility, URL validation |
| `SchemaExplorer.test.jsx` | Render, use-query button state, onClose |

Test files in `frontend/src/utils/__tests__/`:

| File | What it covers |
|---|---|
| `computedColumns.test.js` | Formula parsing, field reference resolution, arithmetic operators, safe evaluation (no eval) |
| `timestampExtraction.test.js` | Delimiter splitting, position selection, Unix timestamp parsing, output field construction |

---

## Project layout

```
quarterly/
├── package.json               Root workspace (dev + test scripts)
├── README.md
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── server.js          Express app (127.0.0.1:8790)
│   │   ├── db.js              SQLite init, WAL mode, migration runner
│   │   ├── ponder.js          GraphQL fetch + auto-pagination engine
│   │   ├── export.js          JSON / CSV / ZIP serialisation
│   │   ├── middleware/
│   │   │   └── validateEndpoint.js   SSRF protection
│   │   ├── migrations/
│   │   │   ├── 001_initial.js
│   │   │   ├── 002_address_labels.js
│   │   │   ├── 003_chart_views.js
│   │   │   ├── 004_endpoints_and_run_notes.js
│   │   │   ├── 005_computed_columns.js
│   │   │   └── 006_timestamp_extraction.js
│   │   └── routes/
│   │       ├── queries.js
│   │       ├── runs.js
│   │       ├── reports.js
│   │       ├── export.js
│   │       ├── introspect.js
│   │       ├── settings.js
│   │       ├── addressLabels.js
│   │       ├── transfer.js
│   │       ├── endpoints.js
│   │       └── proxy.js
│   ├── data/
│   │   └── quarterly.db       SQLite database (gitignored)
│   └── tests/
│       ├── validateEndpoint.test.js
│       ├── ponder.test.js
│       ├── export.test.js
│       ├── queries.test.js
│       ├── runs.test.js
│       ├── settings.test.js
│       └── endpoints.test.js
├── frontend/
│   ├── vite.config.js
│   ├── vitest.config.js
│   └── src/
│       ├── App.jsx
│       ├── api/
│       │   └── client.js
│       ├── utils/
│       │   ├── addressLabels.js
│       │   ├── computedColumns.js
│       │   ├── timestampExtraction.js
│       │   └── __tests__/
│       │       ├── computedColumns.test.js
│       │       └── timestampExtraction.test.js
│       └── components/
│           ├── EndpointBar.jsx
│           ├── DateRangePicker.jsx
│           ├── QuerySidebar.jsx
│           ├── QueryEditor.jsx
│           ├── VariablePanel.jsx
│           ├── ResultsTable.jsx
│           ├── ResultsChart.jsx
│           ├── ResultFilters.jsx
│           ├── ExportButtons.jsx
│           ├── HistoryDrawer.jsx
│           ├── CompareView.jsx
│           ├── ReportBuilder.jsx
│           ├── ReportCompareView.jsx
│           ├── ReportsPanel.jsx
│           ├── ChainFilter.jsx
│           ├── SchemaExplorer.jsx
│           ├── AddressBook.jsx
│           ├── ImportExportModal.jsx
│           ├── QueryPreviewModal.jsx
│           ├── EndpointProfilesModal.jsx
│           └── __tests__/
│               ├── QuerySidebar.test.jsx
│               ├── ResultsTable.test.jsx
│               ├── HistoryDrawer.test.jsx
│               ├── EndpointProfilesModal.test.jsx
│               ├── QueryPreviewModal.test.jsx
│               ├── EndpointBar.test.jsx
│               └── SchemaExplorer.test.jsx
├── queries/
│   └── builtin/
│       ├── myt_deposits.json
│       ├── alchemist_deposits.json
│       └── user_counts.json
└── PLAN.md                    Detailed implementation specification
```

---

## Built-in queries

Three queries ship with the app in `queries/builtin/`. They are imported into the database on first launch and are never overwritten by subsequent launches (so your edits are preserved).

| Query | Category | Description |
|---|---|---|
| MYT Deposits | MYT | All deposits into MYT wrapper contracts |
| Alchemist Deposits | Alchemist | Deposits into Alchemist vaults |
| User Counts | General | Active user counts per chain |

> **Note:** Field names in the built-in queries are based on Ponder schema conventions and must be verified against your live endpoint using the **Introspect** button in the Query Editor before they will return data.

---

## Tech stack

| Concern | Library |
|---|---|
| Frontend framework | React 18 + Vite |
| Charts | ECharts 5 |
| GraphQL editor | @uiw/react-codemirror |
| Schema explorer | GraphiQL + @graphiql/plugin-explorer |
| Virtual scrolling | @tanstack/react-virtual |
| Backend | Node.js 20 + Express 4 |
| Database | SQLite via better-sqlite3 |
| IP range checking | ipaddr.js |
| CSV generation | csv-stringify |
| ZIP export | archiver |
| Backend testing | Jest + Supertest + nock |
| Frontend testing | Vitest + React Testing Library |
