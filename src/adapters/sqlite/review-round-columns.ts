/** Persisted review-round fields shared by aggregate and batched projection reads. */
export const REVIEW_ROUND_COLUMNS = [
  'mission_id, position, round_number, change_kind, provider',
  'provider_change_id, provider_url, source_branch, target_branch',
  'revision, review_baseline, reviewer, implementer, started_at, decision_kind',
  'decided_at, decided_revision, decision_comment, classifier_source, integration_repair_assessment, mechanical_source, approval_source_kind',
  'approval_source_provider, revoked_at, revoked_by, revoked_reason, revoked_cause, revoked_gate, revoked_gate_command, revoked_gate_log',
  'superseded_at, superseding_revision, superseded_by, responded_at, resulting_revision',
  'phase, disposition, reviewer_retry_count, implementer_retry_count',
  'implementer_response_content, item_dispositions, blocked_reason',
].join(', ');
