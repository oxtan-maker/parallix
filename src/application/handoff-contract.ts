import { handoffEvidencePolicy } from '../domain/mission-handoff-policy.js';
/**
 * Recorded Mission contract inputs handoff verifies: the recorded contract,
 * the implementer identity, and legacy checkpoint document evidence.
 */

import * as path from 'node:path';
import * as fmt from './presentation/cli-format.js';
import type { AgentFamily } from '../domain/agents.js';
import { missionId } from '../domain/mission.js';
import type { Review } from '../domain/review.js';
import type { HandoffLog, HandoffMissionServicesPort, HandoffResult, HandoffWorkflowPorts } from './ports/handoff-workflow.js';
import type { CheckpointData } from '../domain/checkpoint.js';
import { uncoveredCompletedCriteria } from '../domain/checkpoint.js';
import { collectGoalCheckEvidenceRows, findUnverifiableGoalCheckRow } from './static-evidence.js';

/**
 * Read the recorded Mission contract handoff verifies: checkpoint evidence and
 * declared gates.
 *
 * Fails closed. An unreachable operator database or a Mission it does not hold
 * is a handoff failure, never an empty list: an empty list would send handoff
 * down a legacy document path without a verified recorded contract. `draftedInDb` marks a Mission whose contract was recorded with
 * `px goal set`; only a Mission without one may still use its documents.
 */
export async function loadRecordedContract(
  missionServicesFn: HandoffMissionServicesPort,
  rootDir: string,
  missionDirPath: string,
  slug: string,
): Promise<
  | { ok: true; draftedInDb: boolean; checkpoints: readonly CheckpointData[]; successCriteria: readonly string[]; completedSuccessCriteria: readonly number[]; gates: readonly string[]; review: Review | null }
  | { ok: false; error: string }
> {
  try {
    const { store } = await missionServicesFn(rootDir, { missionDir: missionDirPath });
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found') {
      return { ok: false, error: `The operator database holds no Mission ${slug}; handoff cannot verify its recorded contract.` };
    }
    const { mission } = loaded;
    // Only evidenced checkpoints are evidence; planned ones are checked by the
    // pre-handoff checkpoint validation, which names the next one to resume.
    return {
      ok: true,
      draftedInDb: Boolean(mission.brief),
      checkpoints: mission.checkpoints.filter(({ goalCheck }) => goalCheck.length > 0),
      successCriteria: mission.successCriteria ?? [],
      completedSuccessCriteria: mission.completedSuccessCriteria ?? [],
      gates: mission.declaredGates ?? [],
      // The open review round names the affected criteria a repair must re-evidence.
      review: mission.review ?? null,
    };
  } catch (cause) {
    return { ok: false, error: `Could not read Mission ${slug} from the operator database: ${(cause as Error).message}. Handoff fails closed.` };
  }
}

/**
 * Result of validating a declared gate command. The success variant carries
 * optional `error`/`gate` markers (typed `undefined`) so callers can read
 * `result.error`/`result.gate` across the union without narrowing.

/** The legacy Markdown checkpoint a document-path handoff verified. */
export interface VerifiedCheckpointDocument {
  finalCheckpoint: string | null;
  checkpointContent: string;
  evidenceRows: string[];
}

/** Resolves implementer identity and verifies legacy checkpoint evidence. */
export class HandoffContractVerifier {
  private readonly ports: HandoffWorkflowPorts;

  constructor(ports: HandoffWorkflowPorts) {
    this.ports = ports;
  }

  /**
   * Performs the handoff process for a mission:
   * 1. Runs the verification gate.
   * 2. Syncs primary branch and pushes the mission branch to Forgejo, creating or updating the PR.
   * 3. Transitions Backlog task to 'review'.
   * 4. Commits and pushes the Backlog state change to Forgejo.
   */
  /**
   * Derive the implementer agent family for a DB-owned adhoc identity from the
   * operator database. The Backlog task file is a best-effort one-way mirror
   * only; a deleted mirror must not strand handoff. The mission store's
   * `assignee` is set to the active-launch agent by the authoritative lifecycle
   * transition (decideMission), so this resolves once `px active` has run.
   */
  async deriveImplementerFromMissionStore(
    slug: string,
    missionServicesFn: HandoffMissionServicesPort,
    rootDir: string,
    missionDirPath: string,
  ): Promise<AgentFamily | null> {
    try {
      const missionServices = await missionServicesFn(rootDir, { missionDir: missionDirPath });
      const missionLoad = await missionServices.store.load(missionId(slug));
      if (missionLoad.kind === 'found' && missionLoad.mission.assignee) {
        return missionLoad.mission.assignee;
      }
    } catch (_) {
      // A store read failure must not strand handoff; the caller's later
      // identity checks remain authoritative.
    }
    return null;
  }

