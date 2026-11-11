CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule_occurrences (
  schedule_id TEXT NOT NULL,
  planned_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (schedule_id, planned_at)
);
