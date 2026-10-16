import fs from 'node:fs';
import type { RetainedRepairPort } from '../../application/ports/review-round.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { RepairCheckpointService } from '../../application/repair-checkpoint-service.js';
import { failureIncidentFingerprint, lookupRecoveryEvidence } from '../../application/recovery-evidence.js';
import { gateFailureReason } from './review-gate-handling.js';
import { run } from '../git/git.js';
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
      const result = run('bash', ['-lc', command], { cwd, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024,
        env: verificationEnvironment(configuration?.forwardedEnvironment ?? {}) });
      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? '';
      return result.status === 0 ? { ok: true, command } : { ok: false, command, diagnostic: `${stdout}\n${stderr}`,
        reason: gateFailureReason({ ok: false, area: 'retained verification', command, exitCode: result.status, stdout, stderr }) };
    },
  };
}
