'use strict';

const express = require('express');
const db = require('./db');

const settingsRoutes = require('./routes/settings');
const queriesRoutes = require('./routes/queries');
const runsRoutes = require('./routes/runs');
const reportsRoutes = require('./routes/reports');
const exportRoutes = require('./routes/export');
const introspectRoutes = require('./routes/introspect');
const proxyRoutes = require('./routes/proxy');
const addressLabelsRoutes = require('./routes/addressLabels');
const transferRoutes = require('./routes/transfer');
const endpointsRoutes = require('./routes/endpoints');
const colorSchemesRoutes = require('./routes/colorSchemes');

const app = express();
const PORT = process.env.PORT || 8790;

// Middleware
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/api/settings', settingsRoutes(db));
app.use('/api/queries', queriesRoutes(db));
app.use('/api/runs', runsRoutes(db));
app.use('/api/reports', reportsRoutes(db));
app.use('/api/export', exportRoutes(db));
app.use('/api/introspect', introspectRoutes(db));
app.use('/api/proxy', proxyRoutes(db));
app.use('/api/address-labels', addressLabelsRoutes(db));
app.use('/api/transfer', transferRoutes(db));
app.use('/api/endpoints', endpointsRoutes(db));
app.use('/api/color-schemes', colorSchemesRoutes(db));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '1.0.0' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'server_error', message: err.message });
});

// Start server bound to loopback only
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`quarterly backend running at http://127.0.0.1:${PORT}`);
});

module.exports = { app, server };
