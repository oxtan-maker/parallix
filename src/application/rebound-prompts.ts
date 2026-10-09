import type { ReboundReason, ReboundClassification } from '../domain/rebound-policy.js';
import type { RecoveryEvidenceRef } from './recovery-evidence.js';
import { elideBounceOutput } from './output-elision.js';
import { isIncompleteSuccessCriteriaFailure, buildSuccessCriteriaRecoveryAdvice } from './typed-mission-recovery-advice.js';
export interface FixPromptSlots {
  /** Failure banner (`PRE-REVIEW GATE FAILURE`, …). */
  label: string;
  slug: string;
  worktree?: string;
  /** Verification area, hook identity, or agent role — whatever names the failure. */
  area: string;
  /** Structured facts printed above the diagnostic. */
  facts: Array<[string, string]>;
  diagnostic: string;
  /** First diagnostic for this recovery occurrence, retained across retries. */
  originalDiagnostic?: string;
  classification: ReboundClassification;
  attempt: number;
  maxAttempts: number;
  /** What passing looks like, in the implementer's terms. */
  remedy: string;
  repairCheckpoint?: { name: string; version: number } | null;
  /**
   * Retained evidence of the original failed command, when present. Attached so
   * the prompt names what was captured rather than restating a truncated inline
   * diagnostic. The current failure's own record is included when already on
   * disk; prior original/retry records are the actionable fallback.
   */
  recoveryEvidence?: RecoveryEvidenceRef | null;
  /** Related retained incidents when the requested record is unavailable. */
  recoveryEvidenceRecent?: readonly RecoveryEvidenceRef[] | null;
  /** Honest reason the current failure is not itself retrievable yet. */
  recoveryEvidenceError?: string | null;
}

/**
 * The one fix-prompt builder. Every rebound prompt — gate, hook, and the kinds
 * TASK-2377.04/.05 migrate — is built here, so the context-compaction
 * boilerplate and the automatic re-verify statement exist in one location.
 */
export function buildReboundFixPrompt(slots: FixPromptSlots): string {
  const { label, slug, worktree, facts, diagnostic, originalDiagnostic, classification, attempt, maxAttempts, remedy } = slots;
  return [
    `${label} — FIX REQUIRED`,
    ``,
    `Mission: ${slug}`,
    ...(worktree ? [`Working directory: ${worktree}`] : []),
    ...facts.map(([name, value]) => `${name}: ${value}`),
    ``,
    `Failure output (use this to diagnose and fix):`,
    `---`,
    elideBounceOutput(diagnostic || '(no output)'),
    `---`,
    ...(originalDiagnostic && originalDiagnostic !== diagnostic ? [
      `Original failure output (retain this evidence while repairing the later failure):`,
      `---`,
      elideBounceOutput(originalDiagnostic),
      `---`,
    ] : []),
    ``,
    `Classification: ${classification.failureClass} — ${classification.dispatchAction}`,
    `Retry attempt: ${attempt}/${maxAttempts}`,
    ``,
    ...recoveryEvidenceRoute(slots),
    ...repairAuthorityRoute(slots),
    ``,
    `Before repair work, compact the aborted working context. Reload the locked mission goal and scope; committed checkpoint or gate evidence when present; this exact gate diagnostic and classification; retry attempt ${attempt}/${maxAttempts}; current review round and disposition; unresolved findings and implementer resolutions; and the current branch revision.`,
    ``,
    remedy,
    `Perform this stage-specific repair now; do not only describe or plan it. Verify the required result and report any remaining exact failure.`,
    `The failing check re-runs automatically after your fix; this bounce is only reported as fixed when that re-run passes.`,
  ].join('\n');
}

/**
 * Repair authority for a gate or hook rebound (TASK-2575). The failed check and
 * its logs are evidence, not a verdict: the prompt names no cause, repair
 * location, or commit, so an implementer who traces the failure to the
 * environment or runner configuration repairs it there, and one who finds an
 * external blocker reports it instead of spending the budget on guesses.
 */
const REPAIR_AUTHORITY = 'Diagnose the actual cause from the failed check and its logs; do not assume it is a test or code path inside the original mission scope. Repair the cause wherever it lies within your authority (repository code, tests, configuration, the local environment, or runner configuration); do not alter locked gates, success criteria, or test invariants and fix the mission without breaking the repository: preserve the mission deliverables and safety boundaries, and never weaken, skip, or delete a check to make it pass. If the repair changes tracked files, commit it before the automatic re-verification: the re-run verifies the committed mission tree, so an uncommitted repair cannot be verified and is reported as still failing. A repair outside the repository needs no commit. If the cause is external and you cannot repair it (for example a model service or network dependency that is down), make no speculative changes: report the exact blocker with its evidence and stop, because another repair attempt cannot fix it.';

