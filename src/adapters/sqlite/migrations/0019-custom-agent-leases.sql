-- Machine-scoped custom-agent admission leases (TASK-2475).
CREATE TABLE IF NOT EXISTS custom_agent_leases (
  lease_id TEXT PRIMARY KEY,
  repository_root TEXT NOT NULL,
  capacity INTEGER,
  launcher_pid INTEGER NOT NULL,
  launcher_start_id TEXT,
  child_pid INTEGER,
  child_start_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS custom_agent_leases_live ON custom_agent_leases(child_pid, launcher_pid);
