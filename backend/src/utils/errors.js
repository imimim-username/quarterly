'use strict';

/**
 * Send a 500 Internal Server Error response without leaking internal details.
 * The full error is logged server-side; only the error code is sent to the client.
 *
 * @param {import('express').Response} res
 * @param {unknown} err  - The caught error (logged, never serialised into the response)
 * @param {string}  [code='server_error'] - Error code to include in the JSON body
 */
function serverError(res, err, code = 'server_error') {
  console.error(`[${code}]`, err);
  res.status(500).json({ error: code });
}

module.exports = { serverError };
