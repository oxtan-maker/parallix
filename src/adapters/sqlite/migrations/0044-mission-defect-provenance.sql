-- Durable causal evidence for bug-labelled Missions. The disposition and
-- optional originating Mission are one checked value owned by the aggregate.
CREATE TABLE mission_defect_provenance (
  mission_id TEXT PRIMARY KEY NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  root_cause_summary TEXT NOT NULL CHECK (length(trim(root_cause_summary)) > 0),
  investigation_evidence TEXT NOT NULL CHECK (length(trim(investigation_evidence)) > 0),
  attribution_disposition TEXT NOT NULL CHECK (
    attribution_disposition IN ('originating-mission', 'external', 'pre-mission', 'unresolved')
  ),
  originating_mission_id TEXT REFERENCES missions(id),
  CHECK (
    (attribution_disposition = 'originating-mission'
      AND originating_mission_id IS NOT NULL
      AND originating_mission_id <> mission_id)
    OR
    (attribution_disposition <> 'originating-mission'
      AND originating_mission_id IS NULL)
  )
);

CREATE INDEX idx_mission_defect_provenance_origin
  ON mission_defect_provenance (originating_mission_id);
