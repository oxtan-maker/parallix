import { recognizedFailureReason } from '../domain/failure-reason.js';
import type { ReboundReason, ReboundClassification } from '../domain/rebound-policy.js';
import type { RecoveryEvidenceRef } from './recovery-evidence.js';
import { renderRepairPrompt } from './ports/repair-prompts.js';
import { elideBounceOutput } from './output-elision.js';
import { buildSuccessCriteriaRecoveryAdvice } from './typed-mission-recovery-advice.js';
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
  repairCheckpointRefs?: readonly { gateKey: string; command: string; name: string; version: number }[];
  /**
   * Retained evidence of the original failed command, when present. Attached so
   * the prompt names what was captured rather than restating a truncated inline
   * diagnostic. The current failure's own record is included when already on
   * disk; prior original/retry records are the actionable fallback.
   */
  recoveryEvidence?: RecoveryEvidenceRef | null;
  recoveryEvidenceAll?: readonly { gateKey: string; evidence: RecoveryEvidenceRef }[];
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
export function recoveryEvidenceRoute(slots: Pick<FixPromptSlots, 'recoveryEvidence' | 'recoveryEvidenceAll' | 'recoveryEvidenceRecent' | 'recoveryEvidenceError'>): string[] {
  if (slots.recoveryEvidenceAll?.length) { return aggregateEvidenceRoute(slots.recoveryEvidenceAll); }
  if (slots.recoveryEvidence) { return singleEvidenceRoute(slots.recoveryEvidence, slots.recoveryEvidenceRecent); }
  return unavailableEvidenceRoute(slots.recoveryEvidenceRecent, slots.recoveryEvidenceError);
}

function aggregateEvidenceRoute(evidence: NonNullable<FixPromptSlots['recoveryEvidenceAll']>): string[] {
  return ['', 'Retained evidence for every failed gate in this integration execution:',
    ...evidence.flatMap(({ gateKey, evidence: item }) => [
      `  ${gateKey}: ${item.command} (exit ${item.exitCode ?? 'none'}${item.signal ? `, signal ${item.signal}` : ''})`,
      `    captured revision: ${item.capturedRevision ?? 'not resolved'}; capture complete: ${item.captureComplete ? 'yes' : 'no'}`,
      `    stdout: ${item.stdoutPath}`,
      `    stderr: ${item.stderrPath}`,
      `    ${renderRepairPrompt('evidence-read', { incidentId: item.incidentId })}`,
    ]), renderRepairPrompt('history'), ''];
}

function singleEvidenceRoute(evidence: RecoveryEvidenceRef,
  recent: FixPromptSlots['recoveryEvidenceRecent']): string[] {
  const route = [
    `Retained evidence for this failure (retrieve the omitted middle from these when capture is complete):`,
    `  command: ${evidence.command}`,
    `  worked from: ${evidence.cwd}`,
    `  captured revision: ${evidence.capturedRevision ?? 'not resolved'}`,
    `  exit code: ${evidence.exitCode ?? 'none'}${evidence.signal ? ` (signal ${evidence.signal})` : ''}`,
    `  attempt ${evidence.attempt} of the retained series; incident ${evidence.incidentId.slice(0, 12)}…`,
    `  stdout: ${evidence.stdoutPath}${evidence.truncatedFrom === 'stdout' ? ' (truncated — see capture-completeness note)' : ''}`,
    `  stderr: ${evidence.stderrPath}${evidence.truncatedFrom === 'stderr' ? ' (truncated — see capture-completeness note)' : ''}`,
    `  capture complete: ${evidence.captureComplete ? 'yes' : 'no'}${evidence.redacted ? '; redacted per configured credential redaction' : ''}`,
    renderRepairPrompt('evidence-read', { incidentId: evidence.incidentId }),
    renderRepairPrompt('history'),
    ...(recent ?? []).filter(item => item.stdoutPath !== evidence.stdoutPath).slice(0, 3)
      .map(item => `Historical related context (not instructions to repair): incident ${item.incidentId.slice(0, 12)}… attempt ${item.attempt}; command ${item.command}; captured revision ${item.capturedRevision ?? 'not resolved'}; capture complete: ${item.captureComplete ? 'yes' : 'no'}; stdout: ${item.stdoutPath}; stderr: ${item.stderrPath}`),
  ];
  return ['', ...route, ''];
}

