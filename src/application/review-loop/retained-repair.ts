import { missionId, type Mission } from '../../domain/mission.js';
import type { ReviewLoopPorts, ReviewLoopRequest } from '../ports/review-round.js';
import { rebound, DEFAULT_REBOUND_ATTEMPTS } from '../rebound-kernel.js';
import { repairContractFailure } from '../repair-checkpoint-service.js';
import { isRetainedGateRepair } from '../rebound-checkpoints.js';

/** Gate checkpoints alone own retained process output; workflow repairs do not. */
export function pendingRetainedRepair(mission: Mission) {
  return mission.checkpoints.findLast(cp => cp.repair && !cp.repair.verified && isRetainedGateRepair(cp.repair.command));
}

/** Continuation is recovery until the original check and checkpoint are verified. */
export async function resumeRetainedRepair(request: ReviewLoopRequest, mission: Mission, implementer: string, ports: ReviewLoopPorts, reviewer?: string): Promise<void> {
  try {
    const contractFailure = repairContractFailure(mission.checkpoints, mission.declaredGates, mission.successCriteria);
    if (contractFailure) { throw new Error(contractFailure); }
    const checkpoint = pendingRetainedRepair(mission)!;
    const repair = checkpoint.repair!;
    const retained = ports.retainedRepair;
    if (!retained) { throw new Error('Retained repair evidence port is unavailable'); }
    const { evidence, stdout, stderr } = await retained.read(repair.command);
    if (evidence.command !== repair.command || evidence.cwd !== ports.worktree || evidence.exitCode === 0 || !evidence.captureComplete) {
      throw new Error('Retained failure does not match the authorized command and working directory or is incomplete');
    }
    if (request.dryRun) {
      ports.output.log(`Retained repair: ${repair.command}\nWorking directory: ${evidence.cwd}\nstdout: ${evidence.stdoutPath}\nstderr: ${evidence.stderrPath}`);
      return;
    }
    const result = await rebound({ kind: 'gate-failure', area: 'retained verification', command: repair.command,
      exitCode: evidence.exitCode, stdout, stderr }, {
      slug: request.slug, worktree: ports.worktree, implementer,
      retainedFailure: evidence, repairIncidentId: repair.incidentId, repairCheckpoints: retained.checkpoints,
      maxAttempts: request.reboundsPerRound !== undefined && request.reboundsPerRound >= 0
        ? Math.min(DEFAULT_REBOUND_ATTEMPTS, request.reboundsPerRound) : DEFAULT_REBOUND_ATTEMPTS,
      readHead: () => ports.preReview.head(),
      verify: async () => {
        const current = await ports.missionStore!.load(missionId(request.slug));
        if (current.kind !== 'found') { throw new Error('Repair authority is unavailable before verification'); }
        const failure = repairContractFailure(current.mission.checkpoints, current.mission.declaredGates, current.mission.successCriteria);
        if (failure) { throw new Error(failure); }
        return await retained.verify(repair.command, evidence.cwd);
      },
      startAgent: async (_step, options) => await ports.agents.launch({ role: 'implementer', agent: options.agent as string,
        exclude: [reviewer], recovery: { prompt: options.prompt as (_agent: string) => string, sessionPolicy: options.sessionPolicy } }),
      log: message => ports.output.log(message), error: message => ports.output.error(message),
    });
    if (result.outcome !== 'fixed') { ports.output.exit(1); }
  } catch (cause) {
    ports.output.error(`Retained verification repair failed: ${String(cause)}`);
    ports.output.exit(1);
  }
}
