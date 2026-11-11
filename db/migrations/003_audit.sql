CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_by_run ON audit_logs (run_id, created_at);
