-- Saved snowflakes. `recording` is the JSON timeline of how it was made
-- (src/timeline.ts); the other columns are for listing them later.
CREATE TABLE snowflakes (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  cuts INTEGER NOT NULL,
  recording TEXT NOT NULL
);
CREATE INDEX snowflakes_created_at ON snowflakes (created_at DESC);
