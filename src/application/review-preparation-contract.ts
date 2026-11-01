import { evaluateMissionEvidence } from './mission-evidence-readiness.js';
/**
 * Recorded Mission contract inputs review preparation verifies: the recorded contract,
 * the implementer identity, and legacy checkpoint document evidence.
 */

import * as path from 'node:path';
import * as fmt from './presentation/cli-format.js';
import type { AgentFamily } from '../domain/agents.js';
import { missionId } from '../domain/mission.js';
import type { Review } from '../domain/review.js';
import type { ReviewPreparationLog, ReviewPreparationMissionServicesPort, ReviewPreparationResult, ReviewPreparationWorkflowPorts } from "./ports/review-preparation-workflow.js";
import type { CheckpointData } from '../domain/checkpoint.js';
import { collectGoalCheckEvidenceRows, findUnverifiableGoalCheckRow } from './static-evidence.js';

/**
 * Read the recorded Mission contract review preparation verifies: checkpoint evidence and
 * declared gates.
 *
 * Fails closed. An unreachable operator database or a Mission it does not hold
 * is a review preparation failure, never an empty list: an empty list would send review preparation
 * down a legacy document path without a verified recorded contract. `draftedInDb` marks a Mission whose contract was recorded with
 * `px goal set`; only a Mission without one may still use its documents.
 */
export async function loadRecordedContract(
  missionServicesFn: ReviewPreparationMissionServicesPort,
  rootDir: string,
  missionDirPath: string,
  slug: string,
): Promise<
  | { ok: true; implementer?: AgentFamily | null; draftedInDb: boolean; checkpoints: readonly CheckpointData[]; successCriteria: readonly string[]; successCriterionIds?: readonly string[]; completedSuccessCriteria: readonly number[]; gates: readonly string[]; review: Review | null }
  | { ok: false; error: string }
> {
  try {
    const { store } = await missionServicesFn(rootDir, { missionDir: missionDirPath });
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found') {
      return { ok: false, error: `The operator database holds no Mission ${slug}; review preparation cannot verify its recorded contract.` };
    }
    const { mission } = loaded;
    // Only evidenced checkpoints are evidence; planned ones are checked by the
    // pre-review preparation checkpoint validation, which names the next one to resume.
    return {
      ok: true,
      implementer: mission.assignee,
      draftedInDb: Boolean(mission.brief),
      checkpoints: mission.checkpoints,
      successCriteria: mission.successCriteria ?? [],
      successCriterionIds: mission.successCriterionIds,
      completedSuccessCriteria: mission.completedSuccessCriteria ?? [],
      gates: mission.declaredGates ?? [],
      // The open review round names the affected criteria a repair must re-evidence.
      review: mission.review ?? null,
    };
  } catch (cause) {
    return { ok: false, error: `Could not read Mission ${slug} from the operator database: ${(cause as Error).message}. Review preparation fails closed.` };
  }
}

/**
 * Result of validating a declared gate command. The success variant carries
 * optional `error`/`gate` markers (typed `undefined`) so callers can read
 * `result.error`/`result.gate` across the union without narrowing.

/** The legacy Markdown checkpoint a document-path review preparation verified. */
export interface VerifiedCheckpointDocument {
  finalCheckpoint: string | null;
  checkpointContent: string;
  evidenceRows: string[];
}

/** Resolves implementer identity and verifies legacy checkpoint evidence. */
export class ReviewPreparationContractVerifier {
  private readonly ports: ReviewPreparationWorkflowPorts;

  constructor(ports: ReviewPreparationWorkflowPorts) {
    this.ports = ports;
  }

