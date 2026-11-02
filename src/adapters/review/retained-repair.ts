import fs from 'node:fs';
import type { RetainedRepairPort } from '../../application/ports/review-round.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { RepairCheckpointService } from '../../application/repair-checkpoint-service.js';
import { failureIncidentFingerprint, lookupRecoveryEvidence } from '../../application/recovery-evidence.js';
import { gateFailureReason } from './review-gate-handling.js';
import { isOutputLimitFailure, runToExit, type run } from '../git/git.js';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { verificationEnvironment } from '../config/verification-environment.js';

/** Read both streams before launching; missing or unreadable evidence fails closed. */
export function retainedRepairPort(slug: string, worktree: string, store: MissionStore, configuration?: ParallixConfiguration): RetainedRepairPort {
  return {
    checkpoints: new RepairCheckpointService(store),
    async read(command) {
      const lookup = lookupRecoveryEvidence({ missionId: slug, cwd: worktree,
        incidentId: failureIncidentFingerprint({ command, cwd: worktree }) });
      if (!lookup.ok || !lookup.evidence) { throw new Error(`Retained evidence unavailable: ${lookup.error}`); }
      const evidence = lookup.evidence;
      return { evidence, stdout: fs.readFileSync(evidence.stdoutPath, 'utf8'), stderr: fs.readFileSync(evidence.stderrPath, 'utf8') };
    },
    async verify(command, cwd) {
      let result: ReturnType<typeof run>;
      try {
        result = await runToExit('bash', ['-lc', command], { cwd, maxBuffer: 10 * 1024 * 1024,
          env: verificationEnvironment(configuration?.forwardedEnvironment ?? {}) });
      } catch (error) {
        // Retained verification with an uncapturable stream cannot be certified as run.
        if (!isOutputLimitFailure(error)) { throw error; }
        return failedRetainedVerification(command, error.message, null, null);
      }
      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? '';
      return result.status === 0 ? { ok: true, command, exactExecution: { command, worktree: cwd, exitCode: 0 as const } }
        : failedRetainedVerification(command, `${stdout}\n${stderr}`, result.status, result.signal);
    },
  };
}

function failedRetainedVerification(command: string, diagnostic: string, exitCode: number | null, signal: string | null) {
  return { ok: false, command, diagnostic,
    reason: gateFailureReason({ ok: false, area: 'retained verification', command, exitCode, signal, stdout: '', stderr: diagnostic }) };
}
