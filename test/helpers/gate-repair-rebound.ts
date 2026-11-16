import { rebound, type ReboundContext, type ReboundReason } from '../../src/application/rebound-kernel.js';
import type { OpenRepairCheckpoint, RepairVerificationSnapshot } from '../../src/application/ports/repair-checkpoint.js';

/**
 * Route-level unit fixture for an implementer that records fresh evidence on
 * every gate-keyed checkpoint before the injected authorized rerun starts.
 * Detailed persistence behavior stays in the owning checkpoint contract suites.
 */
export function reboundWithGateRepairEvidence(reason: ReboundReason, context: ReboundContext) {
  const names = new Map<string, string>();
  const opened = new Map<string, OpenRepairCheckpoint>();
  return rebound(reason, { ...context, repairCheckpoints: {
    open: async input => {
      const identity = `${input.incidentId}:${input.gateKey ?? ''}`;
      const name = names.get(identity) ?? `CP-${names.size + 2}`;
      names.set(identity, name);
      opened.set(name, input);
      return { name, version: input.attempt };
    },
    readBlocker: async () => undefined,
    prepareVerification: async (_slug, name, scope): Promise<RepairVerificationSnapshot> => {
      const input = opened.get(name);
      if (!input) { throw new Error(`Gate repair fixture did not open ${name}`); }
      const occurrence = {
        checkpoint: name,
        incidentId: input.incidentId,
        attempt: input.attempt,
        openedMissionRevision: 1,
        worktree: input.worktree ?? context.worktree,
        failureRevision: input.failureRevision ?? context.head ?? 'fixture-revision',
        failureEvidenceId: input.failureEvidenceId ?? `${input.incidentId}:${input.attempt}`,
      };
      return {
        missionId: context.slug,
        command: input.command,
        worktree: input.worktree ?? context.worktree,
        executionRevision: scope.executionRevision ?? context.head ?? 'fixture-revision',
        executionMissionRevision: 2,
        checkpointEvidenceRevision: 2,
        authorizedGates: input.gateKey ? [input.gateKey] : [],
        authorizedCriteria: ['fixture criterion'],
        verifiedOccurrence: occurrence,
        coveredOccurrences: [occurrence],
      };
    },
    verify: async () => {},
    verifyAll: async () => {},
  } });
}
