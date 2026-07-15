# quarterly — Full Project Context

This document is the authoritative technical reference for the **quarterly** project. It covers every file, implementation pattern, data flow, schema, API shape, component contract, and design decision in the codebase. Intended for developers and AI assistants picking up this project cold.

---

## Table of Contents

1. [Project Purpose](#1-project-purpose)
2. [Repository Layout](#2-repository-layout)
3. [Tech Stack](#3-tech-stack)
4. [Running the Project](#4-running-the-project)
5. [Database Schema](#5-database-schema)
6. [Migration System](#6-migration-system)
7. [Backend — Core Modules](#7-backend--core-modules)
8. [Backend — All Routes](#8-backend--all-routes)
9. [Frontend — App.jsx State & Data Flow](#9-frontend--appjsx-state--data-flow)
10. [Frontend — Component Contracts](#10-frontend--component-contracts)
11. [Frontend API Client](#11-frontend-api-client)
12. [Key Implementation Details](#12-key-implementation-details)
13. [Testing](#13-testing)
14. [CSS / Theme Variables](#14-css--theme-variables)
15. [Deployment Notes](#15-deployment-notes)
16. [Future / Maybe](#16-future--maybe)

---

## 1. Project Purpose

**quarterly** is a localhost-only web dashboard for running and comparing GraphQL queries against a [Ponder](https://ponder.sh/) blockchain indexing endpoint. It was built for Alchemix v3 on-chain quarterly reporting but works with any Ponder-compatible API.

Core loop:
1. User pastes a Ponder endpoint URL
2. User picks a date range
3. User runs a named query → results saved to SQLite
4. User compares runs across quarters or exports to CSV/ZIP

All data lives locally in a single SQLite file. There is no cloud component.

---

## 2. Repository Layout

```
quarterly/                          npm workspace root
├── package.json                    workspace config; `npm run dev` and `npm test`
├── README.md                       user-facing documentation
├── PLAN.md                         original implementation spec (historical)
├── context/
│   └── project-context.md          ← this file
├── backend/
│   ├── package.json                name: quarterly-backend, version: 1.0.0
│   ├── src/
│   │   ├── server.js               Express entry point, binds 127.0.0.1:8790
│   │   ├── db.js                   SQLite init + migration runner
│   │   ├── ponder.js               GraphQL fetch + auto-pagination engine
│   │   ├── export.js               JSON/CSV/ZIP serialisation helpers
│   │   ├── middleware/
│   │   │   └── validateEndpoint.js SSRF protection middleware
│   │   ├── migrations/
│   │   │   ├── 001_initial.js      baseline schema (all core tables + settings defaults)
│   │   │   ├── 002_address_labels.js  address_labels table
│   │   │   ├── 003_chart_views.js  ALTER queries ADD COLUMN chart_views
│   │   │   ├── 004_endpoints_and_run_notes.js  endpoints table + runs.notes column
│   │   │   ├── 005_computed_columns.js  ALTER queries ADD COLUMN computed_columns
│   │   │   ├── 006_timestamp_extraction.js  ALTER queries ADD COLUMN timestamp_extraction
│   │   │   ├── 007_color_schemes.js  color_schemes table + seed Default/Warm/Cool/Pastel
│   │   │   ├── 008_color_scheme_theme.js  ALTER color_schemes ADD COLUMN theme
│   │   │   ├── 009_report_instances.js  report_instances table + ALTER reports ADD COLUMN updated_at
│   │   │   └── 010_report_config.js  ALTER reports ADD COLUMN config
│   │   └── routes/
│   │       ├── settings.js
│   │       ├── queries.js
│   │       ├── runs.js
│   │       ├── reports.js
│   │       ├── export.js
│   │       ├── introspect.js
│   │       ├── proxy.js
│   │       ├── addressLabels.js
│   │       ├── colorSchemes.js
│   │       ├── transfer.js
│   │       └── endpoints.js
│   ├── data/
│   │   └── quarterly.db            SQLite database (gitignored)
│   └── tests/
│       ├── validateEndpoint.test.js
│       ├── ponder.test.js
│       ├── export.test.js
│       ├── queries.test.js
│       ├── runs.test.js
│       ├── settings.test.js
│       ├── colorSchemes.test.js
│       ├── endpoints.test.js
│       ├── reports.test.js
│       ├── addressLabels.test.js
│       └── date_filtering.test.js
├── frontend/
│   ├── package.json                name: quarterly-frontend, version: 1.0.0
│   ├── index.html                  SPA entry; loads 10 Google Fonts via one combined CSS URL
│   ├── vite.config.js              dev proxy /api → http://127.0.0.1:8790
│   ├── vitest.config.js            jsdom environment, @testing-library/jest-dom setup
│   └── src/
│       ├── main.jsx                ReactDOM.createRoot mount
│       ├── App.jsx                 root component, all top-level state
│       ├── api/
│       │   └── client.js           all fetch helpers (named exports)
│       ├── utils/
│       │   ├── addressLabels.js    buildAddressMap / resolveAddress utilities
│       │   ├── computedColumns.js  applyComputedColumns / computedFieldMeta / custom arithmetic parser
│       │   ├── timestampExtraction.js  applyTimestampExtraction / timestampExtractionMeta
│       │   ├── mergeDatasets.js    mergeDatasets / formatXLabel — union-join for MultiQueryChart
│       │   ├── chartDataUtils.js   buildChartData / makeAxisName / bucketTimestamp — chart helpers for ReportInstanceCard
│       │   └── __tests__/
│       │       ├── computedColumns.test.js   (115 tests)
│       │       ├── timestampExtraction.test.js  (25 tests)
│       │       ├── mergeDatasets.test.js     (38 tests)
│       │       └── chartDataUtils.test.js    (56 tests)
│       └── components/             27 components (see §10)
│           ├── __tests__/          15 Vitest test files
│           └── ...
└── queries/
    └── builtin/
        ├── myt_deposits.json
        ├── alchemist_deposits.json
        └── user_counts.json
```

---

## 3. Tech Stack

### Backend

| Library | Version | Role |
|---|---|---|
| Node.js | 22+ | runtime |
| Express | 4.22.2 | HTTP server |
| better-sqlite3 | 12.11.2 | SQLite driver (native C++ addon) |
| csv-stringify | 6.8.1 | CSV generation |
| archiver | 8.0.0 | ZIP creation |
| ipaddr.js | 2.4.0 | IP range classification for SSRF protection |
| Jest | 29.7.0 | test runner |
| supertest | 7.2.2 | HTTP test assertions |

**Note:** `node-fetch` was removed in commit `d4046e9` — Node 22's built-in global `fetch` is used throughout. `nock` was also removed; all backend tests mock HTTP via `jest.fn()` on `global.fetch` instead.

### Frontend

| Library | Version | Role |
|---|---|---|
| React | 18.3.1 | UI framework |
| Vite | 6.4.3 | build tool + dev server |
| ECharts | 5.6.0 | charts |
| @uiw/react-codemirror | 4.25.11 | GraphQL code editor |
| @codemirror/lang-javascript | 6.2.5 | syntax highlighting |
| @tanstack/react-virtual | 3.13.24 | virtual scrolling for large tables |
| graphiql | 3.7.1 | embedded GraphQL explorer |
| @graphiql/plugin-explorer | 3.2.3 | field explorer plugin |
| react-datepicker | 9.1.0 | date pickers |
| expr-eval | 2.0.2 | safe arithmetic expression parser used internally (no eval/Function) — note: computed columns now use a custom built-in parser instead |
| @uiw/react-color | (pinned) | Sketch color picker for color scheme editor |
| Vitest | 4.1.10 | frontend test runner (upgraded from 3 to fix CVE-2026-47429) |
| @testing-library/react | 16.3.0 | component test helpers |
| @testing-library/jest-dom | 6.6.3 | DOM matchers |

---

## 4. Running the Project

### Dev mode (both servers)
```bash
npm run dev
# → backend on http://127.0.0.1:8790
# → frontend on http://localhost:5173
```

### Backend only
```bash
npm run dev --workspace=backend
# uses node --watch src/server.js
```

### Frontend only
```bash
npm run dev --workspace=frontend
# vite dev server with /api proxy to :8790
```

### Tests
```bash
npm test                          # backend Jest tests
npm test --workspace=frontend     # frontend Vitest tests
```

### Build frontend
```bash
npm run build --workspace=frontend
# outputs to frontend/dist/
```

---

## 5. Database Schema

Single SQLite file at `backend/data/quarterly.db`. WAL mode enabled. Foreign keys enforced.

### `settings`
```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```
Default rows (inserted by migration 001 if absent):

| key | default |
|---|---|
| endpoint | `` (empty) |
| warn_bytes | `1048576` |
| max_bytes | `10485760` |
| page_size | `1000` |
| max_page_count | `50` |
| max_row_count | `50000` |
| timeout_per_page_ms | `30000` |
| builtin_imported | `0` |

### `queries`
```sql
CREATE TABLE queries (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  category         TEXT    NOT NULL DEFAULT 'General',
  gql              TEXT    NOT NULL,
  variable_defs    TEXT    NOT NULL DEFAULT '[]',   -- JSON array
  result_path      TEXT    NOT NULL,                -- dotted path, e.g. "data.deposits"
  pagination_style TEXT    NOT NULL DEFAULT 'offset',
  cursor_path      TEXT    NOT NULL DEFAULT '',
  has_next_path    TEXT    NOT NULL DEFAULT '',
  date_format      TEXT    NOT NULL DEFAULT 'unix_seconds',
  chain_mode       TEXT    NOT NULL DEFAULT 'filter',
  chain_var_name   TEXT    NOT NULL DEFAULT 'chain',
  chain_field      TEXT    NOT NULL DEFAULT 'chain',
  field_meta         TEXT    NOT NULL DEFAULT '{}',   -- JSON object
  key_field          TEXT    NOT NULL DEFAULT 'id',
  is_builtin         INTEGER NOT NULL DEFAULT 0,
  chart_views          TEXT    NOT NULL DEFAULT '[]',   -- JSON array (added migration 003)
  computed_columns     TEXT    NOT NULL DEFAULT '[]',   -- JSON array (added migration 005)
  timestamp_extraction TEXT,                            -- JSON object or NULL (added migration 006)
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL
);
```

**JSON fields** (parsed by routes before returning to clients):
- `variable_defs` — array of `{ name, source, default?, type? }`
- `field_meta` — object of `{ [columnName]: { label?, decimals?, type?, unit? } }`
- `chart_views` — array of chart view snapshot objects
- `computed_columns` — array of `{ name, label, formula }` (added migration 005)
- `timestamp_extraction` — object `{ sourceField, delimiter, position, outputName, outputLabel }` or null (added migration 006)

**Validation rules (enforced in routes/queries.js):**
- `name`, `gql`, `result_path` are required
- `pagination_style` must be one of `offset`, `cursor`, `none`
- If `cursor`: `cursor_path` and `has_next_path` must be non-empty
- `variable_defs` must be a JSON array
- `field_meta` must be a JSON object
- `computed_columns` must be a JSON array (if provided)
- `timestamp_extraction` must be a JSON object or null (if provided)

### `runs`
```sql
CREATE TABLE runs (
  id             INTEGER PRIMARY KEY,
  query_id       INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  endpoint       TEXT    NOT NULL,
  start_date     TEXT,                  -- ISO 8601 or null
  end_date       TEXT,                  -- ISO 8601 or null
  variables_base TEXT    NOT NULL,      -- JSON object (user/date vars, no pagination)
  rows           TEXT,                  -- JSON array of row objects (null on error)
  row_count      INTEGER NOT NULL DEFAULT 0,
  page_count     INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  error_type     TEXT,                  -- null | 'graphql_partial' on saved runs
  error_message  TEXT,
  graphql_errors TEXT,                  -- JSON array or null
  warnings       TEXT,                  -- JSON array of strings
  notes          TEXT,                  -- free text, added migration 004
  ran_at         TEXT    NOT NULL       -- ISO 8601
);
CREATE INDEX idx_runs_query  ON runs(query_id, ran_at);
CREATE INDEX idx_runs_ran_at ON runs(ran_at);
```

**Save policy:** only runs with `error_type IS NULL` or `error_type = 'graphql_partial'` are saved to the DB. Network, timeout, size, and pure GraphQL errors return a response but are not persisted.

### `reports`
```sql
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  config      TEXT    DEFAULT NULL,    -- JSON: { theme: { palette, bg, bgAlpha, textColor, gridColor, axisColor, fontFamily } } (added migration 010)
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    DEFAULT NULL     -- added migration 009
);
```

### `report_instances`
```sql
CREATE TABLE report_instances (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  query_id   INTEGER NOT NULL REFERENCES queries(id),
  position   INTEGER NOT NULL DEFAULT 0,
  label      TEXT    NOT NULL DEFAULT '',
  config     TEXT    NOT NULL DEFAULT '{}',   -- JSON: full chart + filter config (see ReportInstanceCard)
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

**`config` JSON shape for `report_instances`:**
```js
{
  xField: string,
  leftFields: string[],
  rightFields: string[],
  leftType: 'line'|'bar'|'area',
  rightType: 'line'|'bar'|'area',
  groupBy: 'day'|'week'|'month'|'none',
  leftYMode: 'raw'|'cumulative',
  rightYMode: 'raw'|'cumulative',
  leftAggregation: 'sum'|'mean'|'median'|'min'|'max',
  rightAggregation: 'sum'|'mean'|'median'|'min'|'max',
  leftScaleY: bool,
  rightScaleY: bool,
  xSortDir: 'asc'|'desc',
  showLegend: bool,
  colDivisors: { [col]: 'raw'|'1e6'|'1e18'|'datetime' },
  seriesColors: { [col]: hex },   // per-series explicit overrides
  activeFilters: { [col]: string[] },
}
```

### `report_queries` *(legacy — kept for backward compat with old run history)*
```sql
CREATE TABLE report_queries (
  report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  query_id   INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (report_id, query_id)
);
```

### `report_runs` *(legacy — kept for backward compat)*
```sql
CREATE TABLE report_runs (
  id         INTEGER PRIMARY KEY,
  report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  start_date TEXT,
  end_date   TEXT,
  endpoint   TEXT    NOT NULL,
  ran_at     TEXT    NOT NULL
);
```

### `report_run_queries` *(legacy — kept for backward compat)*
```sql
CREATE TABLE report_run_queries (
  report_run_id INTEGER NOT NULL REFERENCES report_runs(id) ON DELETE CASCADE,
  query_id      INTEGER NOT NULL REFERENCES queries(id),
  run_id        INTEGER REFERENCES runs(id),
  status        TEXT    NOT NULL DEFAULT 'pending',  -- 'ok' | 'failed'
  error_message TEXT,
  PRIMARY KEY (report_run_id, query_id)
);
```

### `address_labels`
```sql
CREATE TABLE address_labels (
  id          INTEGER PRIMARY KEY,
  address     TEXT NOT NULL,
  chain       TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(address, chain)
);
CREATE INDEX idx_address_labels_address ON address_labels(address);
```

Uniqueness key is `(address, chain)`. A chain-agnostic entry uses `chain = ''`.

### `endpoints`
```sql
CREATE TABLE endpoints (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  url        TEXT    NOT NULL DEFAULT '',
  headers    TEXT    NOT NULL DEFAULT '{}',  -- JSON object
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
```

### `color_schemes`
```sql
CREATE TABLE color_schemes (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  colors     TEXT    NOT NULL,               -- JSON array of hex strings
  theme      TEXT    DEFAULT NULL,           -- JSON object or NULL (added migration 008)
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
```

**`colors`** — JSON array of hex color strings, e.g. `["#e94560","#2196f3","#4caf50","#ff9800"]`. Minimum 1, maximum 20 colors. Each must match `/^#[0-9a-fA-F]{6}$/`.

**`theme`** — optional JSON object for overriding chart chrome colors. When NULL, ECharts uses its built-in dark defaults. When set, has exactly these keys:
```json
{ "bg": "#1a1a2e", "textColor": "#c0c0c0", "gridColor": "#3a3a5a", "axisColor": "#5a5a8a" }
```
All four keys are optional within the object; any that are present must be valid 6-digit hex. The allowed keys are `bg`, `textColor`, `gridColor`, `axisColor`.

**`is_default`** — at most one row has `is_default = 1`. Enforced by clearing all rows before setting a new default. Built-in seeded schemes: Default, Warm, Cool, Pastel.

### `schema_version`
```sql
CREATE TABLE schema_version (
  version    INTEGER NOT NULL,
  applied_at TEXT    NOT NULL
);
```

Used by the migration runner. Tracks the highest applied migration number.

---

## 6. Migration System

**File:** `backend/src/db.js`

- On startup, reads `MAX(version)` from `schema_version`
- Scans `src/migrations/` for files matching `/^\d{3}_.*\.js$/`, sorted ascending
- Applies any migration with `versionNum > currentVersion` in a transaction
- Each migration exports `{ up(db) }` — a synchronous function that runs SQL against the db instance
- Applied migrations are never rolled back

**Current migrations:**

| File | Version | Change |
|---|---|---|
| `001_initial.js` | 1 | Baseline schema — all core tables + settings defaults |
| `002_address_labels.js` | 2 | `address_labels` table |
| `003_chart_views.js` | 3 | `ALTER queries ADD COLUMN chart_views` |
| `004_endpoints_and_run_notes.js` | 4 | `endpoints` table + `runs.notes` column |
| `005_computed_columns.js` | 5 | `ALTER queries ADD COLUMN computed_columns` |
| `006_timestamp_extraction.js` | 6 | `ALTER queries ADD COLUMN timestamp_extraction` |
| `007_color_schemes.js` | 7 | `color_schemes` table + seed built-in schemes (Default, Warm, Cool, Pastel) |
| `008_color_scheme_theme.js` | 8 | `ALTER color_schemes ADD COLUMN theme TEXT DEFAULT NULL` |
| `009_report_instances.js` | 9 | `report_instances` table + `ALTER reports ADD COLUMN updated_at TEXT DEFAULT NULL` |
| `010_report_config.js` | 10 | `ALTER reports ADD COLUMN config TEXT DEFAULT NULL` |

**Adding a migration:** create `backend/src/migrations/011_my_change.js` with `module.exports = { up(db) { db.exec('...') } }`. It runs automatically on next server start.

---

## 7. Backend — Core Modules

### `server.js`

- Creates Express app with `express.json({ limit: '50mb' })`
- Registers all 10 route modules on `/api/*`
- Binds to `127.0.0.1:PORT` (PORT default 8790, overridable via env)
- Global error handler → `{ error: 'server_error', message }`
- Health check: `GET /api/health` → `{ ok: true, version: '1.0.0' }`
- Exports `{ app, server }` for test usage

### `db.js`

- Opens SQLite at `backend/data/quarterly.db` (creates directory if missing)
- Sets `journal_mode = WAL` and `foreign_keys = ON` as first pragmas
- Runs migration system (see §6)
- Exports the db instance (singleton — all route modules receive it as a function argument)

### `ponder.js`

The core pagination engine. Exports `{ fetchAllPages, normalizeRows, getPath }`.

#### `getPath(obj, dotPath)`
Traverses a nested object by dotted string path. Returns `undefined` on any missing node.

#### `normalizeRows(rows)`
Computes the union of all keys across every row, then pads missing keys with `null`. Ensures all rows have identical column sets.

#### `injectPaginationArgs(query, limit, offset)`
String-manipulates a GraphQL query string to inject `limit: N offset: M` into the first field's argument block. Does paren-depth counting so nested args (e.g. `where: { chain: "mainnet" }`) are handled correctly. Strips pre-existing `limit:` / `offset:` args first.

#### `fetchAllPages(endpoint, query, variables, queryDef, settings, signal)`

Main entrypoint. Returns:
```js
{
  rows,           // array of row objects, or null on fatal error
  page_count,
  duration_ms,
  warnings,       // array of strings
  error_type,     // null | 'network' | 'timeout' | 'cancelled' | 'graphql' |
                  //        'graphql_partial' | 'path_error' | 'size_limit' |
                  //        'row_limit' | 'page_limit' | 'invalid_query'
  error_message,
  graphql_errors, // array or null
}
```

**Pagination flow:**

- **`none`**: single fetch, no `first`/`skip` injection
- **`offset`**: calls `injectPaginationArgs(query, pageSize, skip)` per page; stops when `rows.length < pageSize`
- **`cursor`**: injects `{ first: pageSize, after: cursor }` as variables; reads `hasNextPage` via `has_next_path` and next cursor via `cursor_path`

**Error semantics:**
- `graphql` — errors array only, no data → not saved
- `graphql_partial` — errors + data together → rows saved, error recorded
- `network` / `timeout` / `cancelled` — not saved
- `size_limit` / `row_limit` / `page_limit` — not saved

**Per-page timeout:** creates an `AbortController` per page fetch with `setTimeout(timeoutPerPage)`. Combined with user-provided signal via event listener. `clearTimeout` called in a `finally` block.

**Native fetch timeout pattern** (used in `introspect.js` and `settings.js` ping route — node-fetch's proprietary `timeout` option is gone):
```js
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(), timeoutMs);
try {
  const response = await fetch(endpoint, { ..., signal: abort.signal });
  // handle response
} catch (e) {
  if (e.name === 'AbortError') { /* handle timeout */ }
  // handle other network errors
} finally {
  clearTimeout(timer);
}
```

### `export.js`

- **`toJson(rows)`** — `JSON.stringify(rows, null, 2)`
- **`toCsv(rows, fieldMeta, keyField)`** — uses `csv-stringify`. Column order: key field first, then insertion order. Applies decimal scaling (same BigInt logic as frontend `applyDivisor`). Prefixes values starting with `=`, `+`, `-`, `@` with `'` (formula injection protection).
- **`toZip(entries)`** — uses `archiver` to stream a zip file. Each entry is `{ name, content }`.

### `middleware/validateEndpoint.js`

Used as route-level middleware on `POST /api/runs` and `POST /api/proxy`.

Validation steps:
1. Parse URL — reject on invalid syntax
2. Reject credentials in URL (`url.username` / `url.password`)
3. Reject blocked ports: 22, 25, 465, 587
4. `http:` allowed only for loopback hostnames (`localhost`, `127.0.0.1`, `::1`)
5. `https:`: resolve hostname with `dns.lookup({ all: true })`, check every A/AAAA record against ipaddr.js private range classification
6. Reject private, loopback, link-local, and ULA IPv6 addresses for `https:`
7. Set `req.validatedEndpoint = url.href` on success

---

## 8. Backend — All Routes

Every route module is a factory function: `module.exports = (db) => router`. Routes receive the db singleton.

### `GET /api/settings`
Returns all rows from `settings` as `{ data: { key: value, ... } }`.

### `PUT /api/settings`
Accepts a partial object. Whitelisted keys: `endpoint`, `warn_bytes`, `max_bytes`, `page_size`, `max_page_count`, `max_row_count`, `timeout_per_page_ms`, `builtin_imported`. Unknown keys silently ignored. Uses `INSERT OR REPLACE`. Returns `{ ok: true, data: { ...all settings } }`.

### `GET /api/settings/ping`
Reads `endpoint` from settings. POSTs `{ query: '{ __typename }' }` to it (5s timeout). Returns `{ ok: true, latency_ms: N }` or `{ ok: false, error: '...' }`.

---

### `GET /api/queries`
Returns all queries. JSON fields (`variable_defs`, `field_meta`, `chart_views`, `computed_columns`, `timestamp_extraction`) are parsed before returning. Returns `{ data: [...] }`.

### `GET /api/queries/:id`
Single query with parsed JSON fields. Returns `{ data: query }` or `{ error: 'not_found' }` (404).

### `POST /api/queries`
Validates required fields. Inserts. Returns `{ data: newQuery }` (201). JSON fields stored as strings, returned parsed.

### `PUT /api/queries/:id`
Merges body over existing record. Re-validates. Returns `{ data: updatedQuery }`.

### `DELETE /api/queries/:id`
Cascades to `runs`. Returns 204. 404 if not found.

### `POST /api/queries/import`
Body: array of query objects. For each:
- If `is_builtin: true` → skip if a query with the same name already exists (preserves user edits)
- Otherwise → upsert by name (INSERT OR REPLACE)

Returns `{ data: { imported: N } }`.

---

### `POST /api/runs`

Body:
```json
{
  "query_id": 1,
  "start_date": "2026-01-01T00:00:00.000Z",   // optional
  "end_date":   "2026-03-31T23:59:59.999Z"    // optional
}
```

Flow:
1. Load query from DB → 400 `invalid_query` if not found
2. Load all settings (endpoint, limits)
3. Resolve variables from `variable_defs`:
   - `global_start` / `global_end` → format `start_date`/`end_date` per `date_format` (`unix_seconds`, `unix_ms`, `iso8601`)
   - `user` / `none` → use `default` field value
   - Pagination sources skipped (managed by ponder.js)
4. Build `variables_base` (user-visible vars, no pagination vars)
5. Auto-inject timestamp filter if no date variables and `start_date`/`end_date` provided:
   - Adds `WHERE timestamp >= $start AND timestamp <= $end` equivalent via `autoInjectDateFilter.js`
   - If injection fails, retries without injection and adds a warning
6. Call `fetchAllPages(endpoint, gql, vars, queryDef, settings, signal)`
7. Save run if `error_type` is null or `graphql_partial`
8. Update `queries.last_run_at` and `queries.last_row_count` on success
9. Return run record (always, even on error, with `id: null` if not saved)

**Response shape:**
```json
{
  "id": 42,
  "query_id": 1,
  "endpoint": "https://...",
  "start_date": "...",
  "end_date": "...",
  "variables_base": { "filter": "active" },
  "rows": [ { "id": "1", ... }, ... ],
  "row_count": 100,
  "page_count": 1,
  "duration_ms": 340,
  "error_type": null,
  "error_message": null,
  "graphql_errors": null,
  "warnings": [],
  "notes": null,
  "ran_at": "2026-05-20T19:00:00.000Z"
}
```

### `GET /api/runs?query_id=N&limit=20&offset=0`
Lists runs for a query, newest first. Excludes `rows` column. Returns `{ data: [...] }`.

### `GET /api/runs/:id`
Single run including full `rows` array (parsed from JSON string). Returns `{ data: run }`.

### `PATCH /api/runs/:id`
Body: `{ notes: string | null }`. Validates `notes` is a string or null (not a number, etc. → 400 `validation_error`). Updates DB. Returns `{ ok: true }` or 404 `not_found`.

### `DELETE /api/runs/:id`
Returns 204. 404 if not found.

---

### `GET /api/reports`
Returns all reports ordered by name. `config` is JSON-parsed. Returns `{ data: [...] }`.

### `POST /api/reports`
Body: `{ name, description?, config? }`. `name` required. `config` is stored as `JSON.stringify(config)` if provided. Returns the new report object with `instances: []` (201).

### `GET /api/reports/:id`
Returns report + all its instances. `config` parsed on report; each instance has its `config` JSON-parsed and a `query` sub-object with the full query definition (parsed JSON fields). Returns the report object with `instances` array.

**Instance shape:**
```js
{
  id, report_id, query_id, position, label, created_at,
  config: { xField, leftFields, rightFields, ..., colDivisors, seriesColors, activeFilters },
  query: { id, name, category, field_meta, variable_defs, gql, result_path, ... }
}
```

### `PUT /api/reports/:id`
Body: `{ name?, description?, config? }`. Updates report metadata. If `config` is present, it overwrites the existing config; if omitted, existing config is preserved. Returns the updated report row (without instances). 404 if not found.

### `DELETE /api/reports/:id`
Returns 204. 404 if not found. Cascade-deletes `report_instances`.

### `POST /api/reports/:id/instances`
Body: `{ query_id, label?, config?, position? }`. `query_id` required; must reference existing query (400 if not). `position` auto-assigned (MAX+1) if omitted. Returns 201 with the new `report_instances` row (config JSON-parsed).

### `PUT /api/reports/:id/instances/:iid`
Body: `{ label?, config?, position? }`. Partial update — omitted fields preserve existing values. Returns updated instance (config JSON-parsed).

### `DELETE /api/reports/:id/instances/:iid`
Returns 204. 404 if not found or doesn't belong to the report.

### `PUT /api/reports/:id/instances` *(bulk save)*
Body: `{ instances: [{ query_id, label?, config?, position? }] }`. Replaces ALL instances for the report in a single transaction: deletes existing, inserts new. Validates all `query_id`s before starting the transaction (400 if any missing). Updates `reports.updated_at`. Returns the new instances array (config JSON-parsed).

### `GET /api/reports/:id/runs` *(legacy)*
Lists `report_runs` for a report. Kept for backward compat.

### `GET /api/reports/runs/:report_run_id` *(legacy)*
Returns a single `report_run` with per-query status from `report_run_queries`.

### `POST /api/reports/:id/run` *(legacy)*
Runs all queries in a report and saves the results. Uses `report_instances` if present, falls back to `report_queries` for old reports. Kept for backward compat.

---

### `GET /api/address-labels`
Returns all labels. Returns `{ data: [...] }`.

### `GET /api/address-labels/:id`
Single label. 404 if not found.

### `POST /api/address-labels`
Body: `{ address, name, chain?, notes? }`. `address` and `name` required. UNIQUE constraint on `(address, chain)`. Returns `{ data: newLabel }` (201).

### `PUT /api/address-labels/:id`
Updates all fields. Returns `{ data: updatedLabel }`.

### `DELETE /api/address-labels/:id`
Returns 204.

---

### `GET /api/endpoints`
Returns all saved profiles. `headers` field is JSON-parsed before returning.

### `GET /api/endpoints/:id`
Single profile.

### `POST /api/endpoints`
Body: `{ name, url?, headers? }`. `name` required. Returns `{ data: newEndpoint }` (201).

### `PUT /api/endpoints/:id`
Updates profile. If `is_default: true` is in the body, clears `is_default` on all other rows first, then sets it on this one. Returns `{ data: updatedEndpoint }`.

### `DELETE /api/endpoints/:id`
Returns 204.

---

### `GET /api/color-schemes`
Returns all color schemes. `colors` and `theme` fields are JSON-parsed before returning. Returns `{ data: [...] }`. Schemes are ordered by `id`.

### `POST /api/color-schemes`
Body: `{ name, colors, theme? }`.
- `name` required, max 100 chars
- `colors` must be a JSON array of 1–20 valid 6-digit hex strings (e.g. `"#4caf50"`)
- `theme` optional; if present and non-null, must be an object with only allowed keys (`bg`, `textColor`, `gridColor`, `axisColor`), each a valid 6-digit hex string. Null explicitly stored as NULL.

Returns `{ data: newScheme }` (201). 400 on validation error.

### `PUT /api/color-schemes/:id`
Same body as POST. `theme` handling:
- If `theme` is explicitly `null` in the body → clears existing theme (stores NULL)
- If `theme` is omitted from the body entirely → preserves existing theme
- If `theme` is an object → validates and stores

Returns `{ data: updatedScheme }`. 404 if not found.

### `DELETE /api/color-schemes/:id`
Returns 204. 404 if not found. Cannot delete the default scheme (400 `cannot_delete_default`).

### `POST /api/color-schemes/:id/set-default`
Clears `is_default` on all rows, then sets it on the specified row. Returns `{ ok: true }`. 404 if not found.

---

### `POST /api/transfer/export`

Body:
```json
{
  "queryIds": [1, 2, 3],          // null = all queries
  "includeAddressLabels": true,
  "includeSettings": true
}
```

Returns a bundle object (not a file — frontend triggers download via Blob):
```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-05-20T12:00:00.000Z",
  "appVersion": "1.0.0",           // from backend/package.json version
  "queries": [ ...full query objects with parsed JSON fields... ],
  "addressLabels": [ { "address", "chain", "name", "notes" } ],
  "settings": { "endpoint": "...", "warn_bytes": "..." }
}
```

Settings exported: `endpoint`, `page_size`, `max_page_count`, `max_row_count`, `timeout_per_page_ms`, `warn_bytes`, `max_bytes`.

### `POST /api/transfer/preview`

Body: the raw bundle JSON.

Returns:
```json
{
  "queries": [
    { "name": "...", "status": "new"|"conflict", "existingId": 1|null, "isBuiltin": false }
  ],
  "addressLabels": [
    { "address": "0x...", "chain": "mainnet", "name": "...", "status": "new"|"conflict", "existingName": "..."|null }
  ],
  "settings": {
    "incoming": { "endpoint": "..." },
    "current":  { "endpoint": "..." }
  }
}
```

No writes.

### `POST /api/transfer/import`

Body:
```json
{
  "bundle": { ...full bundle... },
  "decisions": {
    "queries": [
      {
        "name": "...",
        "action": "overwrite"|"create_new"|"skip",
        "fields": ["gql", "variable_defs", "field_meta", "chart_views", "description", "category", "execution"]
      }
    ],
    "addressLabels": [
      { "address": "0x...", "chain": "mainnet", "action": "overwrite"|"skip" }
    ],
    "settings": ["endpoint", "warn_bytes"]
  }
}
```

Field group mappings for query overwrite:
- `"gql"` → updates `gql` column
- `"variable_defs"` → updates `variable_defs` column
- `"field_meta"` → updates `field_meta` column
- `"chart_views"` → updates `chart_views` column
- `"computed_columns"` → updates `computed_columns` column (display group)
- `"description"` → updates `description` column
- `"category"` → updates `category` column
- `"execution"` → updates `result_path`, `pagination_style`, `cursor_path`, `has_next_path`, `date_format`, `chain_mode`, `chain_var_name`, `chain_field`, `key_field`, `timestamp_extraction`

**`QUERY_EXPORT_FIELDS`** includes `computed_columns` and `timestamp_extraction` in addition to all other query fields.

**`QUERY_FIELD_GROUPS`** in the backend:
- display group: `field_meta`, `chart_views`, `computed_columns`
- execution group: `result_path`, `pagination_style`, `cursor_path`, `has_next_path`, `date_format`, `chain_mode`, `chain_var_name`, `chain_field`, `key_field`, `timestamp_extraction`

**Frontend `ImportExportModal` FIELD_GROUPS labels:**
- "Display (field labels, chart views, computed columns)"
- "Execution (pagination, chain, dates, timestamp extraction)"

`create_new`: inserts with name suffixed `" (imported)"`, increments to `" (imported 2)"` etc. until no conflict.

All operations in a single `db.transaction()`.

Returns: `{ queries: [{name, action, id}], addressLabels: [{address, chain, action}], settings: [key] }`

---

### `POST /api/introspect`

Body: `{ endpoint? }` (uses settings endpoint if not provided).

Posts the standard GraphQL introspection query. Returns simplified type map:
```json
{
  "data": {
    "Query": ["deposits", "users", ...],
    "Deposit": ["id", "amount", "timestamp", ...]
  }
}
```

### `POST /api/proxy`

Applies `validateEndpoint` middleware. Proxies the raw GraphQL POST body to the validated endpoint. Used by the SchemaExplorer (GraphiQL) component which cannot directly fetch due to CORS.

---

## 9. Frontend — App.jsx State & Data Flow

`App` is the single root component. All state lives here. Inner components receive only what they need via props.

### Module-level helpers

```js
function divisorsFromFieldMeta(fm) {
  // converts field_meta.decimals to colDivisors format
  // { assets: { decimals: 18 } } → { assets: '1e18' }
  // { usdc:   { decimals:  6 } } → { usdc:  '1e6'  }
}

function formatAge(ranAt, now) {
  // Returns human-readable age string: "just now", "5m ago", "2h ago", "3d ago"
  // Used for the staleness label on cached run results.
}
```

### State

| State | Type | Purpose |
|---|---|---|
| `startDate` | `Date \| null` | Global date range start |
| `endDate` | `Date \| null` | Global date range end |
| `selectedQuery` | `object \| null` | Currently loaded query definition (full object with parsed JSON fields) |
| `tab` | `string` | Active tab: `'editor'` \| `'results'` \| `'compare'` \| `'reports'` \| `'multi'` |
| `colDivisors` | `object` | `{ [colName]: 'raw' \| '1e6' \| '1e18' \| 'datetime' }` — lifted from ResultsView |
| `running` | `bool` | True while query is executing |
| `currentRun` | `object \| null` | Latest run result (rows + metadata) |
| `runError` | `object \| null` | Error from failed run |
| `historyOpen` | `bool` | Toggle run history drawer |
| `compareRuns` | `{ runA, runB } \| null` | Pinned runs for CompareView |
| `activeFilters` | `{ [field]: string[] }` | Active filter chip values |
| `sidebarRefresh` | `number` | Increment to trigger QuerySidebar refetch |
| `schemaExplorerOpen` | `bool` | Schema Explorer modal |
| `addressBookOpen` | `bool` | Address Book modal |
| `importExportOpen` | `bool` | Import/Export modal |
| `colorSchemes` | `array` | All color schemes, loaded on mount via `listColorSchemes()` |
| `colorSchemeId` | `number \| null` | ID of the user-selected color scheme (null = use default) |
| `queryPreviewOpen` | `bool` | Query Preview modal |
| `endpointProfilesOpen` | `bool` | Endpoint Profiles modal |
| `endpointVersion` | `number` | Incremented to force EndpointBar remount (re-reads endpoint from server) |
| `addressLabels` | `array` | All address labels, loaded on mount, passed to ResultsTable/ResultFilters |
| `prefillGql` | `string \| null` | GQL pre-populated from Schema Explorer "Use This Query" |
| `now` | `number` | `Date.now()` updated every 60 s via `setInterval`; used by staleness label |

### Key callbacks

**`handleSelectQuery(query)`** — sets `selectedQuery`, resets `currentRun`/`runError`/`activeFilters`, initialises `colDivisors` from `field_meta` via `divisorsFromFieldMeta`, then additionally sets `colDivisors[outputName] = 'datetime'` if `timestamp_extraction` is configured (so the extracted field renders as a date in `ResultsTable`). Switches tab to `'editor'`. Then silently auto-loads the most recent saved run via `listRuns(query.id, 1, 0)` + `getRun(id)` and sets `currentRun` if one exists.

**`handleNewQuery()`** — clears `selectedQuery`, `currentRun`, `runError`, `prefillGql`, `colDivisors`.

**`handleUseQuery(gql)`** — closes schema explorer, sets `prefillGql`, clears selected query.

**`handleSaveQuery(saved)`** — updates `selectedQuery` with server response, increments `sidebarRefresh`.

**`handleDeleteQuery()`** — clears `selectedQuery`/`currentRun`, increments `sidebarRefresh`.

**`handleCloneQuery(query)`** — calls `createQuery({ ...query, name: query.name + ' (copy)' })`, increments `sidebarRefresh`.

**`handleSelectEndpointProfile(profile)`** — calls `updateSettings({ endpoint: profile.url })`, increments `endpointVersion` to force EndpointBar remount.

**`handleSaveChartView(view)`** — merges view into `selectedQuery.chart_views` (upsert by name), calls `updateQuery`, updates `selectedQuery` state.

**`handleDivisorChange(newDivisors)`** — updates `colDivisors` state AND persists to `field_meta.decimals` via `updateQuery`. Mapping: `'1e6'` → `decimals: 6`, `'1e18'` → `decimals: 18`, `'raw'` → delete `decimals`. This is how divisors survive re-runs.

**`handleRun(queryDef)`** — creates `AbortController` (stored in `abortRef`), calls `createRun({ query_id, start_date, end_date }, signal)`, switches to `'results'` tab immediately.

**`handleCancel()`** — calls `abortRef.current.abort()`.

**`handleLoadRun(run)`** — sets `currentRun`, switches to `'results'` tab, closes history drawer.

**`handleCompare(runA, runB)`** — sets `compareRuns`, switches to `'compare'` tab.

### Computed values

**Data pipeline** (all useMemo):

```
currentRun.rows
  → extractedRows  (applyTimestampExtraction)
  → filteredRows   (date range filter using extracted timestamp field + chip filters)
  → computedRows   (applyComputedColumns)
```

**`extractedRows`** (useMemo) — runs `applyTimestampExtraction(currentRun.rows, selectedQuery.timestamp_extraction)`. When `timestamp_extraction` is null/undefined, returns `currentRun.rows` unchanged. When configured, parses a timestamp out of a source field and adds it as a new output field on every row.

**`filteredRows`** (useMemo) — filters `extractedRows` by:
1. `startDate` / `endDate` against the extracted timestamp field. The field name used is `selectedQuery?.timestamp_extraction?.outputName || 'timestamp'`. The extracted field is marked `datetime: true` in fieldMeta, so the filter applies date-comparison semantics.
2. `activeFilters` — AND of all active field chip values

**`computedRows`** (useMemo) — runs `applyComputedColumns(filteredRows, defs, colDivisors)` where `defs` comes from `selectedQuery.computed_columns`. Returns `filteredRows` unchanged when no defs. This is what gets passed to `ResultsView` as `rows`.

**`needsRerun`** (useMemo) — true if user has widened date pickers beyond what `currentRun` fetched. Only widening triggers it (narrowing is handled client-side by `filteredRows`).

**`fieldMeta`** (useMemo) — merges base query fieldMeta with timestamp extraction metadata and computed column metadata:
```js
fieldMeta = {
  ...selectedQuery.field_meta,                        // base
  ...timestampExtractionMeta(timestamp_extraction),   // extracted field (datetime: true)
  ...computedFieldMeta(computed_columns),             // computed fields (computed: true)
}
```
This ensures all synthesised columns get proper labels in `ResultsTable` headers and chart field selectors.

### Multi-Query Chart tab — lazy-mount pattern

```js
const multiMounted = useRef(false)
if (tab === 'multi') multiMounted.current = true
```

Once `multiMounted.current` is true, the `MultiQueryChart` wrapper div is always rendered (never unmounted). Visibility is toggled via `display: tab === 'multi' ? 'flex' : 'none'`. This preserves all component state (datasets, rows, series config, saved configs) across tab switches.

`MultiQueryChart` receives four props from App: `startDate`, `endDate`, `colorSchemes`, `addressLabels`.

### Modals and overlays

All modals are rendered at the App level and conditionally included:
- `EndpointProfilesModal` — `onSelect` calls `handleSelectEndpointProfile`; `onClose` closes modal
- `AddressBook` — `onLabelsChange` updates `addressLabels` state
- `ImportExportModal` — `onClose` closes modal AND increments `sidebarRefresh` (import may add queries)
- `SchemaExplorer` — `onUseQuery` calls `handleUseQuery`
- `QueryPreviewModal` — receives `currentRun` to display request details
- `HistoryDrawer` — always rendered (controls open/close via `open` prop)

### `ResultsView`

Extracted as a separate component file (`frontend/src/components/ResultsView.jsx`). See §10 for the full contract.

Manages a local `view` state (`'table'` | `'chart'`). Uses `display:none` toggling (not conditional rendering) to keep both `ResultsTable` and `ResultsChart` mounted simultaneously — this preserves chart ECharts instance state across tab switches.

---

## 10. Frontend — Component Contracts

### `EndpointBar`

```jsx
<EndpointBar
  key={endpointVersion}    // force remount on profile switch
  onExplore={fn}           // called when user clicks "Explore Schema"
/>
```

Internal state: `url`, `status` (`'idle'|'ok'|'error'`), `latency`. Loads endpoint from `GET /api/settings` on mount. Saves on blur/Enter via `PUT /api/settings`. Pings via `GET /api/settings/ping`. Shows coloured dot + latency. Shows "Explore Schema" button only when status is `'ok'`.

---

### `DateRangePicker`

```jsx
<DateRangePicker
  startDate={Date|null}
  endDate={Date|null}
  onStartChange={fn}
  onEndChange={fn}
/>
```

Renders two `react-datepicker` inputs. No internal state.

---

### `QuerySidebar`

```jsx
<QuerySidebar
  selectedQueryId={number|null}
  onSelectQuery={fn}         // called with full query object
  onNewQuery={fn}
  onCloneQuery={fn}          // called with full query object; default no-op
  refreshTrigger={number}    // increment to force refetch
/>
```

Internal state: `queries`, `loading`, `search`, `hoveredId`.

On mount: calls `getSettings()` to check `builtin_imported`. If `!== '1'`, fetches builtin JSON files from `/queries/builtin/*.json` and calls `importQueries(builtins)`, then `updateSettings({ builtin_imported: '1' })`. Then calls `listQueries()`.

Queries are grouped by `category` before rendering. Filtered by `search` (case-insensitive name match) before grouping.

Clone button: always in DOM, `visibility: hidden` when `hoveredId !== q.id`, `visibility: visible` on hover. This preserves layout (no shifts when button appears).

---

### `QueryEditor`

```jsx
<QueryEditor
  query={object|null}        // null = new query mode
  prefillGql={string|null}   // pre-fill GQL field
  onSave={fn}                // called with saved query object
  onDelete={fn}
  onRun={fn}                 // called with queryDef
  running={bool}
/>
```

Manages full query form state: `name`, `category`, `description`, `gql`, `variable_defs`, `field_meta`, `computed_columns`, `timestamp_extraction`, `result_path`, `pagination_style`, `cursor_path`, `has_next_path`, `date_format`, `chain_mode`, `chain_var_name`, `chain_field`, `key_field`.

Form sections (single scrollable layout, no inner tabs): name/category/key field row, description, result path / pagination / date format / chain mode row, cursor path / has-next path row (cursor only), CodeMirror GQL editor, `<VariablePanel>`, field metadata JSON textarea, `<ComputedColumnsEditor>`, "Parse Timestamp from Field" section.

**"Parse Timestamp from Field" section:** a checkbox enables/disables the feature. When enabled, shows 5 config fields: source field name, delimiter string, position (`'before'` | `'after'`), output field name, and output label. These map to `timestamp_extraction.sourceField`, `.delimiter`, `.position`, `.outputName`, `.outputLabel`. When the checkbox is unchecked, `timestamp_extraction` is set to null.

On save: `field_meta` is parsed from the JSON textarea text; `variable_defs`, `computed_columns`, and `timestamp_extraction` are JSON-stringified (or null) before sending to the backend.

Buttons: **▶ Run** (disabled if no `query.id`, no GQL, or no result_path), **Save / Create**, **Delete** (if existing).

---

### `VariablePanel`

```jsx
<VariablePanel
  variables={array}          // array of { name, source, default, type }
  onChange={fn}              // called with new array
/>
```

Renders an editable table of variable definitions. Sources: `global_start`, `global_end`, `user`, `none`, pagination sources.

---

### `ComputedColumnsEditor`

```jsx
<ComputedColumnsEditor
  defs={array}               // array of { name, label, formula }
  onChange={fn}              // called with new defs array
/>
```

Inline CRUD UI for computed column definitions. Shows existing columns in a list with Edit (✎), Delete (✕), Move Up (▲), and Move Down (▼) buttons. "Add Column" opens an inline form.

**Inline form fields:**
- `name` — identifier (required, `^[A-Za-z_][A-Za-z0-9_]*$`, unique, readonly when editing)
- `label` — display name (optional; falls back to `name` if empty)
- `formula` — arithmetic expression validated via `parseFormula` with live ✓ / ✗ indicator

**Validation on submit:** invalid formula → "Formula is invalid"; invalid name pattern → error showing regex requirement; duplicate name → "already exists" error.

**Available variables hint:** shows clickable chips for all known column names (from `defs`) plus previously-defined computed column names. Clicking a chip inserts it at cursor position in the formula textarea (future-placeholder for now, shown as clickable items that could be inserted).

**`onChange` is called with the full updated array** on every successful add, edit, delete, or reorder.

---

### `ResultsTable`

```jsx
<ResultsTable
  rows={array}               // displayed rows (already filtered)
  fieldMeta={object}         // { [col]: { label?, decimals?, type?, unit? } }
  keyField={string}          // default 'id'
  colDivisors={object}       // { [col]: 'raw'|'1e6'|'1e18'|'datetime' }
  onDivisorChange={fn}       // called with new colDivisors object
  addressLabels={array}      // for label resolution
/>
```

Internal state: `sortCol`, `sortDir`, `copiedAddr`, `searchText`, `hiddenCols`, `colPanelOpen`, `statsCol`, `copyMenuOpen`, `copyLabel`.

**Virtualisation:** renders as a flat DOM table for ≤500 rows; switches to `useVirtualizer` for >500.

**Column order:** key field first, then insertion order (from first row's keys union).

**Divisor cycle:** `DIVISOR_CYCLE = ['raw', '1e6', '1e18']`. Clicking a column's badge cycles forward. `onDivisorChange` is called with the full updated divisors object — `App` persists to `field_meta.decimals`.

**Stats bar:** `statCandidateCols` = visible numeric columns (excludes unix_seconds/unix_ms typed, excludes `timestamp` column name). `statsResult` uses `applyDivisor()` when a divisor is active (BigInt-safe). Picker is a `<select>`; no column selected → no stats shown. When a column is selected, displays: `Σ sum · avg mean · min min · max max · σ stddev` (population stddev, divides by N). The divisor label (e.g. `(1e18)`) is shown in muted text when a divisor is active.

**`applyDivisor(value, divisor)`:** BigInt arithmetic. Preserves full precision. Returns a decimal string (e.g. `"1.234567890123456789"`).

**Address resolution:** `buildAddressMap(addressLabels)` builds a `Map<address, Map<chain, name>>`. `resolveAddress(value, chain, map)` checks `ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/`, then looks up chain-specific then chain-agnostic label.

**Copy formats:** Markdown table, HTML table, TSV — all use `visibleColumns` and `displayRows` (post-search).

---

### `ResultsView`

```jsx
<ResultsView
  rows={array}               // computed rows (post-pipeline)
  fieldMeta={object}
  keyField={string}
  addressLabels={array}
  chartViews={array}
  onSaveView={fn}
  colDivisors={object}
  onDivisorChange={fn}
  colorSchemes={array}       // all available color schemes (from App state)
  colorSchemeId={number|null}
  onColorSchemeChange={fn}   // called with new scheme id
  onSchemesChange={fn}       // called after ColorSchemeManager modifies schemes
/>
```

Manages local `view` state (`'table'` | `'chart'`). Renders both `<ResultsTable>` and `<ResultsChart>` always in the DOM, toggling visibility with `display:none` so the ECharts instance stays mounted across Table↔Chart tab switches. "⚙ Schemes" button in the chart toolbar opens `<ColorSchemeManager>` as an overlay.

---

### `ResultsChart`

```jsx
<ResultsChart
  rows={array}
  fieldMeta={object}
  keyField={string}
  colDivisors={object}
  onDivisorChange={fn}
  chartViews={array}         // saved named views
  onSaveView={fn}            // async fn(view) → bool
  colorSchemes={array}       // all color scheme objects
  colorSchemeId={number|null}
  onColorSchemeChange={fn}   // called with new scheme id when user picks from dropdown
  onSchemesChange={fn}       // called after ColorSchemeManager modifies schemes list
/>
```

Manages chart config: `xField`, `leftFields`, `rightFields`, `leftType`, `rightType`, `groupBy`, `leftYMode`, `rightYMode`, `leftAggregation`, `rightAggregation`, `leftScaleY`, `rightScaleY`, `xSortDir`, `showLegend`, `seriesColors` (per-field hex overrides `{ [fieldName]: hex }`), `colorSchemeId` (ID of the last applied scheme, null = palette defaults). Also manages picker UI state: `pickerField`, `pickerColor`, `schemeManagerOpen`. Renders ECharts instance via `echarts.init`. Supports PNG download via `chart.getDataURL()`.

**Color scheme integration:**

```js
const activeScheme = useMemo(
  () => colorSchemes.find(s => s.id === colorSchemeId) ?? colorSchemes.find(s => s.is_default),
  [colorSchemes, colorSchemeId],
)
```

`paletteColors` (useMemo) is derived from `activeScheme?.colors ?? []`.

The `option` useMemo applies `activeScheme?.theme` to ECharts:
- `backgroundColor: t.bg ?? undefined`
- xAxis and both yAxis `axisLabel.color`, `nameTextStyle.color` → `t.textColor`
- Both yAxis `splitLine.lineStyle.color` → `t.gridColor`
- Both xAxis/yAxis `axisLine.lineStyle.color` → `t.axisColor`
- `legend.textStyle.color` → `t.textColor`

When `theme` is null or a key is absent, the corresponding ECharts property is `undefined`, falling through to the dark theme defaults.

**`isTimestampX`:** `xField === 'timestamp' || colDivisors[xField] === 'datetime'`. Controls visibility of the Group By selector, aggregation dropdowns, and x-axis sort control. When `isTimestampX` is false, these controls are hidden.

**Per-series aggregation:** When `groupBy !== 'none'` and `isTimestampX`, each y-axis shows an aggregation selector. Options: `sum`, `mean`, `median`, `min`, `max` (default `sum`). Rendered as "Left agg." and "Right agg." dropdowns next to the Group By selector. Left and right axes have independent aggregation state (`leftAggregation`, `rightAggregation`). Both are persisted in saved chart views. Disabled (greyed out) when `groupBy === 'none'`.

**X-axis sort:** `xSortDir` state (`'asc'` | `'desc'`, default `'asc'`). Shown as an "X Order" toggle button next to the aggregation controls. Only visible when `isTimestampX`. Persisted in saved chart views.

**Scale Y:** `leftScaleY` and `rightScaleY` boolean state (default `false`). Rendered as a checkbox in each YAxisSelector label row ("Scale Y"). When true, sets `scale: true` on the ECharts `yAxis` config, which fits the axis to the data range instead of starting at zero. Persisted in saved chart views.

**`buildChartData` refactor:** Uses a unified Map-group-then-aggregate pattern for all `groupBy` modes (including `'none'`). Collects values into arrays per `(bucket, field)`, then applies `aggregate(values, method)` to produce a single point value. The same `aggregate()` helper is used for all aggregation modes; `null` is returned for empty arrays, `Infinity`/`NaN`, and non-finite results (e.g., division by zero).

**`axisName(fields, fieldMeta, yMode)`:** builds the Y-axis name label by joining field labels with `, `. When `yMode === 'cumulative'`, prepends `"cumulative "` to the result (e.g. right Y-axis shows `"cumulative amountStaked"` when set to cumulative mode).

**`seriesColors` and per-series color picker:** each series badge in `YAxisSelector` is clickable and opens an `@uiw/react-color` Sketch picker inline. Explicit per-field colors are stored in `seriesColors` state. `applyScheme(scheme)` bulk-applies a color scheme's palette to all currently-configured fields. The active scheme colors are used as the fallback cycle (`paletteColors`) when no explicit override exists.

**Saved chart view fields:** `xField`, `leftFields`, `rightFields`, `leftType`, `rightType`, `groupBy`, `leftYMode`, `rightYMode`, `leftAggregation`, `rightAggregation`, `leftScaleY`, `rightScaleY`, `xSortDir`, `showLegend`, `colDivisors`, `seriesColors`, `colorSchemeId`.

---

### `ColorSchemeManager`

```jsx
<ColorSchemeManager
  onClose={fn}
  onSchemesChange={fn}       // called after any create/update/delete/set-default
/>
```

Full-screen modal (fixed overlay, backdrop click closes). Fetches all schemes on open via `listColorSchemes()`.

**List view:** each scheme row shows up to 8 color swatches (14×14 px each with hover tooltip `"Series N: #rrggbb"`), the scheme name (bold if default), a `default` badge, and action buttons: "Set default" (hidden for current default), "Edit", "Delete" (hidden for current default).

**`SchemeEditor`** (inline, replaces the list row when editing): contains:
- Name text input
- `PaletteEditor` — ordered swatches with Series 1/2/3… labels above each, × remove buttons, + add button. Each swatch opens an inline `@uiw/react-color` Sketch picker on click; picker closes on outside click.
- "Override chart appearance" checkbox (opt-in, unchecked by default for new schemes and for schemes with `theme: null`; pre-checked when scheme already has a theme)
- When checked: 4 `SwatchPicker` controls for Background, Text & labels, Grid lines, Axis lines — using `DARK_THEME_DEFAULTS` as initial values when newly enabling
- Save / Cancel buttons

`onSave(name, colors, useTheme ? theme : null)` — passes `null` for theme when checkbox unchecked.

**Validation:** name required, at least 1 color, all colors must be valid hex (enforced by the backend).

---

### `MultiQueryChart`

```jsx
<MultiQueryChart
  startDate={Date|null}      // from App date picker — passed to every createRun call
  endDate={Date|null}
  colorSchemes={array}       // all color scheme objects from App state
  addressLabels={array}      // for chip label resolution in ResultFilters
/>
```

Manages its own complete state — no state in App other than the four props above. Kept permanently mounted via the lazy-mount pattern (see §9) once the tab is first visited.

**Dataset state shape** (one entry per added query):
```js
{
  id: string,            // 'ds_<timestamp>' — stable key
  queryId: number,
  name: string,
  xField: string,        // column used as X axis (auto-detected on first run)
  groupBy: 'day'|'week'|'month'|'none',
  aggregation: 'sum'|'avg'|'median'|'min'|'max'|'count',
  yMode: 'raw'|'cumulative',
  colDivisors: object,   // { [col]: 'raw'|'1e6'|'1e18' }
  activeFilters: object, // { [col]: string[] } — per-dataset column-value filters
  status: null|'running'|'done'|'error',
  rows: array|null,
  rowCount: number,
  error: string|null,
  lastColumns: string[], // column names from most recent run (used before rows available)
}
```

**Series state shape** (one entry per chart series):
```js
{
  id: string,            // 's_<timestamp>'
  datasetIdx: number,    // which dataset this series reads from
  field: string,         // column name within that dataset
  label: string,         // display name (blank = auto from dataset+field)
  yAxis: 'left'|'right',
  type: 'line'|'bar'|'area',
  color: string,         // explicit hex override (blank = palette auto)
}
```

**Data flow:**
1. User adds datasets (selects saved query from dropdown)
2. User clicks Run per-dataset (or Run All) → `createRun` called with `start_date`/`end_date`
3. Per-dataset `activeFilters` applied to rows before groupBy bucketing
4. `mergeDatasets(mergeInputs)` union-joins all datasets on shared X-axis bucket keys
5. `echartsSeriesList` maps series config to ECharts series objects using `palette` colors
6. `<ECharts>` wrapper renders the chart

**`mergeInputs`** (useMemo) — maps each dataset to the shape `mergeDatasets` expects, pre-filtering rows by `activeFilters`.

**`palette`** (useMemo) — resolves `schemeId` against `colorSchemes` prop → falls back to `DEFAULT_PALETTE` (12 colors).

**LocalStorage persistence (`mqc_configs` key):**
- `saveConfig(name)` — serializes current state (strips `rows`, `status`, `rowCount`, `error` via `serializeDataset`), saves to localStorage array
- `loadConfig(name)` — restores datasets (rows set to null; user re-runs) + series + options + schemeId
- `deleteConfig(name)` — removes entry by name
- UI: "Save config" button (with inline name input), "Load config…" dropdown, "Delete…" dropdown

**Controls strip (top):** dataset picker dropdown, Run All button (when >1 dataset), "+ Add Series", color scheme picker (when `colorSchemes.length > 0`), Connect nulls checkbox, Legend checkbox, save/load/delete UI.

**`DatasetRow`** sub-component: shows dataset name + status; X/groupBy/aggregation/yMode selectors; divisor buttons (accent-colored when active, cycling raw→÷1e6→÷1e18 on click); `<ResultFilters>` chip UI (appears after run, filters applied before merge).

**`SeriesRow`** sub-component: color picker input; dataset selector; field selector (shows "— run dataset first —" when no columns); label text input; chart type selector; Y-axis selector; remove button.

**`ECharts`** wrapper: `useEffect` to `echarts.init(container, 'dark')`; `ResizeObserver` to call `chart.resize()`; `useEffect` to `setOption(option, { notMerge: true })` on option changes.

**Chart features:** dual Y-axis (left/right); data zoom (inside + slider); toolbox (zoom reset + PNG save); tooltip with color dots; `fmtAxisVal` compact formatter (K/M/B/T suffixes); `connectNulls` toggle; `showLegend` toggle; `xLabels` formatted via `formatXLabel(key, sharedGroupBy)`.

---

### `ResultFilters`

```jsx
<ResultFilters
  rows={array}               // unfiltered rows (currentRun.rows)
  activeFilters={object}     // { [field]: string[] }
  onChange={fn}              // called with new activeFilters
  addressLabels={array}
/>
```

Computes distinct values per column. Resolves address labels for display. Renders chip-style toggles. Used in both the **Results tab** (App-level) and **inside each `DatasetRow`** in MultiQueryChart (per-dataset filtering).

---

### `HistoryDrawer`

```jsx
<HistoryDrawer
  queryId={number|null}
  open={bool}
  onClose={fn}
  onLoadRun={fn}             // called with full run object (rows included)
  onCompare={fn}             // called with (runA, runB)
/>
```

Internal state: `runs`, `loading`, `pinnedRun`, `editingNoteId`, `noteText`, `savingNote`.

Fetches runs via `listRuns(queryId)` when `open` becomes true. Pin/Compare flow: first click sets `pinnedRun`; second click on any other run calls `onCompare(pinnedRun, thisRun)`.

Note editing: click note area → textarea appears with existing note text. "Save" calls `patchRun(id, { notes })`. "Cancel" discards. Note displayed with `white-space: pre-wrap`.

---

### `CompareView`

```jsx
<CompareView
  runA={object}              // run with rows
  runB={object}              // run with rows
  keyField={string}
  fieldMeta={object}
/>
```

Matches rows by `keyField`. For each numeric column, shows `valueA`, `valueB`, `Δ (abs)`, `Δ (%)`. Rows only in A or only in B are highlighted yellow.

---

### `ReportBuilder`

```jsx
<ReportBuilder
  report={object|null}       // null = create mode; object has .id, .name, .description, .config, .instances
  onSave={fn}                // called with saved report object
  onClose={fn}
  startDate={Date|null}      // forwarded to each ReportInstanceCard for preview runs
  endDate={Date|null}
  colorSchemes={array}       // all color scheme objects (from App)
  addressLabels={array}      // for chip label resolution in instance filters
/>
```

**State:**
- `name`, `description` — report metadata
- `instances` — array of instance state objects (see `ReportInstanceCard` section for config shape)
- `reportTheme` — current theme object (from `normaliseTheme(report?.config?.theme)`)
- `generating` — bool, true while PNG generation is running
- `themeEditorOpen` — bool, toggle for `ReportThemeEditor` panel

**Behaviour:**
- Uses `cardRefs` (`useRef({})`) to store `useImperativeHandle` refs keyed by `instance._tempId`. Each ref exposes a `generate()` method.
- Floating **Save** FAB (bottom-right) calls `handleSave`, which calls `createReport`/`updateReport` then `bulkSaveReportInstances`. Passed `config: { theme: reportTheme }` in both create and update.
- **Generate PNGs** button calls `handleGenerate`: iterates `cardRefs`, calls `ref.generate()` on each in sequence, collects `{ dataUrl, filename }` results, triggers individual `<a>.click()` downloads with 300 ms delay between them (no ZIP).
- `handleSave` does NOT trigger a reload/remount — it calls `onSave(saved)` which only updates the report reference in `ReportsPanel` (no `setLoading`).
- `ReportThemeEditor` is rendered as a collapsible panel above the instances list.
- Each `ReportInstanceCard` receives `reportTheme`, `startDate`, `endDate`, `addressLabels`.
- Color scheme selector: selects from `colorSchemes` prop; applying a scheme sets `reportTheme.palette` to the scheme's colors (merged via `normaliseTheme`).

**`defaultReportTheme()` (module-level helper):**
```js
{
  palette:    ['#e94560','#2196f3','#4caf50','#ff9800','#9c27b0','#00bcd4'],
  bg:         '#1a1f2e',
  bgAlpha:    100,          // 0–100 %
  textColor:  '#c0c0c0',
  gridColor:  '#333333',
  axisColor:  '#555555',
  fontFamily: 'Montserrat', // applied to all ECharts text (axes, legend, tooltip)
}
```

**`normaliseTheme(partial)`** — merges `partial` with `defaultReportTheme()` using `Object.assign`. Ensures all keys always have values even when loading a report that has no saved theme.

---

### `ReportThemeEditor`

```jsx
<ReportThemeEditor
  theme={object}             // current theme (normalised — all keys present)
  onChange={fn}              // called with new theme object on every change
/>
```

Collapsible panel (▼/▶ toggle). Header row shows palette preview swatches + Export/Import buttons (clicking header toggles open/close; clicking buttons does not toggle).

Controls (when open):
- **Series Colors** — `PaletteSwatch` sub-components, one per palette color. Each swatch has a `<input type="color">` picker + 52 px hex text input (for paste support) + × remove button. Add (+) button appends `#888888`. Minimum 1 color enforced.
- **Font** — `<select>` offering 10 Google Fonts: Montserrat (default), DM Sans, IBM Plex Sans, Inter, Lato, Nunito, Open Sans, Raleway, Roboto, Source Sans 3. Font name renders in the selected typeface via inline `style={{ fontFamily }}`. Applied to all ECharts text (global `textStyle`, legend, axes, tooltip).
- **Background** — `ColorRow` (`<input type="color">` + 72 px hex text input). **Opacity** slider (0–100, maps to `bgAlpha`; live swatch preview).
- **Text Color**, **Grid Lines**, **Axis Lines** — each a `ColorRow` (`<input type="color">` + hex text input).
- **Reset to Default** button — calls `onChange(defaultReportTheme())`.
- **Export Theme** button — downloads `{ reportTheme: theme }` as `report-theme.json`.
- **Import Theme** button — `<input type="file" accept=".json">` → parses JSON → calls `onChange({ ...defaultTheme, ...(parsed.reportTheme ?? parsed) })`.

All changes call `onChange` immediately (live preview in charts).

---

### `ReportInstanceCard`

```jsx
<ReportInstanceCard
  ref={cardRef}              // useImperativeHandle — exposes generate()
  instance={object}          // { _tempId, id?, query_id, query, label, config, position }
  reportTheme={object}       // normalised theme from ReportBuilder
  startDate={Date|null}
  endDate={Date|null}
  addressLabels={array}
  onChange={fn}              // called with updated instance object on config change
  onRemove={fn}              // called with _tempId to remove from instances list
/>
```

**State:**
- `expanded` — bool (collapsed by default when `instance.id` exists; expanded for new instances)
- `runStatus` — `null | 'running' | 'done' | 'error'`
- `previewRows` — result rows from the preview run
- `config` — chart config (xField, leftFields, rightFields, groupBy, seriesColors, colDivisors, activeFilters, etc.)
- `chartInstanceRef` — ref to the ECharts instance from `MiniChart`

**`useImperativeHandle` — `generate()` method:**
1. Calls `setExpanded(true)` — ensures `MiniChart` is mounted (it only renders when expanded)
2. If `runStatus !== 'done'`, awaits `runPreview()`
3. Polls `chartInstanceRef.current` every 100 ms (up to 50 × = 5 s) until the ECharts instance is ready
4. Calls `chartInstanceRef.current.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: hexToRgba(reportTheme.bg, reportTheme.bgAlpha) })`
5. Returns `{ dataUrl, filename }` — `filename` from `buildFilename(query, label, config, startDate, endDate)`

**`hexToRgba(hex, alpha)` (module-level):**
```js
function hexToRgba(hex, alpha) {
  const h = hex.replace('#','')
  const full = h.length === 3 ? h.split('').map(c=>c+c).join('') : h
  const r = parseInt(full.slice(0,2),16)
  const g = parseInt(full.slice(2,4),16)
  const b = parseInt(full.slice(4,6),16)
  return `rgba(${r},${g},${b},${(alpha ?? 100) / 100})`
}
```

**`buildEChartsOption`** — applies full theme:
- `backgroundColor: hexToRgba(reportTheme.bg, reportTheme.bgAlpha)`
- `textStyle: { color: reportTheme.textColor, fontFamily }` — cascades to most chart text
- `legend.textStyle.color`, `legend.textStyle.fontFamily` → `reportTheme.textColor`, `fontFamily`
- Both axes: `axisLine.lineStyle.color`, `axisTick.lineStyle.color`, `axisLabel.color` → `reportTheme.axisColor` / `reportTheme.textColor`; `axisLabel.fontFamily` → `fontFamily`
- Both yAxis: `splitLine.lineStyle.color` → `reportTheme.gridColor`
- `tooltip.extraCssText` includes `font-family: ${fontFamily};`
- Series color fallback: `reportTheme.palette[(colorOffset+i) % palette.length]`

**ECharts-native axis names** — all three axes use ECharts-native `name`/`nameLocation`/`nameGap`/`nameRotate`/`nameTextStyle` (matches the pattern in `ResultsChart.jsx`). This ensures axis labels are visible in both live canvas preview and PNG exports (DOM-overlay labels cannot be captured by `getDataURL`):
- Left Y: `nameLocation: 'middle'`, `nameGap: 52`, `nameRotate: 90`
- Right Y: `nameLocation: 'middle'`, `nameGap: 52`, `nameRotate: -90`
- X axis: `nameLocation: 'middle'`, `nameGap` adaptive (46 when many labels, else 32)
- Grid margins widen when axis names are present: `left: leftName ? 70 : 52`, `right: rightName ? 70 : 12`, `bottom: xName ? 56 : 40`

**`makeSeriesLabel(field, yMode)` — `(R)` collision logic:**
Before building series, a `leftLabelSet` is computed of all left-axis labels (with cumulative suffix when `leftYMode === 'cumulative'`). `(R)` is appended to right-axis series labels **only when** the computed label would exactly match a left-axis label. When left and right show different fields or different modes, no `(R)` suffix is added.

**`MiniChart`** sub-component: renders the ECharts instance for the preview run. Uses `onInstance(chart)` callback (→ `chartInstanceRef.current`) on mount, `onInstance(null)` on unmount cleanup. Only rendered when `expanded === true` — hence the poll in `generate()`.

**`__right` alias suffix:** fields that appear on both Y axes get an `__right` suffix in the series key to avoid data key collision. The suffix is stripped by `makeSeriesLabel` for display; `(R)` is only appended when the resulting label would otherwise duplicate a left-axis label.

---

### `ReportsPanel`

```jsx
<ReportsPanel
  startDate={Date|null}
  endDate={Date|null}
  colorSchemes={array}
  addressLabels={array}
/>
```

Internal state: `reports`, `selectedReport`, `loading`, `refresh`.

Lists reports in a left sidebar. Right pane shows `ReportBuilder` for the selected report (or create-new form). When `loading` is true (triggered by `setLoading(true)`), a "Loading report…" placeholder replaces `ReportBuilder` — which unmounts it completely.

**`handleSave(report)` callback** (passed as `onSave` to `ReportBuilder`): only calls `setSelectedReport(prev => ({ ...prev, ...report }))`. Does NOT increment `refresh` or trigger a reload — this avoids the unmount/remount cycle that would clear all `cardRefs` in `ReportBuilder`.

**`refresh` state** is only incremented explicitly (e.g., when a report is deleted and re-selected). The `useEffect([selectedReport?.id, refresh])` that sets `loading = true` is guarded to only fire when the ID changes or refresh is explicitly incremented.

---

### `ReportCompareView`

```jsx
<ReportCompareView
  runAId={number}
  runBId={number}
  onClose={fn}
/>
```

Fetches both report runs via `getReportRun`. Side-by-side per-query status comparison. (Legacy component — only used for old-style `report_runs`.)

---

### `SchemaExplorer`

```jsx
<SchemaExplorer
  onClose={fn}
  onUseQuery={fn}            // called with GQL string
/>
```

Embeds GraphiQL pointed at `/api/proxy`. "Use This Query" button enabled once a query is typed. Calls `onUseQuery(gql)`.

---

### `AddressBook`

```jsx
<AddressBook
  onClose={fn}
  onLabelsChange={fn}        // called with full updated labels array
/>
```

Full-screen modal. Fetches labels on open. Inline add/edit/delete rows. Export (JSON download) and import (file pick) of the label list.

---

### `ImportExportModal`

```jsx
<ImportExportModal
  onClose={fn}               // App increments sidebarRefresh on close
/>
```

Two tabs: **Export** and **Import**.

Export tab state: `queryList`, `selectedQueryIds` (Set), `includeAddressLabels`, `includeSettings`, `exporting`. Calls `exportBundle`, receives JSON response, triggers download as `quarterly-export-YYYY-MM-DD.json` via `URL.createObjectURL(new Blob([...]))`.

Import tab — 3 steps:
1. File pick / drag-drop → parse JSON → validate `schemaVersion` → call `previewImport` → transition to step 2
2. Preview with per-item decisions (dropdowns + field checkboxes) → "Import N items" → call `commitImport` → step 3
3. Summary of results + Close button

---

### `QueryPreviewModal`

```jsx
<QueryPreviewModal
  run={object}               // currentRun (has variables_base, gql etc.)
  onClose={fn}
/>
```

Shows: endpoint URL, GQL query string, variables JSON. Code snippet tabs: Python, curl, TypeScript, R. Copy button per tab. Backdrop click closes.

---

### `EndpointProfilesModal`

```jsx
<EndpointProfilesModal
  onClose={fn}
  onSelect={fn}              // called with profile object; App updates settings
/>
```

Lists saved profiles. "+ New Profile" form: name, URL. "Use →" calls `onSelect(profile)` and closes. "Delete" calls `deleteEndpoint` after `window.confirm`.

---

### `ExportButtons`

```jsx
<ExportButtons
  runId={number}
/>
```

Renders JSON and CSV download anchor tags pointing at `/api/export/run/:id/json` and `/api/export/run/:id/csv`.

---

### `ChainFilter`

```jsx
<ChainFilter
  rows={array}
  value={string}             // selected chain
  onChange={fn}
/>
```

Dropdown of distinct chain values in `rows`. Also used internally by other components.

---

## 11. Frontend API Client

File: `frontend/src/api/client.js`

Single `request(method, path, body, signal)` function. Base path is `/api`. Always parses JSON (catches parse errors → null). Returns `{ status, ok, data }`.

All exports:

```js
// Settings
getSettings()
updateSettings(updates)
pingEndpoint()

// Queries
listQueries()
getQuery(id)
createQuery(body)
updateQuery(id, body)
deleteQuery(id)
importQueries(queries)

// Runs
createRun(body, signal)
listRuns(queryId, limit=20, offset=0)
getRun(id)
deleteRun(id)
patchRun(id, body)

// Reports
listReports()
getReport(id)
createReport(body)              // body: { name, description?, config? }
updateReport(id, body)          // body: { name?, description?, config? }
deleteReport(id)

// Report instances
addReportInstance(reportId, body)                    // POST /api/reports/:id/instances
updateReportInstance(reportId, instanceId, body)     // PUT /api/reports/:id/instances/:iid
deleteReportInstance(reportId, instanceId)           // DELETE /api/reports/:id/instances/:iid
bulkSaveReportInstances(reportId, instances)         // PUT /api/reports/:id/instances  ← primary save path

// Legacy report runs (kept for backward compat)
runReport(id, body)             // POST /api/reports/:id/run
getReportRun(reportRunId)       // GET /api/reports/runs/:id
listReportRuns(reportId)        // GET /api/reports/:id/runs

// Address labels
listAddressLabels()
createAddressLabel(body)
updateAddressLabel(id, body)
deleteAddressLabel(id)

// Color schemes
listColorSchemes()
createColorScheme(body)           // { name, colors, theme? }
updateColorScheme(id, body)       // { name, colors, theme? }
deleteColorScheme(id)
setDefaultScheme(id)              // POST /api/color-schemes/:id/set-default

// Introspect
introspect(endpoint?)

// Transfer
exportBundle(body)
previewImport(bundle)
commitImport(body)

// Export URLs (strings, not fetch calls)
exportRunJson(id)    // → '/api/export/run/:id/json'
exportRunCsv(id)     // → '/api/export/run/:id/csv'
exportReportRunZip(id)

// Endpoint profiles
listEndpoints()
createEndpoint(body)
updateEndpoint(id, body)
deleteEndpoint(id)
```

---

## 12. Key Implementation Details

### `mergeDatasets.js` — multi-dataset X-axis union join

File: `frontend/src/utils/mergeDatasets.js`

Exports `mergeDatasets(datasets)` and `formatXLabel(key, groupBy)`.

**`mergeDatasets(datasets)`** — takes an array of dataset descriptors and returns `{ xKeys, rows, seriesKeys }`.

Each descriptor:
```js
{ id, rows, xField, yFields, colDivisors, groupBy, aggregation, yMode }
```

**Algorithm:**
1. **`bucketDataset`** — groups each dataset's rows into `Map<bucketKey, { [field]: number[] }>`. Bucket keys come from `bucketTimestamp(ts, groupBy)` which normalises unix timestamps to day/week/month starts in UTC. `applyDivisorNumeric` applies `÷1e6`/`÷1e18` scaling (BigInt arithmetic) per column before collecting into buckets.
2. **Union all keys** — `new Set(...)` across all datasets' Maps.
3. **Sort keys** — numeric sort (timestamps), string sort otherwise.
4. **Aggregate per bucket** — `aggregate(values, method)` applies sum/avg/median/min/max/count; returns `null` for empty arrays.
5. **Cumulative mode** — iterates keys in order, running a sum per field, mutates `aggMap` in place.
6. **Merge rows** — for each `xKey`, one row object `{ x, d0_field, d1_field, ... }`. Missing buckets for a dataset → `null` (null-fill). Series key prefix `d{idx}_` prevents column name collisions across datasets.

**`formatXLabel(key, groupBy)`** — formats a unix-seconds bucket key as a human-readable date string. Keys > 946684800 (year 2000) are formatted as dates; others are stringified as-is.

**Type-compatible X alignment:** both datasets are bucketed with the same `groupBy` before joining. Timestamps in dataset A and B don't have to match exactly — they just need to be unix timestamps so `bucketTimestamp` maps them to the same bucket.

---

### `chartDataUtils.js` — pure chart data helpers

File: `frontend/src/utils/chartDataUtils.js`

Extracted from `ReportInstanceCard` so the functions can be unit-tested without React or ECharts dependencies. All six exports are pure functions.

**`applyDivisorNumeric(value, divisor)`** — converts a raw cell value to a Number applying `÷1e6` / `÷1e18` divisors via BigInt arithmetic to avoid float precision loss. Returns `null` for null/empty/undefined inputs. `'datetime'` divisor is treated as `raw`.

**`bucketTimestamp(ts, groupBy)`** — maps a Unix-second timestamp to its bucket anchor: `'day'` → UTC midnight, `'week'` → nearest multiple of 604800, `'month'` → UTC first of month, `'none'` → `Number(ts)`.

**`aggregate(values, method)`** — reduces a `number[]` using `sum` (default), `avg`, `median`, `min`, `max`, or `count`. Filters nulls/NaN before aggregating. Returns `null` for empty arrays.

**`buildChartData(rows, xField, yFields, colDivisors, groupBy, yMode, aggregation, xSortDir)`** — the main chart data builder used by `ReportInstanceCard`:
1. Groups rows into a `Map<bucketKey, { [field]: number[] }>` using `bucketTimestamp`
2. Aggregates each bucket with `aggregate(values, aggregation)`
3. Sorts by X value (numeric then string fallback), reversed if `xSortDir === 'desc'`
4. Applies cumulative mode (running sum per field) if `yMode === 'cumulative'`
5. Returns `[{ x, [field]: value, ... }, ...]`

**`fmtAxisVal(val)`** — compact Y-axis label formatter: `1234567` → `"1.23M"`. Supports K/M/B/T suffixes.

**`fmtXLabel(val, groupBy, xField)`** — formats an X-axis label. When `groupBy !== 'none'`, treats `val` as a Unix-second timestamp and formats with `toLocaleDateString`. Otherwise, heuristically detects Unix timestamps (1e9 < val < 2e10) and formats as dates; falls back to `String(val)`.

---

### Reports architecture

The Reports tab uses an **instance-based architecture** where each chart in a report is a `report_instances` row with its own chart config JSON.

**Save flow (`ReportBuilder.handleSave`):**
1. Calls `createReport` or `updateReport` with `{ name, description, config: { theme: reportTheme } }`
2. Calls `bulkSaveReportInstances(id, instances)` — replaces all instances in one transaction
3. Calls `onSave(saved)` — `ReportsPanel.handleSave` updates `selectedReport` state only (no reload)

The critical design constraint: `ReportBuilder` must NOT be unmounted between save and PNG generation, because all `cardRefs` are cleared on unmount. `ReportsPanel.handleSave` therefore avoids any state changes that would cause a loading→remount cycle.

**Generate PNGs flow (`ReportBuilder.handleGenerate`):**
1. Iterates `cardRefs.current` entries
2. For each ref, calls `await ref.generate()` — see `ReportInstanceCard` section
3. Collects `{ dataUrl, filename }` objects (skips null `dataUrl`)
4. For each result, creates `<a href=dataUrl download=filename>` and calls `.click()` with 300 ms between
5. Shows "No charts could be generated" if all refs returned null

**Why cards start collapsed:** saved instances (`instance.id` exists) initialize `expanded = false`. A collapsed card has `MiniChart` unmounted → `chartInstanceRef.current = null` → `getDataURL` cannot be called. The `generate()` method calls `setExpanded(true)` first, then polls until `chartInstanceRef.current` is non-null (up to 5 s).

**Theme system:**
- `defaultReportTheme()` provides baseline colors for new reports
- `normaliseTheme(partial)` merges user-saved or scheme-derived partial into defaults
- `reportTheme` is persisted as `reports.config.theme` (via `bulkSaveReportInstances` → `updateReport` via `handleSave`)
- On report load: `setReportTheme(normaliseTheme(report?.config?.theme))` — missing keys fill from defaults
- Color scheme selector in `ReportBuilder`: applies scheme palette to `reportTheme.palette`; does not overwrite bg/textColor/etc.

---

### Divisor persistence

`colDivisors` is lifted to `App` level so it survives query re-runs. When a user cycles a divisor via the column badge in `ResultsTable`, `onDivisorChange(newDivisors)` is called. In `App.handleDivisorChange`:
1. Sets `colDivisors` state immediately
2. Maps divisors back to `field_meta.decimals` values
3. Calls `updateQuery(id, { ...selectedQuery, field_meta: currentMeta })`
4. Updates `selectedQuery` state with server response

On `handleSelectQuery`, `colDivisors` is initialised from `field_meta` via `divisorsFromFieldMeta`.

### Built-in query import

`QuerySidebar` handles this on mount. It checks `settings.builtin_imported`. If `!== '1'`:
1. Fetches JSON files from `/queries/builtin/*.json` (served by Vite/Express as static)
2. Calls `importQueries(builtins)` — the backend skips any that already exist by name
3. Calls `updateSettings({ builtin_imported: '1' })`

### Sidebar clone button (visibility vs conditional render)

Clone button is always in the DOM. Uses `visibility: hidden` (not `display: none`) so the button always occupies space, preventing layout shifts when hovering. This required an inner flex row wrapping just the name + button:

```jsx
<div className="sidebar-item" ...>   {/* flex-direction: column from CSS */}
  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    <span className="sidebar-item-name">...</span>
    <button style={{ visibility: hoveredId === q.id ? 'visible' : 'hidden' }}>⧉</button>
  </div>
  <div className="sidebar-item-meta">...</div>
</div>
```

The `.sidebar-item` CSS class has `flex-direction: column`. Adding `display: flex; align-items: center` directly on it would override that to row, breaking layout.

### `needsRerun` logic

Only fires when the current date pickers extend *beyond* what was fetched:
- `runStart !== null && (startDate === null || startDate < runStart)` → user wants earlier data
- `runEnd !== null && (endDate === null || endDate > runEnd)` → user wants later data

Narrowing is safe (handled by `filteredRows` client-side).

### EndpointBar remount pattern

When a user selects an endpoint profile, the new URL is persisted via `updateSettings`. `EndpointBar` reads the URL from the server on mount. To force it to re-read (and re-ping), `App` increments `endpointVersion` which is passed as `key={endpointVersion}` to `EndpointBar`, causing React to unmount and remount it.

### `graphql_partial` semantics

When a Ponder page returns both `data` and `errors` (partial success), ponder.js:
1. Includes the rows from that page
2. Stops pagination immediately
3. Returns `error_type: 'graphql_partial'` with the rows

The run is saved to the database. The results tab shows a warning banner. The user can still view and export the partial results.

### Auto-inject date filter

`backend/src/utils/autoInjectDateFilter.js` modifies the GraphQL query string to add timestamp filters when:
- No `global_start`/`global_end` variable definitions exist in the query
- `start_date` and/or `end_date` were provided in the request body

This is attempted first; if string manipulation fails (unusual query structure), the run retries without injection and adds a warning to the result.

### `variables_base` in saved runs

`variables_base` stores only user-visible variables (date vars + user-input vars). Pagination variables (`pagination_first`, `pagination_skip`, `pagination_after`) are excluded. This is what the Query Preview modal shows.

### Staleness indicator

When a query is selected in the sidebar (`handleSelectQuery`), App immediately calls `listRuns(query.id, 1, 0)` and then `getRun(id)` to silently pre-populate `currentRun` with the most recent saved run. This means the Results tab shows cached data instantly without requiring a manual re-run.

The `now` state is initialised to `Date.now()` and updated every 60 seconds via `setInterval`. This drives the staleness label ("Results from 2h ago") in the run stats bar so it stays current without a page reload.

If `currentRun.ran_at` is ≥ 72 hours before `now`, a full-width amber `.warning-banner` is shown above the results with a prompt to re-run. The 72-hour threshold is hard-coded.

`formatAge(ranAt, now)` formats: < 60 s → "just now", < 60 m → "Xm ago", < 24 h → "Xh ago", otherwise "Xd ago".

### Per-series aggregation (ResultsChart)

When `groupBy !== 'none'` and `isTimestampX`, each bucket of rows is aggregated into a single point. The supported methods are `sum`, `mean`, `median`, `min`, `max`.

**`buildChartData` group-by pattern:** uses a unified Map-group-then-aggregate approach for all `groupBy` modes. For each row, its bucket key and per-field numeric values are pushed into arrays in a `Map`. After all rows are processed, each bucket is mapped to a point by applying `aggregate(values, method)`.

**`aggregate(values, method)`** filters out nulls/NaN, then: `sum` → reduce add; `mean` → reduce add ÷ length; `median` → sort + mid index; `min`/`max` → Math.min/max spread. Returns `null` for empty arrays or non-finite results.

`leftAggregation` and `rightAggregation` are independent state variables (default `'sum'`). They are persisted into and restored from saved chart views alongside the other chart config fields. The aggregation selectors are rendered inside `YAxisSelector` and are only visible when `showAggregation={isTimestampX && groupBy !== 'none'}`.

### Timestamp extraction (ResultsChart / App.jsx pipeline)

The `isTimestampX` flag — `xField === 'timestamp' || colDivisors[xField] === 'datetime'` — generalises chart x-axis detection to cover both the conventional `timestamp` field and any field marked `'datetime'` in `colDivisors`. This means a query using `timestamp_extraction` with a custom `outputName` (e.g. `event_time`) will still activate Group By / aggregation controls in `ResultsChart` once that field's divisor is set to `'datetime'`.

The `colDivisors` auto-init on `handleSelectQuery` ensures this: when `timestamp_extraction` is configured, `colDivisors[outputName]` is set to `'datetime'` immediately so the chart recognises it without manual user action.

### Computed columns

Computed columns are user-defined arithmetic formulas that produce additional columns from existing row data. They are defined per query (stored in `computed_columns` JSON array in the DB) and evaluated client-side at display time.

**Storage shape:** `[{ name, label, formula }]`. `name` must match `/^[A-Za-z_][A-Za-z0-9_]*$/` (validated frontend only). `formula` is a plain arithmetic expression string, e.g. `"volume / price"`.

**`applyComputedColumns(rows, defs, colDivisors)`** (in `frontend/src/utils/computedColumns.js`):
1. Returns rows unchanged if `defs` is empty/null.
2. For each row, builds an initial scope from all row fields, applying `applyDivisor` to get display values (same logic as `ResultsChart` — BigInt-safe divisor scaling).
3. Iterates defs in order. For each def, evaluates the formula using the custom arithmetic parser with the current scope. On success, adds the result (if finite and non-NaN) or `null` to the scope and to the output row. This enables chaining: later columns can reference the result of earlier ones.
4. Returns new row objects (original rows not mutated).

**`parseFormula(formula)`** — parses the formula using the custom arithmetic parser. Returns the parsed expression object or `null` on syntax error or empty string.

**Custom arithmetic parser** (built into `computedColumns.js`, no `eval` or `Function`): supports `+`, `-`, `*`, `/`, `^` (exponentiation), unary minus, parentheses, named variables (row field names), and numeric literals. Blocks access to prototype properties (guards against `__proto__` injection). Division by zero produces `Infinity`, caught by `!isFinite(result)` → `null`.

**`computedFieldMeta(defs)`** returns `{ [name]: { label: label || name, computed: true } }` for each def. This is merged into `fieldMeta` in App so computed columns get labels in `ResultsTable` headers and chart field selectors.

**Pipeline position:** `computedRows = applyComputedColumns(filteredRows, defs, colDivisors)` — applied after timestamp extraction and date+chip filtering, before passing rows to `ResultsView`. This means filters operate on raw (and extracted) columns only; computed columns are not filterable.

### Timestamp extraction

`applyTimestampExtraction(rows, config)` (in `frontend/src/utils/timestampExtraction.js`) runs first in the data pipeline — before date filtering — so the extracted field can be used as the timestamp for date range filtering.

**Config shape:** `{ sourceField, delimiter, position ('before'|'after'), outputName, outputLabel }`. When `config` is null/undefined, rows are returned unchanged.

**Extraction logic:** for each row, takes `row[sourceField]`, splits on `delimiter`, and takes the token at `position` (`'before'` → index 0, `'after'` → last index). The result is added as `row[outputName]`. If the source field is missing or splitting fails, `outputName` is set to `null` on that row.

**`timestampExtractionMeta(config)`** returns `{ [outputName]: { label: outputLabel || outputName, datetime: true } }` or `{}` when config is null. The `datetime: true` flag causes `ResultsTable` and chart logic to treat it as a datetime column.

**Warning banner suppression:** the "no timestamp field" warning banner in App is suppressed when `timestamp_extraction` is configured, since the extracted field serves as the timestamp.

**Pipeline position:** `extractedRows = applyTimestampExtraction(currentRun.rows, config)` runs before `filteredRows`. The date range filter reads `selectedQuery?.timestamp_extraction?.outputName || 'timestamp'` as the field name to filter on.

---

## 13. Testing

### Backend (Jest)

Run: `npm test --workspace=backend`

Config: `jest` in `backend/package.json`, `--runInBand` (sequential — avoids SQLite contention).

**Pattern for DB integration tests:**
- Guard with `nativeAvailable` check: tests try to `new Database(':memory:')` and skip all tests if it fails
- `makeDb()` creates an in-memory SQLite with full schema, inserts test settings
- `makeApp(db)` creates a fresh Express app with route under test
- Each test creates its own db + app, closes db at end
- HTTP calls to the GraphQL endpoint are mocked via `global.fetch = jest.fn()` (save/restore in `beforeEach`/`afterEach`)

**HTTP mock helpers (all test files that exercise network calls):**
```js
function mockResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}
let _realFetch;
beforeEach(() => { _realFetch = global.fetch; global.fetch = jest.fn(); });
afterEach(() => { global.fetch = _realFetch; });
```

Common patterns:
- Single reply: `global.fetch.mockResolvedValueOnce(mockResponse(data))`
- Chained replies (pagination): `global.fetch.mockResolvedValueOnce(...).mockResolvedValueOnce(...)`
- Body capture: `global.fetch.mockImplementationOnce(async (_url, opts) => { captured = JSON.parse(opts.body); return mockResponse(data); })`
- Error: `global.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))`

**Why not nock?** `nock` intercepts Node's `http`/`https` modules. Node 22's native `fetch` uses `undici` internally, which bypasses those hooks entirely. Removed `nock` from devDependencies (commit `d4046e9`).

**`runs.test.js` adds `notes TEXT` to its `makeDb()` schema** because migration 004 adds it via `ALTER TABLE`, which the in-memory test db doesn't run.

**`queries.test.js` adds `computed_columns TEXT NOT NULL DEFAULT '[]'` and `timestamp_extraction TEXT` to its `makeDb()` schema** for the same reason (migrations 005 and 006).

**`colorSchemes.test.js`** (46 tests) — `makeDb()` includes `color_schemes` schema with `theme TEXT DEFAULT NULL`; `seedScheme(db, name, colors, isDefault, theme)` helper; `VALID_THEME` constant. Covers:
- GET: returns all schemes with parsed JSON; null theme stays null; theme object returned parsed
- POST: valid scheme (no theme, theme:null, full theme, partial theme); array → 400; string → 400; unknown key → 400; bad hex → 400; null individual value valid
- PUT: updates name/colors/theme; `theme:null` clears; omitting theme preserves; unknown key → 400; bad hex → 400
- DELETE: normal delete; cannot delete default (400); 404 not found
- POST `/set-default`: sets default, clears others; 404 not found

**`reports.test.js`** (37 tests) — `makeDb()` includes `reports` table with `config TEXT DEFAULT NULL` and `updated_at TEXT DEFAULT NULL`; `report_instances` table; `queries` and `report_queries`/`report_runs`/`report_run_queries` for backward-compat routes. Covers:
- CRUD on reports (create, get, update, delete, 404 cases)
- `config` round-trip (create with config, update config, omit config preserves existing)
- Instance add (`POST /instances`): auto-position, explicit position, 400 on missing query
- Instance update (`PUT /instances/:iid`): partial update, config update
- Instance delete (`DELETE /instances/:iid`)
- Bulk save (`PUT /instances`): replaces all, validates query_ids pre-transaction
- Legacy routes: `GET /runs`, `GET /runs/:id`

### Frontend (Vitest)

Run: `npm test --workspace=frontend`

Config: `vitest.config.js` with `environment: 'jsdom'`, `setupFiles: ['@testing-library/jest-dom/vitest']`.

**15 test files, 314 tests total (as of 2026-07-15):**

| File | Tests | Coverage |
|---|---|---|
| `components/__tests__/ResultsTable.test.jsx` | ~25 | Column rendering, sorting, divisors, address resolution, copy formats, virtualisation toggle |
| `components/__tests__/ComputedColumnsEditor.test.jsx` | 12 | Empty state, existing defs, edit flow, delete, add (success/validation errors/cancel), reorder |
| `components/__tests__/ColorSchemeManager.test.jsx` | 32 | List rendering (swatches, default badge), set default, delete, create, edit (name/colors/theme), "Override chart appearance" checkbox behavior (opt-in, pre-checked for themed schemes, hides/shows pickers), save with and without theme, update scheme with and without theme |
| `components/__tests__/ResultsView.test.jsx` | 22 | Renders table by default, chart tab switch (Chart button), `display:none` toggling (both children always mounted), props flow through (divisors, filters, save view), color scheme props forwarded to ResultsChart |
| `components/__tests__/MultiQueryChart.test.jsx` | 25 | Initial render, query loading, add/remove datasets, run datasets (createRun args with start_date/end_date), auto-xField, series add/remove, chart controls, Run All, dataset config selectors. Mocks: `vi.mock('../../api/client.js')`, `vi.mock('echarts')`, `global.ResizeObserver` stub |
| `utils/__tests__/computedColumns.test.js` | 115 | `parseFormula` (valid/invalid/empty), `applyComputedColumns` (no defs, arithmetic, divisors, zero, chaining, invalid formula, div-by-zero, prototype blocking), `computedFieldMeta`, custom parser operators |
| `utils/__tests__/timestampExtraction.test.js` | 25 | `applyTimestampExtraction` (null config, before/after position, missing field, delimiter variants), `timestampExtractionMeta` |
| `utils/__tests__/mergeDatasets.test.js` | 38 | Guard cases, aggregation (sum/avg/min/max/count/median), groupBy (day/week/month), cumulative, divisors, two-dataset union join, same-column collision prevention, type-compatible X alignment, three datasets, formatXLabel |
| `components/__tests__/EndpointBar.test.jsx` | ~5 | URL save, ping, explore button visibility |
| `components/__tests__/QuerySidebar.test.jsx` | ~5 | Query listing, search filter, builtin import |
| `components/__tests__/HistoryDrawer.test.jsx` | ~4 | Run list, note editing, pin/compare flow |
| `components/__tests__/QueryPreviewModal.test.jsx` | ~4 | Code snippet tabs, copy button |
| `components/__tests__/SchemaExplorer.test.jsx` | ~4 | GraphiQL embed, "Use This Query" button |
| `components/__tests__/EndpointProfilesModal.test.jsx` | ~4 | Profile list, create, select, delete |
| `utils/__tests__/chartDataUtils.test.js` | 56 | `buildChartData` edge cases: bucket collapsing, cumulative across grouped data, divisors, aggregation modes, empty series |

**Grand total: 561 tests (314 frontend Vitest + 240 backend Jest passing + 7 skipped)**

Backend test counts: 11 test files, 247 total (240 passing + 7 skipped integration tests gated by `process.env.INTEGRATION`). The 7 skipped tests in `runs.test.js` / `ponder.test.js` require a live Ponder endpoint.

New backend test file: `backend/tests/addressLabels.test.js` (22 tests) — covers CRUD on address labels including UNIQUE constraint, 404 cases, and re-creation after deletion.

**Important:** run Vitest from `frontend/` directory, not repo root. Root `package.json` `test` script only runs backend Jest.

**Mocking pattern:**
- `vi.mock('../../api/client.js', () => ({ fn: vi.fn() }))` — mock BEFORE import
- `import Component from '../Component.jsx'` — import AFTER mock
- `@tanstack/react-virtual` is mocked to return all items (no DOM scroll measurement)

**`ResultsTable` mock for `addressLabels.js`:**
```js
vi.mock('../../utils/addressLabels.js', () => ({
  buildAddressMap: () => new Map(),
  resolveAddress: (_value, _chain, _map) => null,
}))
```

**Key `computedColumns.test.js` note:** The custom parser supports unary minus and the `^` exponentiation operator. Tests use `'(a + b'` (unclosed paren) as the canonical invalid-syntax case. Prototype property access (e.g., `__proto__`) is blocked and results in `null`. The test suite has 115 tests covering all parser operators, edge cases, chaining, and security guards.

---

## 14. CSS / Theme Variables

The app uses CSS custom properties for theming. Variables expected:

```css
--color-bg           /* page background */
--color-surface      /* card / panel background */
--color-surface2     /* slightly elevated surface */
--color-border       /* borders, dividers */
--color-text         /* primary text */
--color-text-muted   /* secondary text */
--color-accent       /* brand colour (blue) */
--color-error        /* error red */
--color-warning      /* warning orange */
--font-mono          /* monospace font stack */
```

CSS class patterns used:
- `.app-layout`, `.app-topbar`, `.app-body`, `.app-sidebar`, `.app-main`
- `.tab-bar` — horizontal button row; `.active` modifier on the selected tab
- `.sidebar-item`, `.sidebar-item.active`, `.sidebar-item-name`, `.sidebar-item-meta`
- `.sidebar-category` — category group header
- `.sidebar-actions` — top row of the sidebar (new + refresh buttons)
- `.results-table-container`, `.results-table` — scrollable table wrapper
- `.error-banner`, `.warning-banner` — alert strips
- `.spinner` — CSS animation for loading state

---

## 15. Deployment Notes

**Dev:** `npm run dev` — Vite proxies `/api` to `http://127.0.0.1:8790`.

**Production (single-process):**
1. `npm run build --workspace=frontend` — outputs to `frontend/dist/`
2. Add to `backend/src/server.js`:
   ```js
   const path = require('path')
   app.use(express.static(path.join(__dirname, '../../frontend/dist')))
   app.get('*', (req, res) =>
     res.sendFile(path.join(__dirname, '../../frontend/dist/index.html')))
   ```
3. Run `node backend/src/server.js` — serves both API and SPA on port 8790.

**Environment variable:** `PORT` overrides the default 8790.

**`better-sqlite3` requires native compilation.** On systems without build tools, the backend will fail to start. Install: `apt-get install build-essential python3` (Linux) or Xcode Command Line Tools (macOS).

**The database file** is at `backend/data/quarterly.db`. Back this up to preserve query definitions, run history, and address labels.

**Not suitable for multi-user / internet-exposed deployment** without additional auth, rate limiting, and network hardening. The SSRF protections are present but the tool is designed for single-user localhost use.

---

## 16. Dependency Security Notes

Last audited: **2026-07-15**.

`npm audit` reports **0 vulnerabilities** across all workspaces. The following were investigated via NVD and GitHub advisories in addition to the npm advisory database:

| CVE | Package | CVSS | Fixed in | Status |
|---|---|---|---|---|
| CVE-2026-39363 | vite | 8.2 (LFI via WebSocket) | 6.4.3 | ✅ Pinned to 6.4.3 |
| — | undici | HIGH (TLS bypass + WebSocket DoS) | 8.5.0 | ✅ Bumped to 8.7.0 |
| CVE-2025-71176 | vitest | 9.8 | 4.1.8 | ✅ Pinned to 4.1.10 (latest fix series) |
| — | archiver | — | 8.0.0 | ✅ Pinned to 8.0.0 |
| — | react-datepicker | — | 9.1.0 | ✅ Pinned to 9.1.0 |
| — | node-fetch | supply chain + SSRF risk | — | ✅ Removed entirely; native Node 22 `fetch` used instead |
| — | better-sqlite3 | — | 12.11.2 | ✅ Pinned to 12.11.2 |
| — | csv-stringify | — | 6.8.1 | ✅ Pinned to 6.8.1 |
| — | jszip | — | — | ✅ Removed from package.json — not used (PNG download uses individual `<a>.click()`) |
| — | js-yaml | moderate (jest transitive) | — | ⚠ Unfixable without breaking jest@29; accepted risk (dev-only) |

**SSH deploy key:** `/workspace/extra/github-keys/github_deploy` (ed25519, comment: `nanoclaw-bot`). Push command: `eval "$(ssh-agent -s)" && ssh-add /workspace/extra/github-keys/github_deploy && git push origin main`

---

## 17. Future / Maybe

Ideas that have been raised but explicitly deferred. Do not implement without checking with the user first.

*(No deferred items at this time.)*
