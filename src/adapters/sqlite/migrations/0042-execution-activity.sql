DROP INDEX workflow_exclusive_mission;
UPDATE workflow_operations
SET phase = 'executing', record_json = json_set(record_json, '$.phase', 'executing')
WHERE phase IN ('preparing', 'waiting', 'running', 'checking');
UPDATE workflow_operations
SET record_json = json_set(record_json, '$.command', 'review:submit')
WHERE json_extract(record_json, '$.command') = 'handoff:record';
CREATE UNIQUE INDEX workflow_exclusive_mission ON workflow_operations(repository_id, mission_id)
WHERE phase IN ('accepted', 'executing', 'stopping');
-- This is live repair metadata, not an audit/version row. The value is the
-- workflow's internal non-gate marker; it must not be replayed as a shell check.
UPDATE mission_checkpoints
SET repair_json = json_set(repair_json, '$.command', 'review-preparation')
WHERE repair_json IS NOT NULL AND json_valid(repair_json)
  AND json_extract(repair_json, '$.command') = 'px handoff';

-- Early review entry and verified submission are separate durable boundaries.
ALTER TABLE missions ADD COLUMN review_preparation_pending INTEGER NOT NULL DEFAULT 0
  CHECK (review_preparation_pending IN (0, 1));

CREATE TABLE execution_activity (
  repository_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY(repository_id, mission_id)
);

-- The cutover assumes no running operations. Preserve unresolved failure facts
-- as current snapshots without changing any original audit row or its identity.
-- A later supported start supersedes a blocker; diagnostic recovery does not.
WITH history AS MATERIALIZED (
  SELECT id, event_data, created_at,
    json_extract(event_data, '$.missionId') AS mission_id,
    json_extract(event_data, '$.operationId') AS operation_id,
    json_extract(event_data, '$.state') AS state,
    json_extract(event_data, '$.phase') AS phase
  FROM operational_history
  WHERE event_type = 'mission.current-work' AND json_valid(event_data)
), blockers AS (
  SELECT h.* FROM history h
  WHERE h.state = 'blocked' AND h.phase IN ('draft','execute','waiting','handoff','review','review-response','integrate')
    AND NOT EXISTS (SELECT 1 FROM history later WHERE later.mission_id = h.mission_id
      AND later.id > h.id AND later.state = 'running' AND later.phase <> 'recovery')
    AND NOT EXISTS (SELECT 1 FROM history started WHERE started.mission_id = h.mission_id
      AND started.state = 'running' AND started.phase <> 'recovery'
      AND started.operation_id IS NOT NULL AND h.operation_id IS NOT NULL
      AND started.operation_id <> h.operation_id
      AND started.id = (SELECT MAX(id) FROM history newest WHERE newest.mission_id = h.mission_id
        AND newest.state = 'running' AND newest.phase <> 'recovery'))
), retained AS (
  SELECT b.*, COALESCE(NULLIF(b.operation_id, ''), 'cutover-history-row:' || b.id) AS execution_id
  FROM blockers b WHERE b.id = (SELECT MAX(id) FROM blockers latest WHERE latest.mission_id = b.mission_id)
)
INSERT INTO execution_activity (repository_id, mission_id, snapshot_json)
SELECT m.repository_id, r.mission_id, json_object(
  'missionId', r.mission_id, 'operationId', r.execution_id,
  'frames', json_array(json_object('sourceId', r.execution_id, 'event', json_set(r.event_data,
    '$.operationId', r.execution_id, '$.phase', CASE r.phase WHEN 'handoff' THEN 'review' ELSE r.phase END,
    '$.occurredAt', r.created_at, '$.processId', NULL,
    '$.blockedReason', COALESCE(json_extract(r.event_data, '$.blockedReason'), 'operation cannot continue autonomously')))),
  'closedSources', json_array(), 'supersededOperations', json_array(),
  'retainedBlocker', NULL, 'terminal', NULL)
FROM retained r JOIN missions m ON m.id = r.mission_id;

-- Activity has one persistence owner after cutover.
UPDATE workflow_operations SET record_json = json_remove(record_json, '$.activities')
WHERE json_type(record_json, '$.activities') IS NOT NULL;