  /**
   * Pre-handoff content integrity: the mission contract and its final checkpoint
   * must be committed, and that checkpoint must carry a Goal Check table whose
   * evidence rows cite something Parallix can actually verify. Returns the
   * verified checkpoint, or the failure the caller returns unchanged.
   */
  verifyHandoffEvidence(slug: string, context: {
    rootDir: string; missionDirPath: string; log: HandoffLog; error: HandoffLog;
  }): HandoffResult | VerifiedCheckpointDocument {
    const ports = this.ports;
    const { rootDir, missionDirPath, error } = context;
    const fail = (msg: string): HandoffResult => { error(msg); return { ok: false, error: msg }; };

    const relativeMissionPath = path.relative(rootDir, path.join(missionDirPath, 'MISSION.md'));
    const dirtyFiles = ports.git.getWorktreeStatus(rootDir);
    if (dirtyFiles.some(line => line.endsWith(relativeMissionPath))) {
      return fail(`${fmt.path('MISSION.md')} is modified but uncommitted at ${fmt.path(relativeMissionPath)}. Commit the mission contract before handoff.`);
    }

    const checkpoints = ports.missionUtils.findCheckpoints(missionDirPath);
    if (checkpoints.length === 0) {
      return fail(`No checkpoint documents found in ${fmt.path(missionDirPath)}. Import historical evidence or record it with px checkpoint record; handoff never generates evidence.`);
    }

    const finalCheckpoint = checkpoints[checkpoints.length - 1];
    const relativeCheckpointPath = path.relative(rootDir, finalCheckpoint);
    if (dirtyFiles.some(line => line.endsWith(relativeCheckpointPath))) {
      return fail(`The latest checkpoint document is modified but uncommitted at ${fmt.path(relativeCheckpointPath)}. Commit the implementation evidence before handoff.`);
    }

    // Per review.md step 5, a missing or empty goal-check table means the
    // checkpoint has not satisfied the mission's evidence requirement. Both the
    // `## Goal Check` and `## Goal Check Table` headings are accepted.
    const checkpointContent = ports.fileSystem.readText(finalCheckpoint);
    const goalCheckMatch = checkpointContent.match(/^## Goal Check(?: Table)?\s*$/m);
    if (!goalCheckMatch) {
      return fail(`The final checkpoint at ${fmt.path(relativeCheckpointPath)} is missing a "## Goal Check" section. Review requires a goal-check table with real evidence before handoff.`);
    }

    // Only real evidence rows count: separator rows (|---|---|) and the header
    // row itself are excluded by collectGoalCheckEvidenceRows.
    const afterHeader = checkpointContent.slice((goalCheckMatch.index ?? 0) + goalCheckMatch[0].length);
    const evidenceRows = collectGoalCheckEvidenceRows(afterHeader);
    if (evidenceRows.length === 0) {
      return fail(`The final checkpoint at ${fmt.path(relativeCheckpointPath)} has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.`);
    }
    const unverifiableRow = findUnverifiableGoalCheckRow(ports.fileSystem, evidenceRows, rootDir);
    if (unverifiableRow) {
      return fail(`The final checkpoint at ${fmt.path(relativeCheckpointPath)} has a "## Goal Check" section but no evidence rows that cite a verifiable reference such as a recognized repo command/path, exact test name, test-file path, or ADR reference (or, when necessary, file:line). A goal-check table with real evidence is required before handoff. Offending row: ${unverifiableRow}`);
    }
    return { finalCheckpoint, checkpointContent, evidenceRows };
  }

  /**
   * Verify the checkpoint evidence a handoff stands on. Recorded evidence from
   * `px checkpoint record` is the authority; the legacy `CP-N.md` document path
   * only serves a Mission whose evidence exists solely as a committed document.
   */
  verifyCheckpointEvidence(
    slug: string,
    contract: RecordedContract,
    context: { rootDir: string; missionDirPath: string; log: HandoffLog; error: HandoffLog },
  ): HandoffResult | VerifiedCheckpointDocument {
    const ports = this.ports;
    const { rootDir, missionDirPath, log, error } = context;
    const recorded = contract.checkpoints;
    let finalCheckpoint: string | null = null;
    let checkpointContent = '';
    let evidenceRows: string[] = [];
    const policy = handoffEvidencePolicy(contract);
    if (policy.source === 'recorded') {
      // Validate every recorded checkpoint's rows, not only the last: retained
      // evidence from earlier checkpoints must cite a verifiable reference too.
      for (const checkpoint of recorded) {
        const rows = checkpoint.goalCheck.map((row) => `| ${row.criterion} | ${row.evidence} |`);
        const unverifiable = findUnverifiableGoalCheckRow(ports.fileSystem, rows, rootDir);
        if (unverifiable) {
          const msg = `The recorded evidence for ${checkpoint.name} has a Goal Check row that cites no verifiable reference such as a recognized repo command/path, exact test name, test-file path, or ADR reference. Re-record it with \`px checkpoint record\`. Offending row: ${unverifiable}`;
          error(msg);
          return { ok: false, error: msg };
        }
      }
      const incomplete = policy.incomplete;
      if (incomplete.length > 0) {
        const msg = `Success criteria ${incomplete.join(', ')} are incomplete before handoff. Mark every criterion complete with \`px mission mark-complete --criterion <index> --expected-version <n>\` (or \`--all\`) before handoff.`;
        error(msg);
        return { ok: false, error: msg };
      }
      // Completion is addressed by the stored criterion index, and a completed
      // criterion still needs its own evidence row whose identity (the row's
      // `criterion` text) matches the criterion text. Coverage is the union of
      // identities across all recorded checkpoints: a repair checkpoint may carry
      // only its affected criteria while earlier evidence is retained, and a row
      // for one criterion does not count as evidence for another.
      if (policy.insufficientRows) {
        const uncovered = uncoveredCompletedCriteria(recorded, contract.successCriteria, contract.completedSuccessCriteria);
        const combinedRows = recorded.reduce((total, checkpoint) => total + checkpoint.goalCheck.length, 0);
        const msg = `Success-criterion evidence is missing before handoff: ${contract.successCriteria.length} completed criteria require ${contract.successCriteria.length} Goal Check row(s), but only ${combinedRows} were recorded across ${recorded.length} recorded checkpoint(s), and ${uncovered.length} criterion have no row: ${uncovered.join(', ')}. Re-record with \`px checkpoint record\` and verifiable evidence for every completed criterion; prior evidence is retained.`;
        error(msg);
        return { ok: false, error: msg };
      }
      const combinedRows = recorded.reduce((total, checkpoint) => total + checkpoint.goalCheck.length, 0);
      log(fmt.status('PASS', `Recorded checkpoint evidence verified: ${recorded.length} recorded checkpoint(s), ${combinedRows} Goal Check row(s).`));
    } else if (policy.source === 'missing') {
      // A Mission drafted through the typed verbs records its evidence the same
      // way. Handoff never writes evidence on the implementer's behalf.
      const msg = `${fmt.slug(slug)} has no recorded checkpoint evidence. Record it with \`px checkpoint record\` before handoff; handoff never generates evidence.`;
      error(msg);
      return { ok: false, error: msg };
    } else {
      const evidence = this.verifyHandoffEvidence(slug, { rootDir, missionDirPath, log, error });
      if (!('finalCheckpoint' in evidence)) { return evidence; }
      ({ finalCheckpoint, checkpointContent, evidenceRows } = evidence);
    }
    return { finalCheckpoint, checkpointContent, evidenceRows };
  }
}

/** A recorded Mission contract that loaded successfully. */
export type RecordedContract = Extract<Awaited<ReturnType<typeof loadRecordedContract>>, { ok: true }>;
