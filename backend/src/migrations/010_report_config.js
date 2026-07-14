'use strict';

/**
 * Add a config JSON column to the reports table.
 *
 * This stores report-level settings such as the chart theme
 * (palette, background color, text color, grid/axis colors, PNG transparency).
 *
 * Shape: { theme: { palette, bg, bgAlpha, textColor, gridColor, axisColor } }
 */
module.exports = {
  up(db) {
    try {
      db.exec(`ALTER TABLE reports ADD COLUMN config TEXT DEFAULT NULL`);
    } catch (_) {
      // Column already exists — safe to ignore
    }
  },
};
