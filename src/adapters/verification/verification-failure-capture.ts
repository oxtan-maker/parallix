import { captureRecoveryEvidence, resolveConfiguredCredentialRedactor } from '../../application/recovery-evidence.js';
import type { PublishedTreeStateOk, VerificationGateResult, captureVerifiedTreeProof } from './verification.js';

const BOUNDED_VERIFIER_OUTPUT = 8000;

export function captureFailedVerification(before: PublishedTreeStateOk, verification: VerificationGateResult, command: string | null): ReturnType<typeof captureVerifiedTreeProof> {
  // Preserve the structured root failure end-to-end: the exact exit status
  // plus bounded captured stdout/stderr, so an outer Forgejo/publish wrapper
  // cannot collapse a gate failure to an exit-code-only string and strand the
  // next agent (task-2373.01). The wrapper string is presentation only; the
  // structured fields below are what classification and repair prompting read.
  const stdout = String(verification.stdout ?? '').trim().slice(-BOUNDED_VERIFIER_OUTPUT);
  const stderr = String(verification.stderr ?? '').trim().slice(-BOUNDED_VERIFIER_OUTPUT);
  const detail = `${stdout}\n${stderr}`.slice(-BOUNDED_VERIFIER_OUTPUT);
  // Persist attributable, retrievable evidence of this failed command to the
  // mission worktree before any repair launches (TASK-2642). The worktree is
  // unique to one mission and one repository, so original and retry evidence
  // cannot overwrite or be confused with another concurrent mission. It is a
  // best-effort side effect: recording never blocks the failure that produced
  // it, so a write failure reports honestly on the returned ref rather than
  // hiding the gate failure. Obtain and pass the operator-configured
  // credential redactor so retained streams scrub before write (mission criterion).
  const redactor = resolveConfiguredCredentialRedactor();
  const capture = captureRecoveryEvidence({
    command: command ?? '',
    cwd: before.rootDir,
    capturedRevision: before.commit,
    exitCode: verification.status,
    signal: verification.signal ?? null,
    stdout: String(verification.stdout ?? ''),
    stderr: String(verification.stderr ?? ''),
    diagnostic: detail,
    ...(redactor ? { redactor } : {}),
  });
  return {
    ok: false,
    exitCode: verification.status,
    command,
    cwd: before.rootDir,
    stdout,
    stderr,
    error: `verification gate failed for ${before.rootDir} with exit code ${verification.status}${detail ? `:\n${detail}` : ''}`,
    ...(capture.ok ? { recoveryEvidence: capture.ref } : { recoveryEvidenceError: 'capture-failed' }),
  };
}
