# quarterly — Development Plan

## Overview

`quarterly` is a locally-hosted web dashboard for running and saving GraphQL queries
against a [Ponder](https://ponder.sh/) indexing endpoint, designed to support quarterly
reporting workflows for Alchemix v3 on-chain data.

Users paste a Ponder GraphQL endpoint URL into the app, define named queries (with
explicit variable schemas and field metadata), execute them with a shared date range,
and view results as tables and charts. All query definitions and historical results
are persisted locally in SQLite. Results can be exported as JSON, CSV, or PNG.

The app is Alchemix-aware (built-in queries for MYT deposits, Alchemist deposits, user
counts) but is architected generically: any Ponder-compatible GraphQL endpoint can be
used, and all Alchemix-specific behavior (decimal scaling, field labels) is expressed
as per-query metadata rather than hardcoded heuristics.

---

## Goals

- Run named GraphQL queries against a user-configured Ponder endpoint.
- Apply a global date range to all queries; date format (Unix seconds / ms / ISO8601)
  is configured per query.
- Auto-paginate results (offset-based and cursor-based) using an explicit `result_path`
  per query; no magic array-finding.
- Persist query definitions (GraphQL text, variable schema, field metadata, pagination
  config) in local SQLite.
- Persist query run history (parameters, aggregated result rows, error state) for
  cross-quarter comparison.
- Display results per chain; chain can be injected as a GraphQL variable or applied as
  a client-side filter — configurable per query.
- Visualise results as sortable tables and Recharts charts (bar / line / area); export
  charts as PNG.
- Export any run as JSON or CSV; CSV decimal scaling is driven by per-field metadata.
- Bundle all runs in a report as a ZIP of CSVs.

## Non-Goals (v1)

- Multi-user access or authentication (localhost-only; single user).
- Dune Analytics integration (architecture accommodates it; not built in v1).
- Scheduled / automatic query execution (on-demand only).
- Real-time streaming or live updates.
- Cloud sync or remote storage.
- Manual timeline editing or visual query builder.

---

## Security Requirements

**Even for localhost-only use, the backend proxies arbitrary user-entered URLs and
stores large result blobs. The following are hard requirements, not suggestions.**

### Network binding
The Express server **must** bind to `127.0.0.1` (not `0.0.0.0`) by default:

```js
server.listen(PORT, '127.0.0.1', () => { ... });
```

An explicit `--host 0.0.0.0` flag may be added for LAN use, but must not be the default.

### Endpoint URL validation
Before proxying any request to a user-supplied endpoint:

1. Parse the URL with `new URL(endpoint)`. Reject if it throws.
2. Allow only `https:` or `http:` schemes.
3. For `http:`, allow **only** loopback addresses: `127.0.0.1`, `::1`, `localhost`.
   Reject any other `http:` host (prevents SSRF to internal services on LAN).
4. For `https:`, additionally reject private IP ranges:
   - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
   - `fc00::/7` (IPv6 ULA)
   - `169.254.0.0/16` (link-local)
5. Reject URLs with credentials (`user:pass@host`).
6. Reject URLs with ports in a configurable blocklist (default: 22, 25, 465, 587).

**DNS rebinding protection (required):** Checking only the hostname string is
insufficient — a hostname like `evil.example.com` could resolve to a private IP.

7. For any non-loopback hostname, resolve it with `dns.promises.lookup()` **before**
   making the request. Apply ipaddr.js private-range checks to all resolved IPs.
   If DNS resolution fails or the resolved IP falls in a blocked range, return 400.
8. **Disable redirect following** (set `redirect: 'error'` in node-fetch, or
   equivalent). If a redirect must be followed, re-validate the redirect `Location`
   URL through steps 1–7 before following it.

Return HTTP 400 with `{ error: "invalid_endpoint", message: "..." }` on rejection.
This validation runs in a shared middleware used by all routes that proxy to the endpoint.

### Result size limits
- **Size measurement:** `Buffer.byteLength(JSON.stringify(rows), 'utf8')` — applied to
  the normalized row array (after key-union normalization) before SQLite storage.
  No compression; no pretty-print whitespace.
- **Warn** (return a `warnings` array) when the measured size exceeds 1 MB.
  The result is still saved automatically; the UI shows a non-blocking warning banner.
  No user confirmation step — the user may delete large runs from history afterward.
- **Abort and return HTTP 413** when the measured size exceeds 10 MB; the run
  is not saved to SQLite.
- These limits are configurable via `settings` (keys `warn_bytes`, `max_bytes`).

> **Rationale:** A "Save anyway" confirmation implies a two-step API (dry-run then
> save), which would require either re-executing the query or server-side result
> caching. For a local-only reporting tool the simpler contract — always save
> successful sub-10 MB runs, surface size as a warning only — is preferable.

### Other
- All SQLite queries use parameterised statements (never string interpolation).
- `result` stored in `runs` table is always valid JSON; validated before `INSERT`.
- GraphQL query strings stored in `queries` table are never executed server-side as
  code — they are passed verbatim to the Ponder endpoint as a string value.

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
│          Node.js / Express (bound to 127.0.0.1)                 │
│  middleware/validateEndpoint.js — URL allowlist check           │
│  routes/queries  routes/runs  routes/reports  routes/export     │
│  routes/settings routes/introspect                              │
│                                                                 │
│  ponder.js   — GraphQL fetch + auto-pagination                  │
│  db.js       — SQLite init, versioned migrations                │
│  export.js   — JSON / CSV serialisation                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │  GraphQL POST (proxied)
                 ┌─────────▼─────────┐
                 │  Ponder Endpoint  │
                 │  (user-configured)│
                 └───────────────────┘
```

---

## Tech Stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Frontend framework | React 18 + Vite | Consistent with other projects |
| Frontend styling | CSS modules | No Tailwind; keep it simple |
| Charts | Recharts | Composable, React-native |
| Chart PNG export | html-to-image | Captures DOM node as PNG blob |
| GraphQL editor | @uiw/react-codemirror | Syntax highlighting |
| Date pickers | react-datepicker | Lightweight |
| Virtual scrolling | @tanstack/react-virtual | Tables > 500 rows |
| Backend | Node.js 20 + Express 4 | Consistent with other projects |
| Database | SQLite via better-sqlite3 | Synchronous; simpler than async |
| GraphQL client | node-fetch + manual POST | Full pagination control |
| CSV generation | csv-stringify | Streaming |
| ZIP export | archiver | Bundle report CSVs |
| IP range check | ipaddr.js | SSRF protection |
| Testing | Jest + Supertest | Backend route + unit tests |

---

## Repository Layout

```
quarterly/
├── PLAN.md                        ← this file
├── README.md
├── package.json                   ← npm workspace root
├── .env.example
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── server.js              ← Express app, binds 127.0.0.1
│   │   ├── db.js                  ← SQLite init + migration runner
│   │   ├── ponder.js              ← GraphQL fetch + pagination
│   │   ├── export.js              ← JSON / CSV / ZIP helpers
│   │   ├── middleware/
│   │   │   └── validateEndpoint.js← URL allowlist enforcement
│   │   ├── migrations/
│   │   │   ├── 001_initial.js     ← baseline schema
│   │   │   └── 002_*.js           ← future migrations
│   │   └── routes/
│   │       ├── queries.js         ← CRUD: query definitions
│   │       ├── runs.js            ← execute + store results
│   │       ├── reports.js         ← grouped query sets
│   │       ├── export.js          ← download JSON / CSV / ZIP
│   │       ├── introspect.js      ← proxy schema introspection
│   │       └── settings.js        ← endpoint + preferences
│   ├── data/
│   │   └── quarterly.db           ← SQLite (gitignored)
│   └── tests/
│       ├── validateEndpoint.test.js
│       ├── ponder.test.js
│       ├── queries.test.js
│       ├── runs.test.js
│       └── export.test.js
├── frontend/
│   ├── package.json
│   ├── vite.config.js             ← proxies /api → :8790
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api/client.js
│       ├── components/
│       │   ├── EndpointBar.jsx
│       │   ├── DateRangePicker.jsx
│       │   ├── QuerySidebar.jsx
│       │   ├── QueryEditor.jsx
│       │   ├── VariablePanel.jsx
│       │   ├── ResultsTable.jsx
│       │   ├── ResultsChart.jsx
│       │   ├── ExportButtons.jsx
│       │   ├── HistoryDrawer.jsx
│       │   ├── CompareView.jsx
│       │   ├── ReportBuilder.jsx
│       │   └── ChainFilter.jsx
│       └── styles/global.css
└── queries/
    └── builtin/
        ├── myt_deposits.json
        ├── alchemist_deposits.json
        └── user_counts.json
```

---

## Database Schema

### Migration system

`db.js` maintains a `schema_version` table. On startup it reads the current version,
finds all migration files in `migrations/` with a higher number, and applies them in
order inside a transaction. Migrations are never re-run. Schema version is incremented
atomically after each successful migration.

```sql
CREATE TABLE schema_version (
    version   INTEGER NOT NULL,
    applied_at TEXT   NOT NULL
);
```

### Migration 001 — baseline

```sql
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- Keys: endpoint, warn_bytes (default 1048576), max_bytes (default 10485760),
--       page_size (default 1000), max_page_count (default 50),
--       max_row_count (default 50000), timeout_per_page_ms (default 30000),
--       builtin_imported (0/1)

CREATE TABLE queries (
    id              INTEGER PRIMARY KEY,
    name            TEXT    NOT NULL,
    description     TEXT    NOT NULL DEFAULT '',
    category        TEXT    NOT NULL DEFAULT 'General',
    gql             TEXT    NOT NULL,
    -- Variable schema: JSON array of VariableDef objects (see below)
    variable_defs   TEXT    NOT NULL DEFAULT '[]',
    -- Pagination config
    result_path     TEXT    NOT NULL,        -- e.g. "data.deposits" or "data.deposits.items"
    pagination_style TEXT   NOT NULL DEFAULT 'offset', -- "offset" | "cursor" | "none"
    cursor_path     TEXT    NOT NULL DEFAULT '', -- e.g. "data.deposits.pageInfo.endCursor"
    has_next_path   TEXT    NOT NULL DEFAULT '', -- e.g. "data.deposits.pageInfo.hasNextPage"
    -- Date config
    date_format     TEXT    NOT NULL DEFAULT 'unix_seconds', -- "unix_seconds"|"unix_ms"|"iso8601"
    -- Chain config
    chain_mode      TEXT    NOT NULL DEFAULT 'filter', -- "variable"|"filter"|"none"
    chain_var_name  TEXT    NOT NULL DEFAULT 'chain',  -- GraphQL variable name (chain_mode=variable)
    chain_field     TEXT    NOT NULL DEFAULT 'chain',  -- result-row field used to identify the chain
                                                        -- for client-side filtering (may differ from
                                                        -- chain_var_name)
    -- Field display metadata: JSON object { fieldName: FieldMeta }
    field_meta      TEXT    NOT NULL DEFAULT '{}',
    -- Key field for comparison (e.g. "id" or "chain")
    key_field       TEXT    NOT NULL DEFAULT 'id',
    -- Whether this is a built-in (never overwritten on re-import)
    is_builtin      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
);

CREATE TABLE runs (
    id              INTEGER PRIMARY KEY,
    query_id        INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
    endpoint        TEXT    NOT NULL,
    start_date      TEXT,           -- ISO8601 UTC; null if query has no date vars
    end_date        TEXT,           -- ISO8601 UTC
    variables_base  TEXT    NOT NULL, -- user-controlled variables (dates + user vars)
                                      -- excluding pagination state (first/skip/after).
                                      -- Pagination is captured by page_count.
    -- Result
    rows            TEXT,           -- JSON array of row objects; null on error
    row_count       INTEGER NOT NULL DEFAULT 0,
    page_count      INTEGER NOT NULL DEFAULT 0,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    -- Error state
    error_type      TEXT,           -- null | "invalid_endpoint" | "invalid_query" | "network" |
                                      --   "timeout" | "graphql" | "graphql_partial" |
                                      --   "size_limit" | "page_limit" | "row_limit" | "path_error"
    error_message   TEXT,
    graphql_errors  TEXT,           -- JSON array of GraphQL error objects, if any
    -- Warnings
    warnings        TEXT,           -- JSON array of warning strings
    ran_at          TEXT    NOT NULL
);

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

-- One row per report execution
CREATE TABLE report_runs (
    id          INTEGER PRIMARY KEY,
    report_id   INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    start_date  TEXT,
    end_date    TEXT,
    endpoint    TEXT    NOT NULL,
    ran_at      TEXT    NOT NULL
);

-- One row per (report_run, query) — links to the individual run record
CREATE TABLE report_run_queries (
    report_run_id  INTEGER NOT NULL REFERENCES report_runs(id) ON DELETE CASCADE,
    query_id       INTEGER NOT NULL REFERENCES queries(id),
    run_id         INTEGER REFERENCES runs(id),  -- null if this query failed
    status         TEXT    NOT NULL DEFAULT 'pending', -- "pending"|"ok"|"failed"|"cancelled"
    error_message  TEXT,
    PRIMARY KEY (report_run_id, query_id)
);

CREATE INDEX idx_runs_query    ON runs(query_id, ran_at);
CREATE INDEX idx_runs_ran_at   ON runs(ran_at);
```

### VariableDef schema (stored in `queries.variable_defs` as JSON)

```json
[
  {
    "name": "startDate",
    "type": "datetime",
    "label": "Start Date",
    "required": false,
    "source": "global_start",
    "format": "unix_seconds"
  },
  {
    "name": "endDate",
    "type": "datetime",
    "label": "End Date",
    "required": false,
    "source": "global_end",
    "format": "unix_seconds"
  },
  {
    "name": "first",
    "type": "int",
    "label": "Page size",
    "required": false,
    "source": "pagination_first",
    "default": 1000
  },
  {
    "name": "skip",
    "type": "int",
    "label": "Skip",
    "required": false,
    "source": "pagination_skip",
    "default": 0
  }
]
```

`source` values:
- `"global_start"` / `"global_end"` — filled from the global date pickers
- `"pagination_first"` / `"pagination_skip"` / `"pagination_after"` — filled by the pagination engine
- `"user"` — shown as a manual input field in `VariablePanel`
- `"none"` — not injected; user provides in the variable JSON editor

### FieldMeta schema (stored in `queries.field_meta` as JSON)

```json
{
  "assets": {
    "label": "Assets",
    "decimals": 18,
    "unit": "ETH"
  },
  "shares": {
    "label": "Shares",
    "decimals": 18,
    "unit": "mixWETH"
  },
  "timestamp": {
    "label": "Timestamp",
    "type": "unix_seconds"
  }
}
```

The CSV export and table display use `field_meta` for decimal scaling and labels.
No field is scaled unless `decimals` is explicitly set in its `FieldMeta`.

---

## Pagination

### Rules

Each query definition stores:
- `result_path` — dotted path into the response JSON to the array of result rows
  (e.g. `"data.deposits"` or `"data.deposits.items"`). **Required. No guessing.**
- `pagination_style` — `"offset"` | `"cursor"` | `"none"`
- `cursor_path` — for cursor style: dotted path to the cursor string
  (e.g. `"data.deposits.pageInfo.endCursor"`)
- `has_next_path` — for cursor style: dotted path to the boolean
  (e.g. `"data.deposits.pageInfo.hasNextPage"`)

### Offset-based loop (`pagination_style = "offset"`)

Variable names injected by the pagination engine:
- `first` (page size, from `settings.page_size`, default 1000)
- `skip` (current offset, starts at 0)

```
page_count = 0
skip = 0
all_rows = []
loop:
    send query with { first, skip, ...user_vars }
    rows = get(response, result_path)      // exact dotted path, no guessing
    if rows is not an array: abort with error "result_path did not resolve to array"
    all_rows += rows
    page_count++
    if page_count > max_page_count: abort with error "max_page_count exceeded"
    if len(all_rows) > max_row_count: abort with error "max_row_count exceeded"
    if len(rows) < first: break            // last page
    skip += first
return all_rows, page_count
```

> **Boundary note:** `>` (not `>=`) means `max_page_count = 50` allows exactly 50 pages
> and only aborts if a 51st would be needed. Same logic applies to `max_row_count`.

### Cursor-based loop (`pagination_style = "cursor"`)

Variable names injected:
- `first` (page size, from `settings.page_size`)
- `after` (cursor string, starts as `null`)

```
page_count = 0
after = null
all_rows = []
loop:
    send query with { first, after, ...user_vars }
    rows = get(response, result_path)
    has_next = get(response, has_next_path)
    cursor = get(response, cursor_path)
    all_rows += rows
    page_count++
    if page_count > max_page_count: abort
    if len(all_rows) > max_row_count: abort
    if not has_next: break
    after = cursor
return all_rows, page_count
```

### No pagination (`pagination_style = "none"`)

Single request. `result_path` still used to extract rows. `first`/`skip`/`after`
not injected.

### Test cases (ponder.test.js)

- Offset: 2500 rows, page size 1000 → 3 pages, 2500 rows returned.
- Offset: exactly 1000 rows (one full page) → 2 pages (second returns 0), 1000 rows.
- Cursor: 3 pages with `hasNextPage` true/true/false → 3 pages, correct rows.
- `result_path` resolves to non-array → error thrown, no rows.
- `max_page_count` = 2, 3 pages available → error after page 2.
- Network timeout on page 2 → error, partial rows NOT saved.
- GraphQL errors array in response alongside data → handled per error policy below.

---

## Date Handling

Global date pickers always work in the **user's local timezone** and return a
`Date` object. At query execution time, the frontend converts to the query's
`date_format`:

| `date_format` | Conversion |
|---|---|
| `"unix_seconds"` | `Math.floor(date.getTime() / 1000)` |
| `"unix_ms"` | `date.getTime()` |
| `"iso8601"` | `date.toISOString()` (UTC) |

The converted values are passed as GraphQL variables matching the `VariableDef` entries
with `source: "global_start"` / `source: "global_end"`.

**Before running any query for the first time**, the developer must confirm the
endpoint's timestamp format. See Phase 1.5 (Schema Introspection) and the `date_format`
field in the query definition. The built-in queries default to `"unix_seconds"`.

---

## API Contracts

### `POST /api/runs`

Request body:
```json
{
  "query_id": 1,
  "endpoint": "https://...",    // optional; falls back to settings.endpoint
  "start_date": "2026-01-01T00:00:00Z",  // ISO8601; null if no date vars
  "end_date": "2026-04-01T00:00:00Z",
  "variable_overrides": {}      // optional; merged over computed vars, highest priority
}
```

Success response (HTTP 200):
```json
{
  "id": 42,
  "query_id": 1,
  "endpoint": "https://...",
  "start_date": "2026-01-01T00:00:00Z",
  "end_date": "2026-04-01T00:00:00Z",
  "variables_base": { "startDate": 1735689600, "endDate": 1743465600 },
  "rows": [ { "id": "...", "chain": "optimism", "assets": "1000000000000000000", ... } ],
  "row_count": 847,
  "page_count": 1,
  "duration_ms": 1203,
  "error_type": null,
  "error_message": null,
  "graphql_errors": null,
  "warnings": [],
  "ran_at": "2026-05-18T20:00:00.000Z"
}
```

> **Note on `graphql_partial`:** Returning HTTP 200 (not 207) for partial data avoids
> surprising fetch/axios error handling in clients that treat non-2xx as failures.
> The `error_type` field reliably distinguishes the case.

Error response (HTTP 400/502/504/413):
```json
{
  "id": null,
  "query_id": 1,
  "error_type": "network",
  "error_message": "ECONNREFUSED connecting to https://...",
  "rows": null,
  "row_count": 0,
  "page_count": 0,
  "duration_ms": 0,
  "warnings": []
}
```

Error types:
| `error_type` | HTTP status | Meaning |
|---|---|---|
| `"invalid_endpoint"` | 400 | URL blocked by allowlist |
| `"invalid_query"` | 400 | query_id not found; invalid variable JSON |
| `"network"` | 502 | Could not reach endpoint |
| `"timeout"` | 504 | Per-page or total timeout exceeded |
| `"graphql"` | 400 | GraphQL `errors` array returned, no `data` |
| `"graphql_partial"` | 200 | GraphQL returned both `data` and `errors`; partial rows saved |
| `"size_limit"` | 413 | Result exceeded `max_bytes` |
| `"page_limit"` | 422 | Exceeded `max_page_count` |
| `"row_limit"` | 422 | Exceeded `max_row_count` |
| `"path_error"` | 422 | `result_path` did not resolve to an array |

**Runs are only saved to SQLite for `error_type = null` or `"graphql_partial"`.**
Failed runs are returned to the client but not persisted.

### `rows` field

- Always a flat JSON array of objects.
- Row field values are **raw strings/numbers from Ponder** — no decimal scaling applied
  server-side. Scaling is applied by the CSV exporter and the frontend table using
  `field_meta`.
- **Key normalization (union of all keys):** Before persisting and before rendering,
  compute the union of all keys across every row. Every row is padded with `null` for
  any key it is missing. Extra keys appearing in later rows are **not** discarded.

  ```
  // Example input:
  [ { "a": 1 }, { "a": 2, "b": 3 } ]
  // After normalization:
  [ { "a": 1, "b": null }, { "a": 2, "b": 3 } ]
  ```

  Normalization is applied server-side before the `rows` value is stored in SQLite,
  so the stored result is already fully normalized. Clients do not need to normalize.

### `POST /api/reports/:id/run`

Runs all queries in the report sequentially **in ascending `position` order**.
Stops: **no** — continues on failure.
All queries share the same `start_date`/`end_date` from the request body.

Response: HTTP 200 with the `report_run` record including per-query status:
```json
{
  "id": 7,
  "report_id": 2,
  "start_date": "...",
  "end_date": "...",
  "ran_at": "...",
  "queries": [
    { "query_id": 1, "run_id": 42, "status": "ok" },
    { "query_id": 2, "run_id": null, "status": "failed", "error_message": "network error" }
  ]
}
```

### Endpoint ping (`GET /api/settings/ping`)

Sends `POST` to the stored endpoint with body `{ "query": "{ __typename }" }`.
Returns `{ "ok": true, "latency_ms": 45 }` or `{ "ok": false, "error": "..." }`.
URL is validated by `validateEndpoint` middleware before the request is made.

---

## Frontend — UI Sections

### Top Bar (always visible)
- **Endpoint field** — wide text input. On blur/Enter, sends `PUT /api/settings`.
  Connection dot (green/yellow/red) reflects last ping result; re-pings on change.
  URL validation error shown inline.
- **Date range** — Start / End datetime pickers (local timezone). Stored in component
  state and passed to run calls; not persisted globally (use reports for that).
- **Active report selector** — dropdown of saved reports; "Run All" button executes
  the active report with current date range.

### Left Sidebar — Query Library
- Tree grouped by `category`. Each item shows name, last-run timestamp, last row count.
- "New Query" — opens blank editor with default variable schema.
- "New Report" — creates a report; drag queries into it.
- Built-in queries shown with a lock icon; `gql` and metadata are editable but built-in
  flag prevents re-import from overwriting them.

### Main Panel

**Editor tab:**
- CodeMirror with GraphQL syntax highlighting.
- Fields: Name, Description, Category, `result_path`, `pagination_style`, `date_format`,
  `chain_mode`, `key_field`.
- `variable_defs` editor: table UI for adding/editing variables (name, type, source, default).
- `field_meta` editor: table UI for field labels, decimals, unit.
- "Run" button — validates variable JSON, then calls `POST /api/runs`.
- "Introspect" button — calls `POST /api/introspect` to fetch schema and show type info.
- Save / Save As / Delete.

**Results tab:**
- **Warning banner** if `warnings` is non-empty (e.g. large result size).
- **Chain filter bar** — auto-inferred from unique values in the row field named by
  `chain_field` (default `"chain"`). Note: `chain_var_name` is the *GraphQL variable*
  name used when injecting the chain into the query; `chain_field` is the *result-row*
  field used for client-side filtering. They may differ. Shows all chains as toggle chips.
- **Table view** — virtualised (react-virtual) for rows > 500. Columns auto-inferred
  from the union of all rows' keys. Column order: key field first, then insertion order
  of the first row (remaining new keys appended). User can
  drag to reorder (client-side only in v1). Numeric fields scaled using `field_meta`.
  Timestamps formatted as local datetime.
- **Chart view** — Recharts. User selects X field, one or more Y fields, chart type.
  Chain toggle overlays series per chain or stacks them. "Export PNG" button.
- **Export row** — Download JSON, Download CSV.

**History drawer** (slide-in from right, toggle button):
- Lists past runs for the current query (newest first).
- Click to load a past run into the Results tab (no re-fetch).
- "Compare" button: pins two runs side by side in `CompareView`.

### CompareView
- Side-by-side tables; rows matched by `key_field`.
- Delta column per numeric field: absolute diff + percentage change.
- Rows present in one run but not the other highlighted in yellow.
- Chart overlay mode: both runs as series on the same Recharts chart.

**Key matching rules:**

- Rows are matched across runs by their `key_field` value (strict string equality).
- `key_field` values **must be unique within each run**. If duplicates are detected,
  the first occurrence wins and subsequent duplicates are flagged with a yellow
  "duplicate key" indicator in the UI. No silent data loss.
- Rows with a `null` or missing `key_field` value are treated as **unmatched** —
  they appear in the "only in run A" / "only in run B" sections highlighted in yellow,
  not matched against each other.
- Rows present in one run but absent in the other are shown with `—` in all delta cells.

**Numeric field classification for delta columns:**

Raw Ponder values may be strings, BigInt-like strings, already-scaled display values,
timestamps, or opaque IDs. A field is treated as numeric for delta purposes only if
**both** of the following are true:

1. It has `decimals` set in `field_meta` (explicitly declared as a scaled integer), **or**
   both run values for that field parse as `Number.isFinite(parseFloat(v))` and are not
   so large that `parseFloat` loses precision (i.e. value ≤ `Number.MAX_SAFE_INTEGER`).
2. The field's `field_meta` does not have `type: "unix_seconds"`, `type: "unix_ms"`,
   `type: "iso8601"`, or `type: "id"`.

If a field does not meet both criteria, the delta cell shows `—`. This prevents
nonsensical arithmetic on transaction hashes, addresses, or timestamps.

---

## CSV Flattening (`export.js`)

Flattening rules applied in order:
1. Top-level scalar (string, number, boolean, null) → column.
2. Top-level object → dot-notation columns (e.g. `token.symbol` → `token_symbol`).
   Recursed to depth 3; deeper objects serialised as JSON string.
3. Top-level array → one CSV row per element; parent scalars repeated.
4. Decimal scaling: only applied when `field_meta[fieldName].decimals` is set.
   **Must not use integer division** (`BigInt / BigInt` truncates the fractional part).
   Use the following exact helper:

   ```js
   function scaledDecimal(rawValue, decimals) {
     const raw = BigInt(rawValue);
     const d = BigInt(decimals);
     const divisor = 10n ** d;
     const negative = raw < 0n;
     const abs = negative ? -raw : raw;
     const intPart = abs / divisor;
     const fracRaw = (abs % divisor).toString()             // use abs to avoid sign on remainder
       .padStart(decimals, '0')                              // preserve leading zeros
       .replace(/0+$/, '');                                  // strip trailing zeros
     const magnitude = fracRaw.length > 0 ? `${intPart}.${fracRaw}` : `${intPart}`;
     return negative ? `-${magnitude}` : magnitude;
   }
   ```

   Examples:
   - `("1500000000000000000", 18)` → `"1.5"` (not `"1"`)
   - `("-500000000000000000", 18)` → `"-0.5"` (sign on whole result, not fractional part)
   - `("-1", 18)` → `"-0.000000000000000001"` (JS BigInt `%` keeps sign on remainder,
     hence the `abs` normalisation above)
5. Timestamp formatting: when `field_meta[fieldName].type === "unix_seconds"`,
   value converted to ISO8601.
6. Column order: key field first, then remaining columns in insertion order of
   the first result row.

Tested independently in `export.test.js` with:
- Nested objects; nested arrays; mixed.
- BigInt decimal edge cases (0, very large, negative).
- Rows with missing keys (→ empty cell, not error).

---

## Schema Introspection

`POST /api/introspect` proxies an introspection query to the configured endpoint
and returns the simplified type map:

```json
{
  "types": {
    "Query": { "fields": ["deposits", "alchemistDeposits", "accounts"] },
    "Deposit": { "fields": ["id", "chain", "assets", "shares", "timestamp"] }
  }
}
```

This is used in the Query Editor to:
- **Basic path segment validation** — split `result_path` on `.` and check that the
  first segment after `"data"` names a field on the root `Query` type. Deep traversal
  through nested connection/list types is **not** attempted; only the top-level field
  is checked. The validator shows a warning, not an error, so saving is never blocked.
- Warn if field names in `field_meta` do not appear in the top-level result type
  (best-effort; connection wrapper types may obscure nested fields).
- Show autocomplete suggestions (v2).

> **Scope note:** Full nested-path traversal through GraphQL list and connection types
> is complex and not required in v1. Keep the implementation simple and document
> that the check is advisory only.

---

## Built-in Queries

Stored as JSON files in `queries/builtin/`. Imported into SQLite on first launch
(gated by `settings.builtin_imported = "1"`). **Never re-imported on subsequent
launches**, so user edits are preserved.

If a future code update needs to update a built-in, bump its `name` (treat the new
version as a new query) rather than overwriting the existing row.

### `myt_deposits.json` (template — field names to be verified against live schema)
```json
{
  "name": "MYT Deposits",
  "category": "MYT",
  "description": "All deposits into MYT wrapper contracts, aggregated by chain",
  "gql": "query MYTDeposits($startDate: BigInt, $endDate: BigInt, $first: Int, $skip: Int) {\n  deposits(\n    first: $first\n    skip: $skip\n    where: { timestamp_gte: $startDate, timestamp_lte: $endDate }\n    orderBy: \"timestamp\"\n    orderDirection: \"asc\"\n  ) {\n    id\n    chain\n    contract\n    sender\n    assets\n    shares\n    timestamp\n  }\n}",
  "result_path": "data.deposits",
  "pagination_style": "offset",
  "date_format": "unix_seconds",
  "chain_mode": "filter",
  "key_field": "id",
  "variable_defs": [
    { "name": "startDate", "type": "int", "source": "global_start", "format": "unix_seconds" },
    { "name": "endDate",   "type": "int", "source": "global_end",   "format": "unix_seconds" },
    { "name": "first",     "type": "int", "source": "pagination_first", "default": 1000 },
    { "name": "skip",      "type": "int", "source": "pagination_skip",  "default": 0 }
  ],
  "field_meta": {
    "assets": { "label": "Assets",  "decimals": 18 },
    "shares": { "label": "Shares",  "decimals": 18 },
    "timestamp": { "label": "Time", "type": "unix_seconds" }
  },
  "is_builtin": 1
}
```

> **⚠️ Field names in all built-in queries are assumed based on the Ponder schema
> conventions. They MUST be verified against the live endpoint during Phase 1.5
> (schema introspection) before the queries will actually return data.**

---

## Backend API Routes

### Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | All settings key-value pairs |
| PUT | `/api/settings` | Update one or more settings |
| GET | `/api/settings/ping` | Ping configured endpoint; returns latency |

### Introspection
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/introspect` | Proxy introspection query; return simplified type map |

### Queries
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/queries` | List all queries |
| GET | `/api/queries/:id` | Single query definition |
| POST | `/api/queries` | Create query; validate `result_path` not empty |
| PUT | `/api/queries/:id` | Update; validate fields |
| DELETE | `/api/queries/:id` | Delete (cascade runs) |
| POST | `/api/queries/import` | Bulk import JSON array; skip if `name` exists and `is_builtin=1` |

### Runs
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/runs` | Execute; auto-paginate; save if successful |
| GET | `/api/runs?query_id=N&limit=20&offset=0` | List runs for a query |
| GET | `/api/runs/:id` | Single run (includes `rows`) |
| DELETE | `/api/runs/:id` | Delete run from history |

### Reports
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports` | List reports |
| POST | `/api/reports` | Create report |
| GET | `/api/reports/:id` | Report with query list |
| PUT | `/api/reports/:id` | Update name/description/query order |
| DELETE | `/api/reports/:id` | Delete |
| POST | `/api/reports/:id/run` | Run all queries; returns report_run record |
| GET | `/api/reports/runs/:report_run_id` | Get a past report run with per-query status |

### Export
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export/run/:id/json` | Download run as `.json` |
| GET | `/api/export/run/:id/csv` | Download run as `.csv` |
| GET | `/api/export/report-run/:id/zip` | Download all CSVs in a report run as `.zip` |

---

## Implementation Phases

### Phase 0 — Scaffold
- Root `package.json` npm workspace; `backend/` and `frontend/` sub-workspaces.
- Express skeleton; SQLite init running migration 001 (full schema above).
- Vite + React scaffold; `EndpointBar` renders but does nothing.
- `GET /api/settings` returns `{}`.
- **Done when:** `npm run dev` starts both servers without errors; DB file created with
  correct schema.

### Phase 1 — Settings, Endpoint Bar, Security Middleware
- `validateEndpoint.js` middleware with full URL allowlist logic; tested in
  `validateEndpoint.test.js` (loopback allowed, private IP rejected, bad scheme rejected).
- `PUT/GET /api/settings`; `GET /api/settings/ping`.
- `EndpointBar` persists URL, shows connection dot.
- **Done when:** Pasting a valid HTTPS URL saves it. Pasting `http://192.168.1.1`
  returns 400. Ping shows green on a live endpoint.

### Phase 1.5 — Schema Introspection
- `POST /api/introspect` route.
- "Introspect" button in UI; display returned type map in a panel.
- **Done when:** Running introspection against the live Ponder endpoint shows field
  names. Use results to correct all built-in query `gql` strings and `result_path`
  values before Phase 3.

### Phase 2 — Query CRUD + Built-ins
- All `queries` routes including `POST /api/queries/import`.
- `QuerySidebar` renders queries grouped by category.
- `QueryEditor` with all metadata fields; save/update/delete.
- Built-in import on first launch (checks `builtin_imported` setting).
- **Done when:** Built-ins appear on first launch and are not re-imported on restart.
  Editing a built-in's description persists correctly.

### Phase 3 — Execution + Pagination
- `ponder.js` with offset-based and cursor-based pagination; all test cases pass.
- `POST /api/runs` with full variable resolution, error handling, size checks.
- Date conversion (local picker → query `date_format`).
- Raw JSON result displayed in UI after run (table in Phase 4).
- **Done when:** Running `myt_deposits` against the live endpoint returns all rows
  (not just first page). `page_count` reflects actual pages fetched.

### Phase 4 — Results Table + Chain Filter
- `ResultsTable` with virtualisation (react-virtual), sort, client-side filter.
- `ChainFilter` chip bar; auto-inferred from the field named by `chain_field` in rows.
- Column order: key field first, then insertion order. Numeric fields scaled by
  `field_meta.decimals`.
- **Done when:** MYT deposits shown in a table with correct WETH scaling, filterable
  by chain.

### Phase 5 — Charts + PNG Export
- `ResultsChart` with Recharts; X/Y field selection; chart type selection.
- Chain grouping: stacked bars or overlaid series.
- "Export PNG" using `html-to-image`.
- **Done when:** Bar chart of assets-by-chain renders correctly and downloads as PNG.

### Phase 6 — Run History + CompareView
- `GET /api/runs?query_id=N` route.
- `HistoryDrawer` lists past runs; click loads into results without re-fetch.
- `CompareView`: side-by-side tables with delta columns; rows matched by `key_field`.
- Chart overlay: both runs as series on same chart.
- **Done when:** Can load Q1 run and Q2 run and see which chains grew or shrank.

### Phase 7 — Export (JSON, CSV, ZIP)
- `export.js` with flattening + decimal scaling + timestamp formatting.
- All three export routes.
- `ExportButtons` in UI.
- `export.test.js` passing all edge cases.
- **Done when:** CSV of MYT deposits has correct decimal-scaled `assets` column and
  human-readable timestamps.

### Phase 8 — Reports
- All `reports` and `report_runs` routes.
- `ReportBuilder` — add/remove/reorder queries.
- "Run All" in top bar; per-query status shown; continues on failure.
- ZIP export of a report run.
- **Done when:** "Q2 2026" report runs all three built-in queries, shows one failure
  gracefully, produces a ZIP with two CSVs.

### Phase 9 — Tests + Polish
- All backend test files passing.
- Error states: endpoint unreachable, GraphQL syntax error, timeout, size limit
  exceeded (auto-saved with warning banner; no confirmation step).
- Loading spinners + "Cancel" button with the following full lifecycle:
  1. Frontend calls `AbortController.abort()`, which cancels the active `fetch` to the
     backend `/api/runs` endpoint immediately (mid-page if a fetch is in flight).
  2. The backend detects the aborted request (`req.signal.aborted` / `close` event)
     and aborts the outbound `node-fetch` to the Ponder endpoint via its own
     `AbortController`.
  3. All in-memory rows accumulated so far are discarded.
  4. No run row is written to SQLite.
  5. The API returns HTTP 200 with `{ "cancelled": true, "rows": null, "row_count": 0 }`.
  6. The frontend shows "Cancelled" state; no error banner.
- Large result warning banner.
- **Done when:** All tests pass; all error states display helpful messages; cancel
  works mid-pagination.

---

## Limits and Behaviour Table

| Limit | Default | Configurable | Behaviour when exceeded |
|---|---|---|---|
| Page size | 1,000 rows | `settings.page_size` | n/a (just a param) |
| Per-page timeout | 30 s | `settings.timeout_per_page_ms` | Abort; `error_type: "timeout"` |
| Total max pages | 50 | `settings.max_page_count` | Abort; `error_type: "page_limit"` |
| Total max rows | 50,000 | `settings.max_row_count` | Abort; `error_type: "row_limit"` |
| Warn at result size | 1 MB | `settings.warn_bytes` | Auto-saved; `warnings` populated; UI banner |
| Hard result size | 10 MB | `settings.max_bytes` | Abort; HTTP 413; not saved |
| Run All: query failure | — | — | Continue to next query; status = "failed" |
| Cancel (user) | — | — | AbortController; no partial save |

---

## Testing

All backend tests use **Jest + Supertest**. Tests live in `backend/tests/`.
Run with `npm test` from the root workspace.

### `validateEndpoint.test.js`

Tests for `middleware/validateEndpoint.js`:

| # | Input | Expected |
|---|---|---|
| 1 | `http://127.0.0.1:8790` | Pass (loopback HTTP) |
| 2 | `http://localhost:4000` | Pass (loopback HTTP) |
| 3 | `http://192.168.1.1` | 400 `invalid_endpoint` |
| 4 | `http://10.0.0.1` | 400 (private HTTP, not loopback) |
| 5 | `https://api.example.com` | Pass (public HTTPS) |
| 6 | `https://10.0.0.1` | 400 (private HTTPS) |
| 7 | `https://172.16.5.5` | 400 |
| 8 | `https://192.168.0.1` | 400 |
| 9 | `https://169.254.1.1` | 400 (link-local) |
| 10 | `ftp://example.com` | 400 (bad scheme) |
| 11 | `https://user:pass@example.com` | 400 (credentials in URL) |
| 12 | `https://example.com:22` | 400 (blocked port) |
| 13 | `not-a-url` | 400 (parse failure) |
| 14 | Hostname resolving to private IP | 400 (DNS rebinding) |

The DNS rebinding test mocks `dns.promises.lookup` to return `10.0.0.1` for an
otherwise-valid hostname.

### `ponder.test.js`

Tests for `ponder.js` pagination logic. Uses a mock HTTP server (nock or MSW).

| # | Scenario | Expected |
|---|---|---|
| 1 | Offset: 2500 rows at page_size 1000 | 3 pages, 2500 rows |
| 2 | Offset: exactly 1000 rows (one full page) | 2 pages (second returns 0), 1000 rows |
| 3 | Offset: 0 rows (empty result) | 1 page, 0 rows |
| 4 | Cursor: 3 pages, hasNextPage true/true/false | 3 pages, all rows concatenated |
| 5 | `result_path` resolves to non-array | Throws `path_error`; no rows |
| 6 | `result_path` missing in response | Throws `path_error` |
| 7 | `max_page_count` = 2, 3 pages available | Throws `page_limit` after page 2 |
| 8 | `max_row_count` = 1500, 2000 rows | Throws `row_limit` after crossing threshold |
| 9 | Network timeout on page 2 | Throws `timeout`; partial rows NOT returned |
| 10 | GraphQL `errors` array, no `data` | Throws `graphql` |
| 11 | GraphQL both `data` and `errors` | Returns rows with `error_type: "graphql_partial"` |
| 12 | Response size > warn_bytes (1 MB) | Returns rows + `warnings` entry |
| 13 | Response size > max_bytes (10 MB) | Throws `size_limit` |
| 14 | `pagination_style: "none"` | Single request; no first/skip injected |
| 15 | variables_base excludes first/skip/after | Verified on captured request body |

### `queries.test.js`

Tests for `routes/queries.js` via Supertest:

- `GET /api/queries` returns empty array on fresh DB.
- `POST /api/queries` creates a query; missing `result_path` returns 400.
- `PUT /api/queries/:id` updates `gql`, `field_meta`, etc.
- `DELETE /api/queries/:id` cascades to runs.
- `POST /api/queries/import` with `is_builtin=1`: re-import does not overwrite existing row.
- `POST /api/queries/import` with `is_builtin=0`: re-import updates existing row.
- Creating a query with `pagination_style: "cursor"` and empty `cursor_path` returns 400.

### `runs.test.js`

Tests for `routes/runs.js` via Supertest (mock Ponder server):

- `POST /api/runs` with valid query → 200, run saved to DB, `rows` non-null.
- `POST /api/runs` with invalid `query_id` → 400 `invalid_query`.
- `POST /api/runs` when endpoint unreachable → 502 `network`, run not saved.
- `POST /api/runs` when GraphQL returns errors-only → 400 `graphql`, run not saved.
- `POST /api/runs` when result is 1.5 MB → 200, run saved, `warnings` non-empty.
- `POST /api/runs` when result is 11 MB → 413 `size_limit`, run not saved.
- `GET /api/runs?query_id=N` returns runs newest-first.
- `GET /api/runs/:id` includes `rows` array.
- `DELETE /api/runs/:id` removes from DB; subsequent GET returns 404.
- `variables_base` stored in run record excludes pagination variables.

### `export.test.js`

Unit tests for `export.js` (no HTTP — call functions directly):

**CSV flattening:**
- Flat row: all scalars appear as columns.
- Nested object: `token.symbol` → column `token_symbol`; depth > 3 → JSON string.
- Nested array: produces multiple CSV rows; parent scalars repeated.
- Missing key in some rows → empty cell (no error).
- Column order: key field first, then insertion order of first row.

**Decimal scaling (`scaledDecimal`):**
- `("1500000000000000000", 18)` → `"1.5"`.
- `("1000000000000000000", 18)` → `"1"` (no trailing `.0`).
- `("100", 18)` → `"0.0000000000000001"` (very small).
- `("0", 18)` → `"0"`.
- `("-500000000000000000", 18)` → `"-0.5"` (negative; abs used for fractional part).
- `("-1", 18)` → `"-0.000000000000000001"` (tiny negative; validates abs normalisation).
- `("1", 6)` → `"0.000001"` (leading zeros preserved).
- Large value (> 10^30) → correct string (no floating-point precision loss).

**Timestamp formatting:**
- `field_meta.type = "unix_seconds"` converts to ISO8601.
- Fields without `type` are left as-is.

### `settings.test.js`

- `GET /api/settings` returns all default keys.
- `PUT /api/settings` with valid key updates value.
- `PUT /api/settings` with unknown key returns 400.
- `GET /api/settings/ping` with valid endpoint and mock server returns `{ ok: true, latency_ms: N }`.
- `GET /api/settings/ping` with blocked endpoint returns `{ ok: false, error: "invalid_endpoint" }`.

### CompareView numeric normalization (frontend unit test — Vitest)

`src/components/CompareView.test.jsx`:

- Field with `decimals: 18` in `field_meta` → classified numeric.
- Field with `type: "unix_seconds"` in `field_meta` → not numeric; delta = `—`.
- Field value `"0xabc..."` (address string) that fails `parseFloat` → not numeric.
- Field value `"12345"` with no `field_meta` → numeric (parses as finite decimal).
- BigInt-string > `MAX_SAFE_INTEGER` with `decimals` set → numeric (scaled before compare).
- Row in run A but not run B → highlighted row; delta = `—`.

---

## Environment Variables

```
# backend/.env
PORT=8790

# frontend/.env (Vite)
VITE_API_BASE=http://localhost:8790
```

The Ponder endpoint URL is not an environment variable — it is stored in the SQLite
`settings` table and configured via the UI.

---

## Running the App

```bash
npm install          # root workspace (installs backend + frontend)
npm run dev          # starts both servers via concurrently
                     # backend: :8790 bound to 127.0.0.1
                     # frontend: :5173 proxies /api → :8790
npm test             # runs backend Jest tests
```
