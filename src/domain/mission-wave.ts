import { authorMission, recordedClassification, type MissionAuthoringFields } from './mission-authoring.js';
import { intakeMission, missionId, MissionRuleViolation, type Mission, type MissionId, type MissionIntake, type OpenMission } from './mission.js';
import { missionDependencies } from './mission-dependencies.js';
import { toCanonicalUtcInstant } from './instant.js';

export interface MissionWaveChildContract extends MissionAuthoringFields, Pick<MissionIntake, 'title' | 'description'> {
  /** One-based positions of prerequisite children in this conversion request. */
  readonly dependsOn?: readonly number[];
}

export interface MissionWaveConversion {
  readonly parent: Mission;
  readonly children: readonly OpenMission[];
}

function childId(parent: MissionId, position: number): MissionId {
  return missionId(`${parent}.${String(position + 1).padStart(2, '0')}`);
}

function requireEligibleParent(parent: Mission): asserts parent is OpenMission {
  if (!/^(?:task|px)-\d{4,}$/.test(parent.id)) {
    throw new MissionRuleViolation('Mission wave parents must use a task-NNNN or px-NNNN identity');
  }
  if (parent.status !== 'backlog' || parent.closedAt !== null) {
    throw new MissionRuleViolation(`Cannot convert ${parent.id} to a wave while it is ${parent.status}`);
  }
  if (parent.predictedNelBucket !== 'Large') {
    throw new MissionRuleViolation(`Cannot convert ${parent.id} to a wave unless its predicted NEL bucket is Large`);
  }
  if (parent.wave || parent.waveParentId) {
    throw new MissionRuleViolation(`Mission ${parent.id} is already part of a wave`);
  }
  if (parent.largeMissionRiskException) {
    throw new MissionRuleViolation(`Mission ${parent.id} already has an approved Large-mission risk exception`);
  }
}

function dependencyPositions(contracts: readonly MissionWaveChildContract[]): readonly (readonly number[])[] {
  return contracts.map((contract, child) => {
    const positions = [...(contract.dependsOn ?? [])];
    if (new Set(positions).size !== positions.length) {
      throw new MissionRuleViolation(`Wave child ${child + 1} repeats a dependency`);
    }
    for (const prerequisite of positions) {
      if (!Number.isInteger(prerequisite) || prerequisite < 1 || prerequisite > contracts.length) {
        throw new MissionRuleViolation(`Wave child ${child + 1} has an invalid dependency position: ${prerequisite}`);
      }
      if (prerequisite === child + 1) {
        throw new MissionRuleViolation(`Wave child ${child + 1} cannot depend on itself`);
      }
    }
    return positions;
  });
}

function requireAcyclic(graph: readonly (readonly number[])[]): void {
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (node: number): void => {
    if (visiting.has(node)) { throw new MissionRuleViolation('Mission wave dependencies must be acyclic'); }
    if (visited.has(node)) { return; }
    visiting.add(node);
    for (const prerequisite of graph[node]!) { visit(prerequisite - 1); }
    visiting.delete(node);
    visited.add(node);
  };
  for (let node = 0; node < graph.length; node += 1) { visit(node); }
}

/** Validate every child contract and materialize a deterministic, independently deliverable wave. */
export function convertMissionToWave(parent: Mission, contracts: readonly MissionWaveChildContract[]): MissionWaveConversion {
  requireEligibleParent(parent);
  if (contracts.length < 2 || contracts.length > 99) {
    throw new MissionRuleViolation('Mission wave conversion requires between 2 and 99 child contracts');
  }
  const graph = dependencyPositions(contracts);
  requireAcyclic(graph);
  const ids = contracts.map((_, index) => childId(parent.id, index));
  const children = contracts.map((contract, index): OpenMission => {
    if (!contract.title.trim()) { throw new MissionRuleViolation(`Wave child ${index + 1} requires a title`); }
    if (contract.predictedNelBucket === 'Large') {
      throw new MissionRuleViolation(`Wave child ${index + 1} must be Small or Medium; split it again before converting the parent`);
    }
    if (recordedClassification([contract.classification]) === 'unknown') {
      throw new MissionRuleViolation(`Wave child ${index + 1} requires ai_sdlc or user_value classification`);
    }
    const intake = intakeMission({
      id: ids[index]!, repositoryId: parent.repositoryId, title: contract.title,
      description: contract.description ?? null,
    });
    const authored = authorMission(intake, contract);
    return {
      ...authored,
      waveParentId: parent.id,
      dependencies: missionDependencies(graph[index]!.map(position => ids[position - 1]!), ids[index]!),
    } as OpenMission;
  });
  return { parent: { ...parent, wave: { children: ids } }, children };
}

/** Record the human decision that makes one Large delivery contract draft-ready. */
export function approveLargeMissionRiskException(
  mission: Mission,
  decision: { readonly rationale: string; readonly approvedBy: string; readonly approvedAt: string },
): Mission {
  if (mission.status !== 'backlog' || mission.closedAt !== null) {
    throw new MissionRuleViolation(`Cannot approve a Large-mission risk exception while ${mission.id} is ${mission.status}`);
  }
  if (mission.predictedNelBucket !== 'Large') {
    throw new MissionRuleViolation('A Large-mission risk exception requires a Large predicted NEL bucket');
  }
  if (mission.wave || mission.waveParentId) {
    throw new MissionRuleViolation('A Mission wave or child cannot receive a Large-mission risk exception');
  }
  const rationale = decision.rationale.trim();
  const approvedBy = decision.approvedBy.trim();
  if (!rationale || !approvedBy) {
    throw new MissionRuleViolation('A Large-mission risk exception requires a rationale and approving operator');
  }
  return { ...mission, largeMissionRiskException: {
    rationale, approvedBy, approvedAt: toCanonicalUtcInstant(decision.approvedAt),
  } };
}
