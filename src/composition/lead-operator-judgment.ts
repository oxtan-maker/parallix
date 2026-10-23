import type { ProductionApplicationServices } from './application-services.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { AttentionObservation, SupervisorPort } from '../application/recovery-supervisor.js';
import { OperatorJudgmentService } from '../application/operator-judgment.js';
import { DecisionOperatorJudgment } from '../application/operator-decision.js';
import { createDecisionPort } from './decision.js';
import { missionId, type Mission } from '../domain/mission.js';
import { SqliteWorkflowOperationStore } from '../adapters/sqlite/workflow-operation-store.js';
import * as fmt from '../application/presentation/cli-format.js';

function missionEvidenceSummary(mission: Mission, observation: AttentionObservation | undefined): string {
  return `Mission ${mission.title}; goal ${mission.brief?.goal ?? 'unrecorded'}; scope ${mission.brief?.scope ?? 'unrecorded'}; lane ${mission.status}; ${observation ? JSON.stringify(observation.reason) : 'no longer asks for attention'}`;
}

/** Composition alone selects the external decision transport and authority readers. */
export function createLeadOperatorJudgment(services: ProductionApplicationServices, port: SupervisorPort, configuration: ParallixConfiguration): Required<Pick<SupervisorPort, 'judgeRecovery' | 'admitRecovery'>> {
  const service = new OperatorJudgmentService(new DecisionOperatorJudgment(createDecisionPort({
    ...configuration.decision, timeoutMs: '10000',
  })), {
    now: Date.now,
    read: async slug => {
      if (!services.mission || !services.operatorState.db) { throw new Error('Operator judgment authorities unavailable.'); }
      const loaded = await services.mission.store.load(missionId(slug));
      if (loaded.kind !== 'found') { throw new Error('Operator judgment Mission unavailable.'); }
      const operation = await new SqliteWorkflowOperationStore(services.operatorState.db, services.mission.repositoryId).current(slug);
      const observation = (await port.attention()).find(item => item.missionId === slug);
      const live = await port.liveness(slug);
      return { missionId: slug, version: loaded.version,
        operationId: operation ? `${operation.id}@${operation.generation}` : null,
        progress: observation?.progress ?? 'attention-cleared',
        lane: observation ? loaded.mission.status : 'cleared',
        working: live.working || operation !== null,
        evidence: [{ ref: `mission:${slug}@${loaded.version}`, summary: missionEvidenceSummary(loaded.mission, observation) },
          { ref: `progress:${observation?.progress ?? 'cleared'}`, summary: observation?.workingDetail ?? live.detail ?? 'No credible current worker reported.' }],
      };
    },
    record: async event => {
      if (!services.mission) { throw new Error('Operator judgment history unavailable.'); }
      await services.mission.operationalHistory.append('lead.operator-judgment', JSON.stringify(event));
      fmt.log.info(`[lead] operator judgment ${event.action}: ${event.summary}; evidence ${event.evidenceRefs.join(', ')}; consultations ${event.invocations}`);
    },
  });
  return { judgeRecovery: mission => service.judge(mission), admitRecovery: admission => service.assertContinuation(admission) };
}
