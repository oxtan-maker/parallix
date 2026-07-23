-- Migration: 0002-import-history
-- Description: Add import history ledger for source path, digest, and idempotency tracking
-- Authority: operator-local only

CREATE TABLE IF NOT EXISTS import_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL,
  digest TEXT NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL,
  backup_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_import_history_source
  ON import_history(source_path);
