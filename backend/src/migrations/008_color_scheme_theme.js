'use strict';

/**
 * Add a nullable `theme` column to color_schemes.
 *
 * Stores a JSON object with optional chart appearance overrides:
 *   { bg, textColor, axisColor, gridColor }
 * NULL means "use ECharts dark-theme defaults".
 */
module.exports = {
  up(db) {
    db.exec(`ALTER TABLE color_schemes ADD COLUMN theme TEXT DEFAULT NULL`);
  },
};
