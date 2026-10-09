import type { ReboundContext, ReboundReason } from './rebound-kernel.js';
import type { FixPromptSlots } from './rebound-prompts.js';
import { reboundDiagnostic } from '../domain/rebound-policy.js';
import { captureRecoveryEvidence, failureIncidentFingerprint, listRecoveryEvidence, resolveConfiguredCredentialRedactor, type RecoveryEvidenceRef } from './recovery-evidence.js';
/**
 * Attach a retrieval route to a repair prompt from evidence already on disk.
 *
 * The current failure's own record is captured by the caller before the kernel
 * runs; here we read what is durable at prompt-build time (the original and any
 * prior retries) so a fresh-context or restarted agent still sees the series. */
export function recoveryEvidenceForPrompt(worktree: string, missionId: string): Pick<FixPromptSlots, 'recoveryEvidence' | 'recoveryEvidenceRecent' | 'recoveryEvidenceError'> {
  // Use the same mission identity as capture, including custom worktree names.
  const recent = listRecoveryEvidence({ cwd: worktree, missionId });
  return {
    recoveryEvidence: recent[0] ?? null,
    recoveryEvidenceRecent: recent,
    recoveryEvidenceError: recent.length === 0 ? 'no retained evidence for this mission' : null,
  };
}

/**
 * Persist attributable, retrievable evidence of the original failed gate before
 * any repair launches. Some repair paths (notably the handoff gate path, which
 * runs the gate through `runVerificationGateFn` and never calls
 * `captureVerifiedTreeProof`) reach the kernel without having written evidence;
 * capturing here makes evidence delivery uniform across every launch path. Only
 * a verification gate is captured: a `gate-failure` reason names the exact
 * command, working directory, exit/signal, and captured stdout/stderr that the
 * process produced. The record is written to the worktree store, so a
 * fresh-context or restarted agent can read it even though it never saw the
 * failed command. A write failure reports `undefined` rather than hiding the
 * failure or inventing a complete-evidence claim.
 */
export async function captureGateFailureEvidence(
  reason: ReboundReason,
  worktree: string,
  context: ReboundContext,
): Promise<RecoveryEvidenceRef | undefined> {
  if (reason.kind !== 'gate-failure') { return undefined; }
  const capturedRevision = context.readHead ? (await context.readHead()) : context.head ?? null;
  // Obtain and pass the operator-configured credential redactor so the retained
  // streams are scrubbed before write when one is configured, and `redacted`
  // honestly reflects whether it ran (mission success criterion).
  const redactor = resolveConfiguredCredentialRedactor();
  const result = captureRecoveryEvidence({
    command: reason.command,
    cwd: worktree,
    capturedRevision,
    exitCode: reason.exitCode,
    signal: null,
    stdout: reason.stdout ?? '',
    stderr: reason.stderr ?? '',
    diagnostic: reason.error ?? reboundDiagnostic(reason),
    missionId: context.slug,
    ...(redactor ? { redactor } : {}),
  });
  return result.ok ? result.ref : undefined;
}

/**
 * Persist a failed repair retry as the next evidence attempt in the same
 * incident as the original failure, so a restarted agent can see the whole
 * recovery series (original plus every relaunch) rather than only the latest.
 *
 * The kernel captures the original failure once up front; each subsequent
 * `verify()` failure reaches this point. The fingerprint is the failing gate's
 * identity (command, working directory, exit) and is stable across the repair
 * loop: the implementer commits between relaunches, so the revision moves and
 * the diagnostic text changes, but the gate still fails. Grouping on the gate
 * identity keeps every relaunch in the original incident instead of opening a
 * new incident per relaunch and stranding the series behind only the latest
 * failure. The attempt number advances within the incident so each failure
 * keeps its own record instead of overwriting the original.
 */
export async function captureRetryEvidence(
  state: { reason: ReboundReason },
  worktree: string,
  context: ReboundContext,
): Promise<RecoveryEvidenceRef | undefined> {
  if (!worktree || state.reason.kind !== 'gate-failure') { return undefined; }
  const reason = state.reason;
  const capturedRevision = context.readHead ? (await context.readHead()) : context.head ?? null;
  const diagnostic = reason.error ?? reboundDiagnostic(reason);
  // Fingerprint omits exit status (F7): the same gate legitimately fails with a
  // different or signalled exit on a retry, and grouping on it would split the
  // recovery series. Command plus cwd uniquely identify the gate.
  const fingerprint = failureIncidentFingerprint({
    command: reason.command,
    cwd: worktree,
  });
  // `lookupRecoveryEvidence` resolves only a named incident; without an id it
  // returns `{ ok: false }`. Match the retry to its incident by fingerprint.
  // Among the matching records, advance from the highest attempt, not the most
  // recently captured: two captures in the same millisecond share a
  // `capturedAt`, so ordering by recency is unreliable and selecting the newest
  // would re-advance from the oldest record and overwrite the prior attempt.
  const sameIncidentRef = listRecoveryEvidence({ cwd: worktree, missionId: context.slug })
    .filter((record) => record.incidentId === fingerprint)
    .reduce<RecoveryEvidenceRef | undefined>((best, record) =>
      best === undefined || record.attempt > best.attempt ? record : best, undefined);
  const sameIncident = sameIncidentRef !== undefined;
  const attempt = sameIncident ? sameIncidentRef.attempt + 1 : 1;
  // Re-resolve the configured redactor for this attempt too: a retry is a fresh
  // capture of the same gate, so it honours the same credential-redaction
  // policy. The resolver is a pure function of configuration, so it returns the
  // same redactor (or `null`) as the original capture, keeping the series
  // consistent. `redacted` then honestly reflects redaction across the series.
  const redactor = resolveConfiguredCredentialRedactor();
  const result = captureRecoveryEvidence({
    command: reason.command,
    cwd: worktree,
    capturedRevision,
    exitCode: reason.exitCode,
    signal: null,
    stdout: reason.stdout ?? '',
    stderr: reason.stderr ?? '',
    diagnostic,
    missionId: context.slug,
    ...(sameIncident ? { incidentId: fingerprint } : {}),
    ...(attempt > 1 ? { attempt } : {}),
    ...(redactor ? { redactor } : {}),
  });
  return result.ok ? result.ref : undefined;
}

/** Prompt slots derived from a structured reason. */
