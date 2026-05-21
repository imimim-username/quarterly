/**
 * API client for the quarterly backend.
 * All methods throw on network error; callers handle HTTP error responses.
 */

const BASE = '/api';

async function request(method, path, body, signal) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal,
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  // Return parsed JSON regardless of status
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

// Settings
export const getSettings = () => request('GET', '/settings');
export const updateSettings = (updates) => request('PUT', '/settings', updates);
export const pingEndpoint = () => request('GET', '/settings/ping');

// Queries
export const listQueries = () => request('GET', '/queries');
export const getQuery = (id) => request('GET', `/queries/${id}`);
export const createQuery = (body) => request('POST', '/queries', body);
export const updateQuery = (id, body) => request('PUT', `/queries/${id}`, body);
export const deleteQuery = (id) => request('DELETE', `/queries/${id}`);
export const importQueries = (queries) => request('POST', '/queries/import', queries);

// Runs
export const createRun = (body, signal) => request('POST', '/runs', body, signal);
export const listRuns = (queryId, limit = 20, offset = 0) =>
  request('GET', `/runs?query_id=${queryId}&limit=${limit}&offset=${offset}`);
export const getRun = (id) => request('GET', `/runs/${id}`);
export const deleteRun = (id) => request('DELETE', `/runs/${id}`);

// Reports
export const listReports = () => request('GET', '/reports');
export const getReport = (id) => request('GET', `/reports/${id}`);
export const createReport = (body) => request('POST', '/reports', body);
export const updateReport = (id, body) => request('PUT', `/reports/${id}`, body);
export const deleteReport = (id) => request('DELETE', `/reports/${id}`);
export const runReport = (id, body) => request('POST', `/reports/${id}/run`, body);
export const getReportRun = (reportRunId) => request('GET', `/reports/runs/${reportRunId}`);

// Address labels
export const listAddressLabels   = ()        => request('GET',    '/address-labels');
export const createAddressLabel  = (body)    => request('POST',   '/address-labels', body);
export const updateAddressLabel  = (id, body)=> request('PUT',    `/address-labels/${id}`, body);
export const deleteAddressLabel  = (id)      => request('DELETE', `/address-labels/${id}`);

// Introspect
export const introspect = (endpoint) => request('POST', '/introspect', endpoint ? { endpoint } : {});

// Transfer (import / export bundle)
export const exportBundle  = (body)   => request('POST', '/transfer/export', body);
export const previewImport = (bundle) => request('POST', '/transfer/preview', bundle);
export const commitImport  = (body)   => request('POST', '/transfer/import', body);

// Export URLs (direct download links)
export const exportRunJson = (id) => `${BASE}/export/run/${id}/json`;
export const exportRunCsv = (id) => `${BASE}/export/run/${id}/csv`;
export const exportReportRunZip = (id) => `${BASE}/export/report-run/${id}/zip`;

// Endpoint profiles
export const listEndpoints   = ()         => request('GET',    '/endpoints');
export const createEndpoint  = (body)     => request('POST',   '/endpoints', body);
export const updateEndpoint  = (id, body) => request('PUT',    `/endpoints/${id}`, body);
export const deleteEndpoint  = (id)       => request('DELETE', `/endpoints/${id}`);

// Report runs list
export const listReportRuns  = (reportId) => request('GET',    `/reports/${reportId}/runs`);
