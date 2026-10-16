CREATE TABLE workflow_operations (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  generation INTEGER NOT NULL,
  phase TEXT NOT NULL,
  record_json TEXT NOT NULL,
  UNIQUE(repository_id, mission_id, request_key)
);
CREATE UNIQUE INDEX workflow_exclusive_mission ON workflow_operations(repository_id, mission_id)
WHERE phase IN ('accepted', 'preparing', 'waiting', 'running', 'checking', 'stopping');
