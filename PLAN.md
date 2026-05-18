# quarterly — Development Plan

## Overview

`quarterly` is a locally-hosted web dashboard for running and saving GraphQL queries
against a [Ponder](https://ponder.sh/) indexing endpoint, designed specifically to
support quarterly reporting workflows.

Users paste a Ponder GraphQL endpoint URL into the app, define named queries (with
optional date-range parameters), execute them against the live endpoint, and view
results as both interactive tables and charts. All query definitions and historical
results are persisted locally in SQLite. Results can be exported as JSON, CSV, or PNG.

The app is designed around Alchemix v3 on-chain data (deposits, MYT balances, user
counts per chain) but is intentionally generic: any Ponder endpoint can be used.

---

## Goals

- Run named GraphQL queries against a configurable Ponder endpoint.
- Apply a global date range (start / end datetime) to all queries that accept date
  parameters, injected as GraphQL variables automatically.
- Auto-paginate all results: if Ponder paginates a response, fetch all pages silently
  and return a single aggregated dataset to the UI.
- Display results per chain (results broken out by chain by default).
- Persist query definitions (the GraphQL text, description, category, variable schema)
  in local SQLite so they survive restarts.
- Persist query run history (parameters used, aggregated results, timestamp) so
  results from Q1, Q2, Q3 can be compared side by side.
- Visualise results as tables and charts (bar, line). Charts exportable as PNG.
- Export any result set as JSON or CSV.

## Non-Goals (v1)

- Authentication / multi-user access (localhost only; single user).
- Dune Analytics integration (future enhancement; architecture accommodates it).
- Scheduled / automatic query execution (on-demand only in v1).
- Real-time streaming / live updates.
- Cloud sync or remote storage.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Browser (React SPA)                         │
│  EndpointBar · DateRangePicker · QuerySidebar · QueryEditor     │
│  ResultsTable · ResultsChart · ExportButtons · HistoryDrawer    │
└──────────────────────────┬──────────────────────────────────────┘
                           │  HTTP /api/*
┌──────────────────────────▼──────────────────────────────────────┐
│                  Node.js / Express Backend                       │
│  routes/queries  routes/runs  routes/reports  routes/export     │
│                                                                 │
│  ponder.js — GraphQL client with auto-pagination                │
│  db.js     — SQLite (query defs, run history, endpoint pref)    │
│  export.js — JSON / CSV serialisation                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │  GraphQL POST (proxied)
                 ┌─────────▼─────────┐
                 │  Ponder Endpoint  │
                 │  (user-configured)│
                 └───────────────────┘
```

The backend acts as a proxy between the browser and the Ponder endpoint. This avoids
CORS issues when the endpoint changes, and allows the backend to perform automatic
pagination before returning a single response to the frontend.

---

## Tech Stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Frontend framework | React 18 + Vite | Consistent with other projects |
| Frontend styling | CSS modules (plain) | No Tailwind; keep it simple |
| Charts | Recharts | Composable, React-native, easy PNG export |
| Chart PNG export | html-to-image | Renders a DOM node to PNG blob |
| Backend | Node.js 20 + Express 4 | Consistent with beefy/unifiedEmergency |
| Database | SQLite (better-sqlite3) | Local persistence; no server needed |
| GraphQL client | `node-fetch` + manual POST | No Apollo overhead; full control over pagination |
| CSV generation | `csv-stringify` | Streaming CSV from JS objects |
| Date pickers | react-datepicker | Lightweight; good UX |
| Code editor | `@uiw/react-codemirror` | Syntax-highlighted GraphQL editor |
| Testing | Jest + Supertest | Backend route tests |

---

## Repository Layout

```
quarterly/
├── PLAN.md                        ← this file
├── README.md                      ← setup + run instructions
├── package.json                   ← npm workspace root
├── .env.example                   ← BACKEND_PORT, VITE_API_BASE
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── server.js              ← Express app, mounts all routes
│   │   ├── db.js                  ← SQLite init, migrations, CRUD
│   │   ├── ponder.js              ← GraphQL fetch + auto-pagination
│   │   ├── export.js              ← JSON / CSV serialisation helpers
│   │   └── routes/
│   │       ├── queries.js         ← CRUD: query definitions
│   │       ├── runs.js            ← Execute query, store + return result
│   │       ├── reports.js         ← Named collections of queries (reports)
│   │       ├── export.js          ← Download JSON/CSV for a run
│   │       └── settings.js        ← Persist endpoint URL + preferences
│   ├── data/
│   │   └── quarterly.db           ← SQLite file (gitignored)
│   └── tests/
│       ├── ponder.test.js         ← pagination logic unit tests
│       ├── queries.test.js        ← CRUD route tests
│       └── runs.test.js           ← execution + aggregation tests
├── frontend/
│   ├── package.json
│   ├── vite.config.js             ← proxies /api → :8790
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                ← top-level layout + routing
│       ├── api/
│       │   └── client.js          ← fetch wrappers for all backend routes
│       ├── components/
│       │   ├── EndpointBar.jsx    ← URL input + connection status indicator
│       │   ├── DateRangePicker.jsx← global start/end datetime pickers
│       │   ├── QuerySidebar.jsx   ← tree of saved queries by category
│       │   ├── QueryEditor.jsx    ← CodeMirror GraphQL editor + run button
│       │   ├── ResultsTable.jsx   ← paginated sortable table of results
│       │   ├── ResultsChart.jsx   ← Recharts bar/line + PNG export button
│       │   ├── ExportButtons.jsx  ← Download JSON / Download CSV
│       │   ├── HistoryDrawer.jsx  ← Past runs for a query; side-by-side compare
│       │   ├── ReportBuilder.jsx  ← Group queries into a named report
│       │   └── ChainFilter.jsx    ← Per-chain breakdown toggle
│       └── styles/
│           └── global.css
└── queries/
    └── builtin/                   ← Shipped query definitions (JSON)
        ├── myt_deposits.json
        ├── alchemist_deposits.json
        └── user_counts.json
```

---

## Database Schema

```sql
-- Persisted endpoint URL and global preferences
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Named GraphQL query definitions
CREATE TABLE queries (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL DEFAULT 'General',
    gql         TEXT    NOT NULL,   -- full GraphQL query string
    variables   TEXT    NOT NULL DEFAULT '{}',  -- default variables JSON
    has_dates   INTEGER NOT NULL DEFAULT 1,  -- 1 if query accepts startDate/endDate vars
    has_chain   INTEGER NOT NULL DEFAULT 1,  -- 1 if query accepts chain var
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

-- Historical query executions
CREATE TABLE runs (
    id          INTEGER PRIMARY KEY,
    query_id    INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
    endpoint    TEXT    NOT NULL,   -- endpoint used for this run
    start_date  TEXT,               -- ISO8601 or null
    end_date    TEXT,               -- ISO8601 or null
    variables   TEXT    NOT NULL,   -- merged variables JSON actually sent
    result      TEXT    NOT NULL,   -- aggregated result JSON
    row_count   INTEGER NOT NULL,
    page_count  INTEGER NOT NULL,   -- how many pages were fetched
    duration_ms INTEGER NOT NULL,
    ran_at      TEXT    NOT NULL
);

-- Named reports: ordered collections of queries run together
CREATE TABLE reports (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL
);

CREATE TABLE report_queries (
    report_id   INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    query_id    INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (report_id, query_id)
);
```

---

## Pagination Strategy

Ponder supports two pagination styles:

**Offset-based** (most common):
```graphql
query Deposits($first: Int, $skip: Int, $startDate: BigInt, $endDate: BigInt) {
  deposits(first: $first, skip: $skip, where: { ..., timestamp_gte: $startDate, timestamp_lte: $endDate }) {
    ...fields
  }
}
```

**Cursor-based** (`after` + `pageInfo`):
```graphql
query Deposits($first: Int, $after: String) {
  deposits(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    items { ...fields }
  }
}
```

The backend `ponder.js` module auto-detects which style is in use and handles both:

```js
// ponder.js — simplified
async function fetchAll(endpoint, query, variables) {
    const PAGE_SIZE = 1000;
    let allItems = [];
    let pageCount = 0;

    // Try cursor-based first (check for pageInfo in response shape)
    // Fall back to offset-based if no pageInfo present

    // Offset-based loop:
    let skip = 0;
    while (true) {
        const result = await gqlFetch(endpoint, query, { ...variables, first: PAGE_SIZE, skip });
        const items = extractItems(result);  // finds the first array in the response
        allItems = allItems.concat(items);
        pageCount++;
        if (items.length < PAGE_SIZE) break;
        skip += PAGE_SIZE;
    }
    return { items: allItems, pageCount };
}
```

`extractItems()` uses a simple recursive walk of the response JSON to find the first
array field — this handles arbitrary query shapes without needing schema introspection.

---

## Backend API Routes

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Return all settings (endpoint URL, preferences) |
| PUT | `/api/settings` | Update settings |

### Queries

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/queries` | List all query definitions |
| GET | `/api/queries/:id` | Get a single query |
| POST | `/api/queries` | Create a new query |
| PUT | `/api/queries/:id` | Update a query |
| DELETE | `/api/queries/:id` | Delete a query (cascades run history) |
| POST | `/api/queries/import` | Bulk import from JSON array |

### Runs (execute + history)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/runs` | Execute a query: `{ query_id, endpoint?, start_date?, end_date?, variables? }` |
| GET | `/api/runs?query_id=N` | List past runs for a query |
| GET | `/api/runs/:id` | Get a single run result |
| DELETE | `/api/runs/:id` | Delete a run from history |

### Export

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export/:run_id/json` | Download run result as `.json` |
| GET | `/api/export/:run_id/csv` | Download run result as `.csv` (flattened) |

### Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports` | List all reports |
| POST | `/api/reports` | Create a report |
| GET | `/api/reports/:id` | Get report with its queries |
| PUT | `/api/reports/:id` | Update report |
| DELETE | `/api/reports/:id` | Delete report |
| POST | `/api/reports/:id/run` | Run all queries in the report with current date range |

---

## Frontend — UI Sections

### 1. Top Bar (always visible)
- **Endpoint field** — wide text input; URL pasted here applies to all query executions.
  Connection status dot (green/red) pings the endpoint on change.
- **Date range** — Start datetime / End datetime pickers (ISO8601, local timezone).
  Applied to all queries as `$startDate` / `$endDate` GraphQL variables.
- **Run All** button — executes every query in the currently selected report.

### 2. Left Sidebar — Query Library
- Tree view grouped by category.
- Each query shows: name, last run timestamp, last row count.
- "New Query" button opens a blank editor.
- "New Report" button groups selected queries.
- Built-in queries pre-loaded from `queries/builtin/` at first launch.

### 3. Main Panel — Query Editor + Results

**Editor tab:**
- CodeMirror with GraphQL syntax highlighting.
- Variable overrides panel (JSON editor below the query).
- "Run" button — executes against current endpoint + date range.
- Save / Save As / Delete controls.

**Results tab** (appears after first run):
- **Chain filter bar** — toggle chips per chain (Ethereum / Arbitrum / Optimism / Base / Polygon). Default: all shown separately.
- **Table view** — sortable, filterable table. Columns auto-inferred from result keys.
  Pagination within the table (client-side, all data already loaded).
- **Chart view** — Recharts bar or line chart. User can choose:
  - X axis field
  - Y axis field(s)
  - Chart type (bar / line / area)
  - Group by chain (stacked bars) or overlay
  - "Export PNG" button — uses `html-to-image` to capture the chart div as PNG.

**History drawer** (toggle from Results tab):
- Lists past runs for the current query.
- Click any past run to load it into the results panel (no re-fetch).
- "Compare" mode: pin two runs side by side (useful for Q1 vs Q2).

---

## Built-in Queries

Shipped as JSON files in `queries/builtin/`, imported into the DB on first launch.

### `myt_deposits.json`
```graphql
query MYTDeposits($startDate: BigInt, $endDate: BigInt, $first: Int, $skip: Int) {
  deposits(
    first: $first
    skip: $skip
    where: {
      timestamp_gte: $startDate
      timestamp_lte: $endDate
    }
    orderBy: "timestamp"
    orderDirection: "asc"
  ) {
    id
    chain
    contract
    sender
    assets
    shares
    timestamp
  }
}
```

### `alchemist_deposits.json`
```graphql
query AlchemistDeposits($startDate: BigInt, $endDate: BigInt, $first: Int, $skip: Int) {
  alchemistDeposits(
    first: $first
    skip: $skip
    where: {
      timestamp_gte: $startDate
      timestamp_lte: $endDate
    }
  ) {
    id
    chain
    alchemist
    depositor
    amount
    timestamp
  }
}
```

### `user_counts.json`
```graphql
query UniqueUsers($startDate: BigInt, $endDate: BigInt, $first: Int, $skip: Int) {
  accounts(first: $first, skip: $skip) {
    id
    chain
    firstDepositTimestamp
    totalDeposits
  }
}
```

> **Note:** The actual field names in these queries must be verified against the live
> Ponder schema via introspection (`POST /` with `{ query: "{ __schema { types { name } } }" }`).
> Update the built-in queries to match before first use.

---

## CSV Flattening

Ponder results are nested JSON. The export module flattens them to CSV rows:

- Top-level scalar fields → columns directly.
- Nested objects → dot-notation columns (e.g., `token.symbol` → `token_symbol`).
- Nested arrays → one CSV row per array item, with parent fields repeated.
- `assets` / `shares` fields that are raw 18-decimal integers → divided by 1e18
  automatically unless the field name contains "USDC" (1e6).

This flattening logic lives in `backend/src/export.js` and is tested independently.

---

## Implementation Phases

### Phase 0 — Scaffold
- `npm init` root workspace with `backend/` and `frontend/` workspaces.
- Express skeleton, SQLite init with schema, Vite + React scaffold.
- `GET /api/settings` returns `{}`. Frontend renders an empty shell.
- **Done when:** `npm run dev` starts both servers without errors.

### Phase 1 — Settings + Endpoint Bar
- `PUT/GET /api/settings` stores endpoint URL in SQLite.
- `EndpointBar` component persists URL to backend on change.
- Ping endpoint on save; show green/red connection dot.
- **Done when:** Endpoint URL survives a backend restart.

### Phase 2 — Query CRUD
- Full `queries` routes (list, get, create, update, delete).
- `QuerySidebar` renders query list grouped by category.
- `QueryEditor` with CodeMirror; save/update calls backend.
- Import built-in queries from `queries/builtin/` on first launch (check `settings` for `builtin_imported` flag).
- **Done when:** Can create, edit, delete, and list queries. Built-ins appear on first launch.

### Phase 3 — Execution + Pagination
- `ponder.js`: `fetchAll()` with offset-based and cursor-based pagination.
- `POST /api/runs`: execute query, aggregate all pages, store result, return to client.
- `DateRangePicker` passes `startDate` / `endDate` as Unix timestamps (seconds) to
  match Ponder's `BigInt` timestamp fields.
- Results displayed as raw JSON in the UI (table comes in Phase 4).
- **Done when:** Running the `myt_deposits` built-in against the live endpoint returns
  all rows (not just the first 100).

### Phase 4 — Results Table + Chain Filter
- `ResultsTable`: auto-infer columns from result keys; sortable; client-side pagination.
- `ChainFilter`: chip toggles per chain; filters the displayed rows.
- **Done when:** MYT deposits shown in a table, filterable by chain.

### Phase 5 — Charts + PNG Export
- `ResultsChart`: Recharts bar/line/area; user picks X/Y fields and chart type.
- "Export PNG" button using `html-to-image`.
- **Done when:** Can render a bar chart of assets by chain and download as PNG.

### Phase 6 — Run History + Compare
- `GET /api/runs?query_id=N` route.
- `HistoryDrawer` lists past runs; click to load into results panel without re-fetch.
- "Compare" mode: pin two runs side by side.
- **Done when:** Can compare Q1 results vs Q2 results for the same query.

### Phase 7 — Export (JSON + CSV)
- `GET /api/export/:run_id/json` and `/csv` routes.
- `ExportButtons` in the UI triggers download.
- CSV flattening handles nested objects and 18-decimal integer fields.
- **Done when:** Can download a run as a clean spreadsheet-ready CSV.

### Phase 8 — Reports
- `reports` and `report_queries` routes.
- `ReportBuilder` lets user name a report and add queries to it.
- "Run All" button in the top bar executes all queries in the active report sequentially.
- **Done when:** Can define a "Q2 2026" report, run all queries with one click, and
  download each result as CSV.

### Phase 9 — Tests + Polish
- Jest tests for `ponder.js` pagination logic (mock HTTP server).
- Jest + Supertest tests for all backend routes.
- Error states: endpoint unreachable, query syntax error, timeout.
- Loading spinners during query execution.
- **Done when:** All tests pass; UI handles all error states gracefully.

---

## Environment Variables

```
# backend/.env
PORT=8790

# frontend/.env (Vite)
VITE_API_BASE=http://localhost:8790
```

The Ponder endpoint URL is **not** an environment variable — it is stored in the SQLite
`settings` table and configured via the UI. This allows it to be changed at runtime
without restarting the server.

---

## Running the App

```bash
# Install
npm install          # from repo root (installs all workspaces)

# Development (two terminals)
cd backend && npm run dev     # nodemon, port 8790
cd frontend && npm run dev    # Vite, port 5173 (proxies /api → 8790)

# Or from root (if concurrently is added):
npm run dev

# Tests
cd backend && npm test
```

---

## Key Open Questions (to resolve during development)

1. **Ponder schema field names** — the built-in queries use assumed field names
   (`deposits`, `assets`, `timestamp`, etc.). These must be verified against the live
   schema via introspection before Phase 3.

2. **Timestamp format** — does the Ponder endpoint use Unix seconds (`BigInt`), Unix
   milliseconds, or ISO8601 strings for date filtering? Determines how the date pickers
   pass values to the query variables.

3. **Pagination style** — does the endpoint use offset (`first` + `skip`) or cursor
   (`after` + `pageInfo`)? Determines which `fetchAll()` branch runs first.
   Check with a small `first: 2` test query.

4. **Chain field** — is chain returned as a string (`"optimism"`) or a chain ID integer?
   Determines how the `ChainFilter` compares values.

5. **Dune integration (future)** — if Dune queries are added later, the `runs` table
   and `ponder.js` module should be abstracted behind a `sources/` layer with a
   `ponder.js` and `dune.js` adapter. Design now to make this straightforward later.
