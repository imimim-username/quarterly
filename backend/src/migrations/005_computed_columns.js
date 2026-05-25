'use strict';

module.exports = {
  up(db) {
    db.exec(`ALTER TABLE queries ADD COLUMN computed_columns TEXT NOT NULL DEFAULT '[]'`);
  },
};
