'use strict';

module.exports = {
  up(db) {
    db.exec(`ALTER TABLE queries ADD COLUMN timestamp_extraction TEXT`);
  },
};
