# quarterly

A locally-hosted web dashboard for running, saving, and comparing GraphQL queries against a [Ponder](https://ponder.sh/) blockchain indexing endpoint. Built for quarterly reporting workflows on Alchemix v3 on-chain data, but works with any Ponder-compatible GraphQL API.

---

## What it does

You paste a Ponder endpoint URL into the app, pick a date range, and run named queries. Results come back as paginated tables and charts. Every run is saved locally so you can compare Q1 vs Q2 numbers side by side, export CSVs, and bundle everything into a ZIP report.

**Key capabilities:**

- **Named query library** — define GraphQL queries with full metadata: pagination style, date format, field decimal scaling, chain filtering mode. Queries are saved to a local SQLite database and persist across sessions.
- **Auto-pagination** — offset-based and cursor-based pagination handled automatically. You configure `result_path`, `pagination_style`, and cursor paths; the engine fetches all pages and aggregates the rows.
- **Run history** — every successful query execution is stored with its parameters, row count, page count, and full result set. Load any past run without re-fetching.
- **Cross-quarter comparison** — pin two historical runs side by side. Delta columns show absolute change and percentage change per numeric field. Rows matched by a configurable key field.
- **Charts** — bar, line, and area charts via Recharts. Multi-chain series grouping. Export any chart as a PNG.
- **Reports** — group queries into named reports. Run all queries in a report with a shared date range in one click. Download a ZIP of all result CSVs.
- **Export** — download any run as JSON or CSV. CSV export applies decimal scaling from field metadata. ZIP export bundles an entire report run.
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
              ↓  GraphQL POST (proxied)
        Ponder endpoint  (user-configured)
```

The backend is a plain Express server that proxies GraphQL requests to whatever endpoint you configure. All state — query definitions, run history, settings — lives in a single SQLite file at `backend/data/quarterly.db`.

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
| `none` | Left for you to fill in the raw JSON editor |

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

## Reports

A **report** is a named group of queries. When you run a report:

1. Each query executes sequentially (in position order).
2. Failures are recorded but don't stop the remaining queries.
3. The result shows per-query status (ok / failed / cancelled).
4. Download a ZIP containing one CSV per successful query.

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
| `builtin_imported` | `0` | Set to `1` after built-in queries are imported |

---

## API reference

### Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | All settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/settings/ping` | Ping endpoint; returns `{ ok, latency_ms }` |

### Queries
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/queries` | List all queries |
| GET | `/api/queries/:id` | Single query |
| POST | `/api/queries` | Create query |
| PUT | `/api/queries/:id` | Update query |
| DELETE | `/api/queries/:id` | Delete query (cascades runs) |
| POST | `/api/queries/import` | Bulk import from JSON array |

### Runs
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/runs` | Execute query; auto-paginate; save result |
| GET | `/api/runs?query_id=N&limit=20&offset=0` | List runs for a query |
| GET | `/api/runs/:id` | Single run (includes rows) |
| DELETE | `/api/runs/:id` | Delete run |

### Reports
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports` | List reports |
| POST | `/api/reports` | Create report |
| GET | `/api/reports/:id` | Report with query list |
| PUT | `/api/reports/:id` | Update report |
| DELETE | `/api/reports/:id` | Delete report |
| POST | `/api/reports/:id/run` | Run all queries; returns report_run record |
| GET | `/api/reports/runs/:id` | Get past report run with per-query status |

### Export
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export/run/:id/json` | Download run as `.json` |
| GET | `/api/export/run/:id/csv` | Download run as `.csv` |
| GET | `/api/export/report-run/:id/zip` | Download report run as `.zip` of CSVs |

### Introspection
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/introspect` | Proxy schema introspection; return simplified type map |

---

## Running tests

```bash
npm test
```

Runs the Jest suite in `backend/tests/`. Tests cover:

- `validateEndpoint.test.js` — URL validation, private-IP rejection, DNS rebinding mock, dual-stack handling
- `ponder.test.js` — offset/cursor/none pagination, error cases, `graphql_partial` semantics, row-cap enforcement
- `export.test.js` — `scaledDecimal` BigInt precision, CSV flattening, formula injection, column ordering
- `queries.test.js`, `runs.test.js`, `settings.test.js` — route integration tests (require `better-sqlite3` native compilation)

---

## Project layout

```
quarterly/
├── backend/
│   ├── src/
│   │   ├── server.js          Express app (127.0.0.1:8790)
│   │   ├── db.js              SQLite init, WAL mode, migration runner
│   │   ├── ponder.js          GraphQL fetch + auto-pagination engine
│   │   ├── export.js          JSON / CSV / ZIP serialisation
│   │   ├── middleware/
│   │   │   └── validateEndpoint.js
│   │   ├── migrations/
│   │   │   └── 001_initial.js
│   │   └── routes/
│   │       ├── queries.js
│   │       ├── runs.js
│   │       ├── reports.js
│   │       ├── export.js
│   │       ├── introspect.js
│   │       └── settings.js
│   ├── data/
│   │   └── quarterly.db       SQLite database (gitignored)
│   └── tests/
│       ├── validateEndpoint.test.js
│       ├── ponder.test.js
│       ├── export.test.js
│       ├── queries.test.js
│       ├── runs.test.js
│       └── settings.test.js
├── frontend/
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── api/client.js
│       └── components/
│           ├── EndpointBar.jsx
│           ├── DateRangePicker.jsx
│           ├── QuerySidebar.jsx
│           ├── QueryEditor.jsx
│           ├── VariablePanel.jsx
│           ├── ResultsTable.jsx
│           ├── ResultsChart.jsx
│           ├── ExportButtons.jsx
│           ├── HistoryDrawer.jsx
│           ├── CompareView.jsx
│           ├── ReportBuilder.jsx
│           └── ChainFilter.jsx
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
| Charts | Recharts |
| Chart PNG export | html-to-image |
| GraphQL editor | @uiw/react-codemirror |
| Virtual scrolling | @tanstack/react-virtual |
| Backend | Node.js 20 + Express 4 |
| Database | SQLite via better-sqlite3 |
| IP range checking | ipaddr.js |
| CSV generation | csv-stringify |
| ZIP export | archiver |
| Testing | Jest + Supertest + nock |
