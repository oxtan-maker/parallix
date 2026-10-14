-- Preserve existing evidence verbatim. Recording metadata was never stored;
-- row-level recorded_round is known, but no checkpoint-level round is inferred.
ALTER TABLE mission_checkpoints ADD COLUMN recording_json TEXT;
CREATE TABLE mission_checkpoint_versions (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL,
  recorded_at TEXT,
  recorded_round INTEGER,
  mission_revision INTEGER,
  PRIMARY KEY (mission_id, version)
);
INSERT INTO mission_checkpoint_versions
SELECT c.mission_id, ROW_NUMBER() OVER (PARTITION BY c.mission_id ORDER BY c.position), c.name,
  json_patch(json_object('missionId', c.checkpoint_mission_id, 'name', c.name,
    'rawFilename', c.raw_filename, 'firstLine', c.first_line,
    'nextActionText', c.next_action_text, 'repair', json(c.repair_json)),
    json_object('goalCheck', json(COALESCE((
      SELECT json_group_array(json(row_json)) FROM (
        SELECT json_patch(json_object('criterion', g.criterion, 'evidence', g.evidence,
          'recordedRound', g.recorded_round, 'repairedGate', g.repaired_gate,
          'repairedGates', json(g.repaired_gates)), '{}') AS row_json
        FROM mission_checkpoint_goal_checks g
        WHERE g.mission_id = c.mission_id AND g.checkpoint_position = c.position
        ORDER BY g.position
      )
    ), '[]')))), NULL, NULL, NULL
FROM mission_checkpoints c;

-- Null means the boundary predates capture; never reconstruct it from today's evidence.
CREATE TABLE mission_review_checkpoint_states (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number >= 1),
  state_json TEXT,
  PRIMARY KEY (mission_id, round_number)
);
INSERT INTO mission_review_checkpoint_states (mission_id, round_number, state_json)
SELECT mission_id, round_number, NULL FROM mission_review_rounds;