  /**
   * Pre-review preparation content integrity: the mission contract and its final checkpoint
   * must be committed, and that checkpoint must carry a Goal Check table whose
   * evidence rows cite something Parallix can actually verify. Returns the
   * verified checkpoint, or the failure the caller returns unchanged.
   */
  verifyReviewPreparationEvidence(slug: string, context: {
    rootDir: string; missionDirPath: string; log: ReviewPreparationLog; error: ReviewPreparationLog;
  }): ReviewPreparationResult | VerifiedCheckpointDocument {
    const ports = this.ports;
    const { rootDir, missionDirPath, error } = context;
    const fail = (msg: string): ReviewPreparationResult => { error(msg); return { ok: false, error: msg }; };

    const relativeMissionPath = path.relative(rootDir, path.join(missionDirPath, 'MISSION.md'));
    const dirtyFiles = ports.git.getWorktreeStatus(rootDir);
    if (dirtyFiles.some(line => line.endsWith(relativeMissionPath))) {
      return fail(`${fmt.path('MISSION.md')} is modified but uncommitted at ${fmt.path(relativeMissionPath)}. Commit the mission contract before review preparation.`);
    }

    const checkpoints = ports.missionUtils.findCheckpoints(missionDirPath);
    if (checkpoints.length === 0) {
      return fail(`No checkpoint documents found in ${fmt.path(missionDirPath)}. Import historical evidence or record it with px checkpoint record; review preparation never generates evidence.`);
    }

    const finalCheckpoint = checkpoints[checkpoints.length - 1];
    const relativeCheckpointPath = path.relative(rootDir, finalCheckpoint);
    if (dirtyFiles.some(line => line.endsWith(relativeCheckpointPath))) {
      return fail(`The latest checkpoint document is modified but uncommitted at ${fmt.path(relativeCheckpointPath)}. Commit the implementation evidence before review preparation.`);
    }

    // Per review.md step 5, a missing or empty goal-check table means the
    // checkpoint has not satisfied the mission's evidence requirement. Both the
    // `## Goal Check` and `## Goal Check Table` headings are accepted.
    if (!ports.fileSystem.existsSync(finalCheckpoint)) {
      return fail(`The final checkpoint at ${fmt.path(relativeCheckpointPath)} was not found. Import historical evidence or record it with px checkpoint record; review preparation never generates evidence.`);
    }
    const checkpointContent = ports.fileSystem.readText(finalCheckpoint);
    const goalCheckMatch = checkpointContent.match(/^## Goal Check(?: Table)?\s*$/m);
    if (!goalCheckMatch) {
      return fail(`The final checkpoint at ${fmt.path(relativeCheckpointPath)} is missing a "## Goal Check" section. Review requires a goal-check table with real evidence before review preparation.`);
    }

    // Only real evidence rows count: separator rows (|---|---|) and the header
    // row itself are excluded by collectGoalCheckEvidenceRows.
    const afterHeader = checkpointContent.slice((goalCheckMatch.index ?? 0) + goalCheckMatch[0].length);
    const evidenceRows = collectGoalCheckEvidenceRows(afterHeader);
    if (evidenceRows.length === 0) {
      return fail(`The final checkpoint at ${fmt.path(relativeCheckpointPath)} has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before review preparation.`);
    }
    const unverifiableRow = findUnverifiableGoalCheckRow(ports.fileSystem, evidenceRows, rootDir);
    if (unverifiableRow) {
      return fail(`The final checkpoint at ${fmt.path(relativeCheckpointPath)} has a "## Goal Check" section but no evidence rows that cite a verifiable reference such as a recognized repo command/path, exact test name, test-file path, or ADR reference (or, when necessary, file:line). A goal-check table with real evidence is required before review preparation. Offending row: ${unverifiableRow}`);
    }
    return { finalCheckpoint, checkpointContent, evidenceRows };
  }

  /**
   * Verify the checkpoint evidence a review preparation stands on. Recorded evidence from
   * `px checkpoint record` is the authority; the legacy `CP-N.md` document path
   * only serves a Mission whose evidence exists solely as a committed document.
   */
  verifyCheckpointEvidence(
    slug: string,
    contract: RecordedContract,
    context: { rootDir: string; missionDirPath: string; log: ReviewPreparationLog; error: ReviewPreparationLog },
  ): ReviewPreparationResult | VerifiedCheckpointDocument {
    const ports = this.ports;
    const { rootDir, missionDirPath, log, error } = context;
    if (!contract.draftedInDb) {
      const missionMdPath = path.join(missionDirPath, 'MISSION.md');
      if (!ports.fileSystem.existsSync(missionMdPath)) {
        const message = `MISSION.md not found at ${missionMdPath}. Import the historical contract before review preparation.`;
        error(message);
        return { ok: false, error: message };
      }
    }
    const readiness = evaluateMissionEvidence(contract, ports.fileSystem, rootDir);
    const recorded = contract.checkpoints;
    let finalCheckpoint: string | null = null;
    let checkpointContent = '';
    let evidenceRows: string[] = [];
    if (readiness.source !== 'historical') {
      const finding = readiness.findings[0];
      if (finding) { error(finding.message); return { ok: false, error: finding.message, reason: finding.code }; }
      const combinedRows = recorded.reduce((total, checkpoint) => total + checkpoint.goalCheck.length, 0);
      log(fmt.status('PASS', `Recorded checkpoint evidence verified: ${recorded.length} recorded checkpoint(s), ${combinedRows} Goal Check row(s).`));
    } else {
      const evidence = this.verifyReviewPreparationEvidence(slug, { rootDir, missionDirPath, log, error });
      if (!('finalCheckpoint' in evidence)) { return evidence; }
      ({ finalCheckpoint, checkpointContent, evidenceRows } = evidence);
    }
    return { finalCheckpoint, checkpointContent, evidenceRows };
  }
}

/** A recorded Mission contract that loaded successfully. */
export type RecordedContract = Extract<Awaited<ReturnType<typeof loadRecordedContract>>, { ok: true }>;
