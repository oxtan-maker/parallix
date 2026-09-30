-- Why an approval was withdrawn, as a typed fact (TASK-2620).  Detection of
-- an integration repair reads the cause, never the free-text reason.  The
-- gate, its command and an output tail name the red integration gate so the
-- repaired mission and its re-review can show what failed.
ALTER TABLE mission_review_rounds ADD COLUMN revoked_cause TEXT;
ALTER TABLE mission_review_rounds ADD COLUMN revoked_gate TEXT;
ALTER TABLE mission_review_rounds ADD COLUMN revoked_gate_command TEXT;
ALTER TABLE mission_review_rounds ADD COLUMN revoked_gate_log TEXT;

-- Revocations recorded before causes were typed carry their cause only in
-- the workflow's fixed reason text; classify them once here.
UPDATE mission_review_rounds
   SET revoked_cause = 'integration-gate-failure'
 WHERE revoked_at IS NOT NULL
   AND revoked_by = 'workflow'
   AND revoked_reason LIKE 'Integration gates failed;%';
UPDATE mission_review_rounds
   SET revoked_cause = 'operator'
 WHERE revoked_at IS NOT NULL
   AND revoked_cause IS NULL
   AND revoked_by <> 'workflow';
