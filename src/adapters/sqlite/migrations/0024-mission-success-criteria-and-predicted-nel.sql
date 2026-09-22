-- TASK-2521.03: record success criteria and the predicted NEL bucket as Mission state.
--
-- Corrects two claims in 0021, which is immutable:
--
--   * The predicted NEL bucket was dropped there as modelled by
--     classifyNelBucket(). That classifier buckets the *measured* NEL and cannot
--     express a prediction; handoff compares the two for the calibration ADR 0047
--     describes, so the prediction is Mission state again.
--   * Dependencies were said to be owned by "the task source". There is no task
--     source: the Mission aggregate is the only task record, and Mission-to-Mission
--     references are TASK-2521.04's to model.
--
-- Success criteria were a section of the retired mission document with no
-- recorded replacement. Checkpoint Goal Check rows and review verify against them.
ALTER TABLE missions ADD COLUMN predicted_nel_bucket TEXT
  CHECK (predicted_nel_bucket IS NULL OR predicted_nel_bucket IN ('Small', 'Medium', 'Large'));

CREATE TABLE mission_success_criteria (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  criterion TEXT NOT NULL CHECK (length(criterion) BETWEEN 1 AND 512),
  PRIMARY KEY (mission_id, position),
  UNIQUE (mission_id, criterion)
);