function missionOutcomeFact(slug: string): [string, string] {
  return ['Mission outcome', `the locked goal and success criteria of ${slug} (px status ${slug}), delivered with this check passing`];
}

/**
 * The second and final repair gets a fresh context rather than another version
 * of the targeted prompt.  The failure output is evidence, not a diagnosis:
 * the worker must be free to investigate the actual cause in the worktree.
 */
export function buildFreshDiagnosticRepairPrompt(slots: FixPromptSlots): string {
  const { label, slug, worktree, facts, diagnostic, originalDiagnostic, classification, attempt, maxAttempts, remedy } = slots;
  return [
    `${label} — FRESH-CONTEXT DIAGNOSTIC REPAIR REQUIRED`,
    '',
    `Mission: ${slug}`,
    ...(worktree ? [`Working directory: ${worktree}`] : []),
    ...facts.map(([name, value]) => `${name}: ${value}`),
    '',
    'Original failure evidence (this is not necessarily the root cause):',
    '---',
    elideBounceOutput(originalDiagnostic || '(no output)'),
    '---',
    'Latest failure evidence (this is not necessarily the root cause):',
    '---',
    elideBounceOutput(diagnostic || '(no output)'),
    '---',
    '',
    `Classification: ${classification.failureClass} — ${classification.dispatchAction}`,
    `Recovery strategy: fresh-diagnostic (${attempt}/${maxAttempts})`,
    `Retry attempt: ${attempt}/${maxAttempts}`,
    '',
    ...recoveryEvidenceRoute(slots),
    ...repairAuthorityRoute(slots),
    '',
    'You have a fresh context. Re-diagnose the failure from the repository and exact evidence; do not assume either diagnostic identifies the root cause.',
    'The locked mission goal and scope remain binding. Preserve all gate and test invariants: do not weaken, bypass, replace, or claim to satisfy any check.',
    remedy,
    'Perform the repair, preserve valid committed work already in the mission worktree, and commit your repair. Only the harness rerunning this exact failing check can establish success.',
  ].join('\n');
}

/**
 * A bounded, honest retrieval route for retained command evidence.
 *
 * The retained output is unabridged on disk (only the inline diagnostic is
 * truncated), so the omitted middle is retrievable. A fresh-context agent
 * receives evidence references — absolute paths in the mission worktree — not
 * the previous model's assumptions, and a process restart does not invalidate
 * them: the paths and incident fingerprint are stable across processes. When a
 * record is missing, truncated, expired, or access-denied, the route states it
 * and points at related incidents rather than claiming completeness.
 */
/** Earlier agent runs (TASK-2643): one compact pointer, never transcript text. */
const RUN_HISTORY_ROUTE = 'Earlier agent runs of this mission are searchable with `px history search <pattern>` and `px history show <ref>` (bounded; cite the run: references).';

export function recoveryEvidenceRoute(slots: Pick<FixPromptSlots, 'recoveryEvidence' | 'recoveryEvidenceRecent' | 'recoveryEvidenceError'>): string[] {
  if (slots.recoveryEvidence) {
    const e = slots.recoveryEvidence;
    const route = [
      `Retained evidence for this failure (unabridged; retrieve the omitted middle from these):`,
      `  command: ${e.command}`,
      `  worked from: ${e.cwd}`,
      `  captured revision: ${e.capturedRevision ?? 'not resolved'}`,
      `  exit code: ${e.exitCode ?? 'none'}${e.signal ? ` (signal ${e.signal})` : ''}`,
      `  attempt ${e.attempt} of the retained series; incident ${e.incidentId.slice(0, 12)}…`,
      `  stdout: ${e.stdoutPath}${e.truncatedFrom === 'stdout' ? ' (truncated — see capture-completeness note)' : ''}`,
      `  stderr: ${e.stderrPath}${e.truncatedFrom === 'stderr' ? ' (truncated — see capture-completeness note)' : ''}`,
      `  capture complete: ${e.captureComplete ? 'yes' : 'no'}${e.redacted ? '; redacted per configured credential redaction' : ''}`,
      `Retrieve or search more retained output for this mission with: listRecoveryEvidence({ cwd }) or lookupRecoveryEvidence({ cwd, incidentId: "${e.incidentId}" }).`,
      RUN_HISTORY_ROUTE,
    ];
    return ['', ...route, ''];
  }
  const lines: string[] = ['', 'No retained evidence for this failure is available yet', RUN_HISTORY_ROUTE, ''];
  if (slots.recoveryEvidenceError) { lines.push(`Reason: ${slots.recoveryEvidenceError}.`); }
  if (slots.recoveryEvidenceRecent && slots.recoveryEvidenceRecent.length > 0) {
    lines.push('Related retained failures (act on these):');
    for (const r of slots.recoveryEvidenceRecent) {
      lines.push(`  incident ${r.incidentId.slice(0, 12)}… attempt ${r.attempt}: ${r.command} (exit ${r.exitCode ?? 'none'})`);
    }
  }
  return lines;
}


