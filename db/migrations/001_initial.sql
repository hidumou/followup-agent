CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  playbook TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs ((1))
  WHERE status IN ('queued', 'running', 'waiting_approval');
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  playbook TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE (run_id, user_id)
);
CREATE INDEX IF NOT EXISTS drafts_by_run ON drafts (run_id);
CREATE INDEX IF NOT EXISTS drafts_by_user ON drafts (playbook, user_id, status);
CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_run ON run_events (run_id);
CREATE TABLE IF NOT EXISTS human_edits (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS edits_by_run ON human_edits (run_id);
