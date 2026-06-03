'use strict';

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE color_schemes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        colors     TEXT    NOT NULL DEFAULT '[]',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
      );
    `);

    const now = new Date().toISOString();

    // Seed with the existing hardcoded palette as the default scheme
    db.prepare(`
      INSERT INTO color_schemes (name, colors, is_default, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
    `).run(
      'Default',
      JSON.stringify(['#e94560', '#2196f3', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4', '#ff5722', '#607d8b']),
      now, now,
    );

    // A few extra built-in palettes for convenience
    const builtins = [
      {
        name: 'Warm',
        colors: ['#e94560', '#ff5722', '#ff9800', '#ffc107', '#ff8f00', '#e65100', '#bf360c', '#d84315'],
      },
      {
        name: 'Cool',
        colors: ['#2196f3', '#00bcd4', '#4caf50', '#009688', '#3f51b5', '#00acc1', '#26a69a', '#43a047'],
      },
      {
        name: 'Pastel',
        colors: ['#ef9a9a', '#90caf9', '#a5d6a7', '#ffcc80', '#ce93d8', '#80deea', '#ffab91', '#b0bec5'],
      },
    ];

    const stmt = db.prepare(`
      INSERT INTO color_schemes (name, colors, is_default, created_at, updated_at)
      VALUES (?, ?, 0, ?, ?)
    `);
    for (const b of builtins) {
      stmt.run(b.name, JSON.stringify(b.colors), now, now);
    }
  },
};