export function promptSlotsFor(reason: ReboundReason, slug: string): Pick<FixPromptSlots, 'area' | 'facts' | 'remedy'> {
  switch (reason.kind) {
    case 'gate-failure':
      return {
        area: reason.area,
        facts: [
          ['Area', reason.area],
          ['Gate command', reason.command],
          missionOutcomeFact(slug),
          ['Exit code', String(reason.exitCode)],
          ...(reason.approvedRevision
            ? [['Approved revision', reason.approvedRevision] as [string, string]]
            : []),
          ['Cause', 'The integration gate (not the review gate) failed: the mission was reviewed and approved, then a red pre-integration gate rejected the finalized tree on the way to a human integration. Repair the integration failure, not a review finding.'],
          ...(reason.coverageNote ? [['Coverage', reason.coverageNote] as [string, string]] : []),
        ],
        remedy: `Start with the listed gate command in the listed worktree and the captured failure output. Do not substitute a broader verification command or integration suite to rediscover the failure. ${REPAIR_AUTHORITY}`,
      };
    case 'hook-failure':
      return {
        area: reason.hook || 'hook',
        facts: [
          ['Hook type', reason.hook || 'unknown'],
          ...(reason.operation ? [['Git operation', reason.operation] as [string, string]] : []),
          ['Failed check', `${reason.hook || 'Git'} hook on ${reason.operation || 'a workflow Git operation'}`],
          missionOutcomeFact(slug),
        ],
        remedy: `Make the Git hook pass when Parallix commits or rebases this mission. ${REPAIR_AUTHORITY}`,
      };
    case 'artifact-incomplete':
      return {
        area: reason.role,
        facts: [['Role', reason.role]],
        remedy: `Produce the complete ${reason.role} artifacts the workflow requires.`,
      };
    case 'agent-timeout':
      return {
        area: reason.role,
        facts: [['Role', reason.role], ...(reason.expectedOutput ? [['Required output', reason.expectedOutput] as [string, string]] : [])],
        remedy: `Produce ${reason.expectedOutput || `the missing ${reason.role} output`} and report it through the normal review artifact or provider path.`,
      };
    case 'handoff-verification':
      return {
        area: 'handoff',
        facts: [['Handoff error', reason.error]],
        remedy: isIncompleteSuccessCriteriaFailure(reason.error)
          ? buildSuccessCriteriaRecoveryAdvice(slug)
          : `Fix the underlying issue so handoff verification passes.`,
      };
    case 'declared-gate-validation':
      return {
        area: 'declared gate',
        facts: [['Gate command', reason.command]],
        remedy: 'Stop and request an operator decision for this mechanically invalid declaration; do not replace your own locked check.',
      };
  }
  // Unreachable for the closed union; kept out of the switch for exhaustiveness.
}


/** Same authority for resumed and fresh sessions; overrides generic launcher instructions. */
function repairAuthorityRoute(slots: FixPromptSlots): string[] {
  const cp = slots.repairCheckpoint;
  return [
    'REPAIR AUTHORITY: These dedicated instructions govern this session, including resumed execute or act-on-review context. Preserve locked gates, success criteria and test invariants. An invalid locked contract requires human review; never rewrite your own checks.',
    'Only a successful harness rerun of the authorized required check establishes repair success; an unrelated passing test or an agent claim does not.',
    ...(cp ? [
      `Harness-created repair checkpoint: ${cp.name}; Version at launch: ${cp.version}. Reload px status ${slots.slug} for the current Version before writing.`,
      `Write only authorized repair evidence to ${cp.name} using px checkpoint record --name ${cp.name} --criterion "<exact affected success criterion>" --evidence "<verifiable reference and result>" --next "<specific next action>" --expected-version <current Version>. Retain earlier implementation proof. Complete every remaining planned checkpoint before handoff.`,
      `If the locked contract is invalid, run px checkpoint report-invalid-contract --name ${cp.name} --command "<exact failing command>" --diagnostic "<exact diagnostic>" --authority-reason "<why operator authority is needed>" --proposed-correction "<operator correction>" --expected-version <current Version>, then stop. The first report stops automatic repair retries and routes the decision to human review.`,
    ] : ['Report an invalid locked contract with command, diagnostic, authorityReason and proposedCorrection, then stop for human review.']),
  ];
}
