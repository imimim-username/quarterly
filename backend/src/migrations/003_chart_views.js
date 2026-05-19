'use strict';

function up(db) {
  db.exec(`ALTER TABLE queries ADD COLUMN chart_views TEXT NOT NULL DEFAULT '[]'`);
}

module.exports = { up };
