import type { CheckpointData } from '../domain/checkpoint.js';
import { missingCheckpointEvidence, staleRepairCriteria, uncoveredCompletedCriteria } from '../domain/checkpoint.js';
import { handoffEvidencePolicy } from '../domain/mission-handoff-policy.js';
import { openRepairFromReview, type Review } from '../domain/review.js';
import { repairContractFailure } from './repair-checkpoint-service.js';
import { findUnverifiableRecordedRow, type EvidenceFileSystemPort } from './static-evidence.js';

export interface EvidenceContract {
  readonly draftedInDb: boolean;
  readonly checkpoints: readonly CheckpointData[];
  readonly successCriteria: readonly string[];
  readonly successCriterionIds?: readonly string[];
  readonly completedSuccessCriteria: readonly number[];
  readonly gates: readonly string[];
  readonly review: Review | null;
}

export interface EvidenceFinding {
  readonly code: 'human-only-contract-blocker' | 'repair-contract-changed' | 'missing-checkpoint' | 'unverifiable-reference' | 'incomplete-criterion' | 'uncovered-criterion' | 'stale-repair-row' | 'missing-evidence';
  readonly message: string;
  readonly nextCommands: readonly string[];
  readonly checkpoint?: string;
  readonly criterion?: string;
  readonly criterionIndex?: number;
  readonly rowIndex?: number;
}

/** Read-only evaluation of the same recorded evidence handoff consumes. */
export function evaluateMissionEvidence(contract: EvidenceContract, fileSystem: EvidenceFileSystemPort, rootDir: string) {
  const findings: EvidenceFinding[] = [];
  const { checkpoints, successCriteria } = contract;
  const latest = checkpoints.at(-1)?.name ?? 'CP-1';
  const record = (name: string) => `px checkpoint record --name ${name} --criterion <exact-criterion> --evidence <verifiable-reference> --next <next-action>`;
  findings.push(...checkpointFindings(contract, record));
  const policy = handoffEvidencePolicy(contract);
  if (policy.source === 'missing') {
    findings.push({ code: 'missing-evidence', message: 'Mission has no recorded checkpoint evidence. Record it with `px checkpoint record` before handoff; handoff never generates evidence.', nextCommands: [record(latest)] });
  }
  if (policy.source !== 'historical') {
    for (const cp of checkpoints) {
      cp.goalCheck.forEach((row, rowIndex) => {
        const invalid = findUnverifiableRecordedRow(fileSystem, [row], rootDir);
        if (invalid) { findings.push({ code: 'unverifiable-reference', checkpoint: cp.name, criterion: row.criterion, rowIndex: rowIndex + 1,
          message: `The recorded evidence for ${cp.name} is not verifiable; re-record it with \`px checkpoint record\`. ${invalid.message}`, nextCommands: [record(cp.name)] }); }
      });
    }
    for (const index of policy.incomplete) {
      findings.push({ code: 'incomplete-criterion', criterionIndex: index, criterion: successCriteria[index - 1],
        message: `Success criteria ${policy.incomplete.join(', ')} are incomplete before handoff. Mark every criterion complete with \`px mission mark-complete --criterion <index>\` (or \`--all\`) before handoff.`, nextCommands: [`px mission mark-complete --criterion ${index}`] });
    }
    const uncovered = uncoveredCompletedCriteria(checkpoints, successCriteria, contract.completedSuccessCriteria, contract.successCriterionIds);
    for (const criterion of uncovered) {
      const count = checkpoints.reduce((total, cp) => total + cp.goalCheck.length, 0);
      findings.push({ code: 'uncovered-criterion', criterion, criterionIndex: successCriteria.indexOf(criterion) + 1,
        message: `Success-criterion evidence is missing before handoff: ${successCriteria.length} completed criteria require ${successCriteria.length} Goal Check row(s), but only ${count} were recorded across ${checkpoints.length} recorded checkpoint(s), and ${uncovered.length} criterion have no row: ${uncovered.join(', ')}. Re-record with \`px checkpoint record\` and verifiable evidence for every completed criterion; prior evidence is retained.`, nextCommands: [record(latest)] });
    }
    const repair = openRepairFromReview(contract.review, successCriteria, checkpoints.flatMap(cp => cp.goalCheck));
    for (const criterion of repair ? staleRepairCriteria(checkpoints, repair) : []) {
      findings.push({ code: 'stale-repair-row', criterion,
        message: `The open repair has no fresh fix evidence recorded in this review round for ${criterion}; only stale rows from earlier rounds remain (latest checkpoint ${latest}). Run \`px checkpoint record --name ${latest} --criterion <affected> --evidence <verifiable>\` for the criteria the failure touches, then handoff.`, nextCommands: [record(latest)] });
    }
  }
  return { ready: findings.length === 0 && policy.source !== 'historical', source: policy.source, findings,
    primaryStopReason: findings[0]?.code ?? null };
}

function checkpointFindings(contract: EvidenceContract, record: (_name: string) => string): EvidenceFinding[] {
  const findings: EvidenceFinding[] = [];
  const { checkpoints, successCriteria } = contract;
  const incidentFailure = contract.draftedInDb ? repairContractFailure(checkpoints, contract.gates, successCriteria) : null;
  if (incidentFailure) {
    findings.push({ code: checkpoints.some(cp => cp.repair?.blocker) ? 'human-only-contract-blocker' : 'repair-contract-changed',
      message: incidentFailure, nextCommands: ['px status --json'],
      checkpoint: checkpoints.find(cp => cp.repair?.blocker)?.name });
  }
  if (contract.draftedInDb) {
    const missing = missingCheckpointEvidence(checkpoints, contract.gates, successCriteria);
    for (const cp of missing) {
      findings.push({ code: 'missing-checkpoint', checkpoint: cp.name,
        message: `Planned checkpoint evidence is missing before handoff: ${missing.map(item => item.name).join(', ')}. Record fresh evidence with px checkpoint record before handoff.`, nextCommands: [record(cp.name)] });
    }
  }
  return findings;
}
