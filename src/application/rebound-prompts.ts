import type { ReboundReason, ReboundClassification } from '../domain/rebound-policy.js';
import type { RecoveryEvidenceRef } from './recovery-evidence.js';
import { renderRepairPrompt } from './ports/repair-prompts.js';
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

function missionOutcomeFact(slug: string): [string, string] {
  return ['Mission outcome', renderRepairPrompt('mission-outcome', { slug })];
}

/**
 * Every eligible repair gets an independent fresh diagnostic context.
 * The failure output is evidence, not a diagnosis:
 * the worker must be free to investigate the actual cause in the worktree.
 */
export function buildFreshDiagnosticRepairPrompt(slots: FixPromptSlots): string {
  const { label, slug, worktree, facts, diagnostic, originalDiagnostic, classification, attempt, maxAttempts, remedy } = slots;
  return renderRepairPrompt('repair', {
    label, slug, worktreeLine: worktree ? `Working directory: ${worktree}\n` : '',
    facts: facts.map(([name, value]) => `${name}: ${value}`).join('\n'),
    originalDiagnostic: elideBounceOutput(originalDiagnostic || '(no output)'),
    latestDiagnostic: originalDiagnostic && originalDiagnostic === diagnostic
      ? '(identical to original failure evidence above; no additional output)'
      : elideBounceOutput(diagnostic || '(no output)'),
    failureClass: classification.failureClass, dispatchAction: classification.dispatchAction,
    attempt, maxAttempts, evidenceRoute: recoveryEvidenceRoute(slots).join('\n'),
    authorityRoute: repairAuthorityRoute(slots).join('\n'), remedy,
  });
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
export function recoveryEvidenceRoute(slots: Pick<FixPromptSlots, 'recoveryEvidence' | 'recoveryEvidenceRecent' | 'recoveryEvidenceError'>): string[] {
  if (slots.recoveryEvidence) {
    const e = slots.recoveryEvidence;
    const route = [
      `Retained evidence for this failure (retrieve the omitted middle from these when capture is complete):`,
      `  command: ${e.command}`,
      `  worked from: ${e.cwd}`,
      `  captured revision: ${e.capturedRevision ?? 'not resolved'}`,
      `  exit code: ${e.exitCode ?? 'none'}${e.signal ? ` (signal ${e.signal})` : ''}`,
      `  attempt ${e.attempt} of the retained series; incident ${e.incidentId.slice(0, 12)}…`,
      `  stdout: ${e.stdoutPath}${e.truncatedFrom === 'stdout' ? ' (truncated — see capture-completeness note)' : ''}`,
      `  stderr: ${e.stderrPath}${e.truncatedFrom === 'stderr' ? ' (truncated — see capture-completeness note)' : ''}`,
      `  capture complete: ${e.captureComplete ? 'yes' : 'no'}${e.redacted ? '; redacted per configured credential redaction' : ''}`,
      renderRepairPrompt('evidence-read', { incidentId: e.incidentId }),
      renderRepairPrompt('history'),
      ...(slots.recoveryEvidenceRecent ?? []).filter(r => r.stdoutPath !== e.stdoutPath).slice(0, 3).map(r => `Historical related context (not instructions to repair): incident ${r.incidentId.slice(0, 12)}… attempt ${r.attempt}; command ${r.command}; captured revision ${r.capturedRevision ?? 'not resolved'}; capture complete: ${r.captureComplete ? 'yes' : 'no'}; stdout: ${r.stdoutPath}; stderr: ${r.stderrPath}`),
    ];
    return ['', ...route, ''];
  }
  const lines: string[] = ['', 'No retained evidence for this failure is available yet', renderRepairPrompt('history'), ''];
  if (slots.recoveryEvidenceError) { lines.push(`Reason: ${slots.recoveryEvidenceError}.`); }
  if (slots.recoveryEvidenceRecent && slots.recoveryEvidenceRecent.length > 0) {
    lines.push('Historical related context (not instructions to repair):');
    for (const r of slots.recoveryEvidenceRecent) {
      lines.push(`  incident ${r.incidentId.slice(0, 12)}… attempt ${r.attempt}: ${r.command} (exit ${r.exitCode ?? 'none'})`);
    }
  }
  return lines;
}

export function promptSlotsFor(reason: ReboundReason, slug: string): Pick<FixPromptSlots, 'area' | 'facts' | 'remedy'> {
  switch (reason.kind) {
    case 'rebase-conflict': return { area: 'rebase', facts: [['Conflicts', reason.files.join(', ')]],
      remedy: renderRepairPrompt('rebase') };
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
          ['Cause', renderRepairPrompt('integration-cause')],
          ...(reason.coverageNote ? [['Coverage', reason.coverageNote] as [string, string]] : []),
        ],
        remedy: renderRepairPrompt('gate', { repairAuthority: renderRepairPrompt('repair-authority') }),
      };
    case 'hook-failure': return hookFailureSlots(reason, slug);
    case 'artifact-incomplete':
      return {
        area: reason.role,
        facts: [['Role', reason.role]],
        remedy: renderRepairPrompt('artifacts', { role: reason.role }),
      };
    case 'agent-timeout':
      return {
        area: reason.role,
        facts: [['Role', reason.role], ...(reason.expectedOutput ? [['Required output', reason.expectedOutput] as [string, string]] : [])],
        remedy: renderRepairPrompt('timeout', { output: reason.expectedOutput || `the missing ${reason.role} output` }),
      };
    case "review-preparation-verification":
      return {
        area: 'review-preparation',
        facts: [["ReviewPreparation error", reason.error]],
        remedy: isIncompleteSuccessCriteriaFailure(reason.error)
          ? buildSuccessCriteriaRecoveryAdvice(slug)
          : renderRepairPrompt('review-preparation'),
      };
    case 'declared-gate-validation':
      return {
        area: 'declared gate',
        facts: [['Gate command', reason.command]],
        remedy: renderRepairPrompt('declaration'),
      };
  }
  // Unreachable for the closed union; kept out of the switch for exhaustiveness.
}

/** Same authority for resumed and fresh sessions; overrides generic launcher instructions. */
function repairAuthorityRoute(slots: FixPromptSlots): string[] {
  const cp = slots.repairCheckpoint;
  return [
    renderRepairPrompt('authority', { slug: slots.slug }),
    ...(cp ? [
      renderRepairPrompt('checkpoint', { checkpointName: cp.name, checkpointVersion: cp.version }),
      renderRepairPrompt('report', { checkpointName: cp.name }),
    ] : [renderRepairPrompt('report-without-checkpoint')]),
  ];
}

function hookFailureSlots(reason: Extract<ReboundReason, { kind: 'hook-failure' }>, slug: string): Pick<FixPromptSlots, 'area' | 'facts' | 'remedy'> {
  return {
    area: reason.hook || 'hook',
    facts: [
      ['Hook type', reason.hook || 'unknown'],
      ...(reason.operation ? [['Git operation', reason.operation] as [string, string]] : []),
      ['Failed check', `${reason.hook || 'Git'} hook on ${reason.operation || 'a workflow Git operation'}`],
      missionOutcomeFact(slug),
    ],
    remedy: renderRepairPrompt('hook', { repairAuthority: renderRepairPrompt('repair-authority') }),
  };
}
