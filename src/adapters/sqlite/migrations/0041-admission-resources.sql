-- Separate verification exclusion from agent admission capacity.
ALTER TABLE custom_agent_leases ADD COLUMN resource TEXT NOT NULL DEFAULT 'agents';
CREATE TABLE IF NOT EXISTS admission_process_groups (
  lease_id TEXT NOT NULL REFERENCES custom_agent_leases(lease_id) ON DELETE CASCADE,
  pid INTEGER NOT NULL,
  start_id TEXT NOT NULL,
  PRIMARY KEY (lease_id, pid)
);
