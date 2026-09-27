-- Saved snowflakes. `recording` is the JSON timeline of how it was made
-- (src/timeline.ts), including the paper and its settings; the other columns
-- are for listing and filtering them later.
CREATE TABLE snowflakes (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  cuts INTEGER NOT NULL,
  -- Which paper it was cut from (PaperChoice.id); its settings stay in `recording`.
  paper TEXT NOT NULL DEFAULT 'classic',
  recording TEXT NOT NULL
);
CREATE INDEX snowflakes_created_at ON snowflakes (created_at DESC);
CREATE INDEX snowflakes_paper ON snowflakes (paper, created_at DESC);
