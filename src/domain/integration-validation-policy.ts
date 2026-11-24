export interface IntegrationValidationMarker {
  /** The mission the validated hooks belong to. */
  readonly missionId: string;
  /** The validating commit: the mission branch HEAD the green suite ran against. */
  readonly sha: string;
  /** The whitelist of validated high-level test hook keys. */
  readonly hooks: readonly string[];
}

/**
 * Build and validate a marker. The whitelist must be a non-empty list of
 * distinct non-empty keys; a marker with no validated hooks is meaningless and
 * rejected so it can never accidentally authorize a full skip.
 */
export function buildIntegrationValidationMarker(
  missionId: string,
  sha: string,
  hooks: readonly string[],
): IntegrationValidationMarker {
  if (!missionId || typeof missionId !== 'string') {
    throw new Error('integration-validation marker requires a mission id');
  }
  if (!sha || typeof sha !== 'string') {
    throw new Error('integration-validation marker requires a validating sha');
  }
  const normalized = Array.isArray(hooks)
    ? hooks.filter((hook): hook is string => typeof hook === 'string' && hook.length > 0)
    : [];
  const distinct = [...new Set(normalized)];
  if (distinct.length === 0) {
    throw new Error('integration-validation marker requires at least one validated hook');
  }
  return { missionId, sha, hooks: distinct };
}

/**
 * The repository-general bookkeeping rule (TASK-2646): a Backlog task record
 * under `backlog/tasks/` or `backlog/completed/`. Lane transitions and
 * integration closeout rewrite only these files, so a tree that differs from a
 * validated tree in nothing else exercises the same code, tests, and
 * configuration. Every other path — `src/`, `test/`, `config/`,
 * `workflow.config.json`, package manifests — is substantive.
 */
export const BOOKKEEPING_PATH_RULE = /^backlog\/(?:tasks|completed)\/[^/]+\.md$/;

/** True when `filePath` (repository-relative, `/`-separated) is bookkeeping only. */
export function isBookkeepingPath(filePath: string): boolean {
  return BOOKKEEPING_PATH_RULE.test(filePath);
}

/** External task catalog paths excluded from verification candidate inputs and rebase lineage continuity. */
export const isVerificationBookkeeping = (file: string): boolean =>
  file.startsWith('backlog/tasks/') || file.startsWith('backlog/completed/');

/** One completed Git rebase: the pre-rebase HEAD and the rebased HEAD. */
export interface CompletedRebaseStep {
  readonly from: string;
  readonly to: string;
}

/**
 * The completed rebases that carry a validated commit to a later one, as
 * proven by the repository's completed-rebase recorder. Rebase content is
 * deliberately not compared: formal origin CI validates the actual candidate.
 */
export type CompletedRebaseLineage = readonly CompletedRebaseStep[];

export interface PassingIntegrationGateReceipt {
  readonly gateRunId: string | null;
  readonly revision: string;
  readonly status: 'running' | 'passed' | 'failed' | 'cancelled';
  readonly current: boolean;
  readonly carried: CompletedRebaseLineage | null;
  readonly gates: readonly { readonly key: string; readonly command: string }[];
  readonly outcomes: readonly { readonly key: string; readonly command: string; readonly exitCode: number | null }[];
}

/**
 * Whether one executor-owned receipt proves the complete configured plan for
 * the candidate. Exact policy-action restart reuse requires the recorded SHA;
 * landing also accepts adapter-proven equivalent inputs or completed-rebase
 * lineage. Missing identity, incomplete plans and every non-passing verdict
 * fail closed to execution.
 */
export function passingIntegrationReceiptApplies(
  receipt: PassingIntegrationGateReceipt | null | undefined,
  finalizedCommit: string | null | undefined,
  configured: readonly { readonly key: string; readonly command: string }[],
  mode: 'exact' | 'equivalent',
): receipt is PassingIntegrationGateReceipt {
  if (!receipt || receipt.status !== 'passed' || !receipt.gateRunId || !finalizedCommit || configured.length === 0) { return false; }
  const revisionCovered = mode === 'exact'
    ? receipt.current && receipt.revision === finalizedCommit
    : receipt.current || Boolean(receipt.carried?.length);
  if (!revisionCovered || receipt.gates.length !== configured.length || receipt.outcomes.length !== configured.length) { return false; }
  return configured.every(gate =>
    receipt.gates.filter(ran => ran.key === gate.key && ran.command === gate.command).length === 1
    && receipt.outcomes.filter(outcome => outcome.key === gate.key && outcome.command === gate.command && outcome.exitCode === 0).length === 1);
}