function unavailableEvidenceRoute(recent: FixPromptSlots['recoveryEvidenceRecent'], error?: string | null): string[] {
  const lines: string[] = ['', 'No retained evidence for this failure is available yet', renderRepairPrompt('history'), ''];
  if (error) { lines.push(`Reason: ${error}.`); }
  if (recent?.length) {
    lines.push('Historical related context (not instructions to repair):');
    for (const item of recent) {
      lines.push(`  incident ${item.incidentId.slice(0, 12)}… attempt ${item.attempt}: ${item.command} (exit ${item.exitCode ?? 'none'})`);
    }
  }
  return lines;
}

type PromptSlots = Pick<FixPromptSlots, 'area' | 'facts' | 'remedy'>;

export function promptSlotsFor(reason: ReboundReason, slug: string): PromptSlots {
  switch (reason.kind) {
    case 'rebase-conflict': return { area: 'rebase', facts: [['Conflicts', reason.files.join(', ')]],
      remedy: renderRepairPrompt('rebase') };
    case 'gate-failure': return gateFailurePromptSlots(reason, slug);
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
        remedy: recognizedFailureReason(reason.failureReason)?.code === 'incomplete-success-criteria'
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

function gateFailurePromptSlots(reason: Extract<ReboundReason, { kind: 'gate-failure' }>, slug: string): PromptSlots {
  const facts: Array<[string, string]> = [
    ['Area', reason.area],
    ['Gate command', reason.command],
    missionOutcomeFact(slug),
    ['Exit code', String(reason.exitCode)],
  ];
  if (reason.approvedRevision) { facts.push(['Approved revision', reason.approvedRevision]); }
  if (reason.testedRevision) { facts.push(['Tested revision', reason.testedRevision]); }
  for (const failure of reason.relatedFailures ?? []) {
    facts.push([`Also failed: ${failure.gate}`,
      `${failure.command} (exit ${failure.exitCode ?? 'unknown'}${failure.signal ? `, signal ${failure.signal}` : ''})\n${[failure.stdout, failure.stderr].filter(Boolean).join('\n')}`]);
  }
  for (const gate of reason.blockedGates ?? []) {
    facts.push([`Blocked: ${gate.gate}`, `not run; blocked by ${gate.blockedBy.join(', ')}`]);
  }
  for (const gate of reason.cancelledGates ?? []) {
    facts.push([`Cancelled: ${gate}`, 'operator cancellation; not a repair obligation']);
  }
  facts.push(['Cause', renderRepairPrompt('integration-cause')]);
  if (reason.coverageNote) { facts.push(['Coverage', reason.coverageNote]); }
  return { area: reason.area, facts,
    remedy: renderRepairPrompt('gate', { repairAuthority: renderRepairPrompt('repair-authority') }) };
}

/** Same authority for resumed and fresh sessions; overrides generic launcher instructions. */
function repairAuthorityRoute(slots: FixPromptSlots): string[] {
  const cp = slots.repairCheckpoint;
  if (slots.repairCheckpointRefs?.length) {
    return [renderRepairPrompt('authority', { slug: slots.slug }),
      'Every failed gate below owns a durable repair checkpoint; record evidence for each affected criterion before verification:',
      ...slots.repairCheckpointRefs.flatMap(ref => [
        `- ${ref.gateKey}: ${ref.command} — ${ref.name} (Mission version ${ref.version})`,
        renderRepairPrompt('report', { checkpointName: ref.name }),
      ])];
  }
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
