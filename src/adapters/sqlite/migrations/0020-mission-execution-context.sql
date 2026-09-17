-- Typed, bounded launch context. Detailed artifacts remain references (ADR 0053).
CREATE TABLE mission_execution_contexts (
  mission_id TEXT PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
  goal TEXT NOT NULL CHECK (length(goal) BETWEEN 1 AND 4000),
  why_text TEXT NOT NULL CHECK (length(why_text) BETWEEN 1 AND 4000),
  scope_text TEXT NOT NULL CHECK (length(scope_text) BETWEEN 1 AND 4000),
  predicted_nel_bucket TEXT NOT NULL CHECK (predicted_nel_bucket IN ('small', 'medium', 'large')),
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  selection_note TEXT NOT NULL CHECK (length(selection_note) BETWEEN 1 AND 4000)
);
CREATE TABLE mission_execution_context_items (
  mission_id TEXT NOT NULL REFERENCES mission_execution_contexts(mission_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('constraint', 'driver', 'gate', 'dependency')),
  position INTEGER NOT NULL CHECK (position >= 0),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 512),
  outcome TEXT CHECK (outcome IS NULL OR length(outcome) BETWEEN 1 AND 512),
  PRIMARY KEY (mission_id, kind, position),
  CHECK ((kind = 'dependency') OR outcome IS NULL)
);
