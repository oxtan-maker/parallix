-- Existing criteria acquire mission-scoped IDs. Only exact current text matches
-- can identify legacy evidence; never infer an identity from position or wording.
ALTER TABLE missions ADD COLUMN next_success_criterion_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mission_success_criteria ADD COLUMN criterion_id TEXT;
UPDATE mission_success_criteria SET criterion_id = 'sc-' || (position + 1)
WHERE criterion_id IS NULL;
UPDATE missions SET next_success_criterion_id = COALESCE((
  SELECT MAX(position) + 2 FROM mission_success_criteria WHERE mission_id = missions.id
), 1)
WHERE EXISTS (SELECT 1 FROM mission_success_criteria WHERE mission_id = missions.id);
ALTER TABLE mission_checkpoint_goal_checks ADD COLUMN criterion_id TEXT;
UPDATE mission_checkpoint_goal_checks AS g SET criterion_id = (
  SELECT c.criterion_id FROM mission_success_criteria c
  WHERE c.mission_id = g.mission_id AND c.criterion = g.criterion
);

-- Retained versions may predate this forward migration. Preserve all evidence
-- and metadata while annotating only exact matches, including explicit nulls.
UPDATE mission_checkpoint_versions AS v SET checkpoint_json = json_set(checkpoint_json, '$.goalCheck', json(COALESCE((
  SELECT json_group_array(json(identified)) FROM (
    SELECT json_set(g.value, '$.criterionId', (
      SELECT c.criterion_id FROM mission_success_criteria c
      WHERE c.mission_id = v.mission_id AND c.criterion = json_extract(g.value, '$.criterion')
    )) AS identified FROM json_each(v.checkpoint_json, '$.goalCheck') g ORDER BY CAST(g.key AS INTEGER)
  )
), '[]')));
-- Earlier boundaries have no reliable round-time criteria contract. Do not
-- substitute today's criteria into a historical snapshot.
UPDATE mission_review_checkpoint_states SET state_json = json_set(state_json, '$.successCriteria', NULL, '$.uncoveredCriterionIds', NULL)
WHERE state_json IS NOT NULL;
