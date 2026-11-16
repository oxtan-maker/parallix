import {
  RECOVERY_EVIDENCE_VERSION,
  type RecoveryEvidenceRef,
} from '../../src/application/recovery-evidence-types.js';

/** Complete retained-failure metadata for tests that exercise recovery ports. */
export function recoveryEvidenceRef(command: string, cwd: string, incidentId = 'fixture-incident'): RecoveryEvidenceRef {
  return {
    version: RECOVERY_EVIDENCE_VERSION,
    incidentId,
    attempt: 1,
    command,
    cwd,
    capturedRevision: 'fixture-revision',
    exitCode: 1,
    signal: null,
    stdoutPath: '/retained/out',
    stderrPath: '/retained/err',
    stdoutBytes: 0,
    stderrBytes: 0,
    captureComplete: true,
    truncatedFrom: null,
    redacted: false,
    capturedAt: '2026-11-16T12:00:00.000Z',
  };
}
