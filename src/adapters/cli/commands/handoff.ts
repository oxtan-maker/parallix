// @ts-nocheck
/**
 * Handoff command adapter (TASK-2332.09).
 *
 * The handoff workflow itself now lives in
 * `src/application/handoff-command-use-case.ts`. This module is the adapter
 * boundary: it binds the concrete infrastructure modules to the
 * application-owned ports in `src/application/ports/handoff-workflow.ts` and
 * delegates every operation to a single `HandoffCommandUseCase`. It sequences
 * nothing itself.
 *
 * The named function exports below are retained so existing callers
 * (`src/adapters/review/review-loop.ts`, `src/composition/application-services.ts`)
 * and the characterization suites keep the signatures they were written against.
 */
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as git from '../../git/git.js';
import * as missionUtils from '../../filesystem/mission-utils.js';
import * as backlog from '../../backlog/backlog.js';
import * as forgejo from '../../forgejo/forgejo.js';
import { resolveReviewIdentity } from '../../review/review-state.js';
import * as setupReview from '../../review/setup-review.js';
import * as gatekeeper from '../../verification/gatekeeper.js';
import { createVerificationProofIdentity, formatVerificationCommand, readReusableVerificationProof, runVerificationGate, writeReusableVerificationProof } from '../../verification/verification.js';
import { isForgejoReviewEnabled } from '../../config/product-config.js';
import { rebaseBeforeReviewRound } from '../../review/rebase.js';
import { computeNELRecord } from '../../git/net-engineering-lines.js';
import { writeJson } from '../../storage/storage.js';
import { eligibleAgentsForStep, selectAgent, startAgent } from '../../agents/agents.js';
import {
  HandoffCommandUseCase,
  buildAutoCheckpointContent,
} from '../../../application/handoff-command-use-case.js';
import {
  collectGoalCheckEvidenceRows,
  evidenceCellHasVerifiableReference as evidenceCellHasVerifiableReferenceWithPort,
  findUnverifiableGoalCheckRow as findUnverifiableGoalCheckRowWithPort,
} from '../../review/review-static-evidence.js';
import type { HandoffWorkflowPorts } from '../../../application/ports/handoff-workflow.js';

/**
 * Bind the concrete infrastructure modules to the handoff workflow ports.
 *
 * Every method reaches its module through the imported namespace *at call
 * time*, so a test that swaps a dependency module (see `test/lib/module-mock.ts`)
 * is still observed by the use case.
 */
export function createHandoffPorts(): HandoffWorkflowPorts {
  return {
    fileSystem: {
      existsSync: (target) => fs.existsSync(target),
      readText: (target) => fs.readFileSync(target, 'utf8'),
      writeText: (target, content) => fs.writeFileSync(target, content, 'utf8'),
      listNames: (target) => fs.readdirSync(target),
      listEntries: (target) => fs.readdirSync(target, { withFileTypes: true }),
    },
    git: {
      git: (args, options) => (options === undefined ? git.git(args) : git.git(args, options)),
      get run() { return git.run; },
      getCurrentBranch: (rootDir) => git.getCurrentBranch(rootDir),
      getWorktreeStatus: (rootDir) => git.getWorktreeStatus(rootDir),
    },
    missionUtils: {
      inferSlug: (explicitSlug) => missionUtils.inferSlug(explicitSlug),
      resolveWorktree: (slug, options) => missionUtils.resolveWorktree(slug, options),
      findMissionDir: (slug, rootDir) => missionUtils.findMissionDir(slug, rootDir),
      findMissionArea: (missionDir) => missionUtils.findMissionArea(missionDir),
      missionBranchName: (slug, rootDir) => missionUtils.missionBranchName(slug, rootDir),
      findCheckpoints: (missionDir) => missionUtils.findCheckpoints(missionDir),
      getPrimaryBranch: (rootDir) => missionUtils.getPrimaryBranch(rootDir),
    },
    backlog: {
      resolveTaskFile: (slug, rootDir) => backlog.resolveTaskFile(slug, rootDir),
      getTaskImplementer: (taskFile) => backlog.getTaskImplementer(taskFile),
      transitionTask: (slug, status, options) => backlog.transitionTask(slug, status, options),
    },
    forgejo: {
      readToken: (user) => forgejo.readToken(user),
      resolveForgejoSettings: (rootDir) => forgejo.resolveForgejoSettings(rootDir),
      createPr: (branch, user, token, options) => forgejo.createPr(branch, user, token, options),
      authenticatedReviewUrl: (user, token, rootDir) => forgejo.authenticatedReviewUrl(user, token, rootDir),
      resolveTrackingBranchSha: (branch, rootDir) => forgejo.resolveTrackingBranchSha(branch, rootDir),
    },
    reviewIdentity: {
      resolveReviewIdentity: (slug, rootDir, options) => resolveReviewIdentity(slug, rootDir, options),
    },
    setupReview: {
      bootstrapReviewSurface: (rootDir, setup, options) => setupReview.bootstrapReviewSurface(rootDir, setup, options),
      get apiRequest() { return setupReview.apiRequest; },
    },
    rebase: {
      rebaseBeforeReviewRound: (slug, options) => rebaseBeforeReviewRound(slug, options),
    },
    gatekeeper: {
      runGatekeeper: (slug, options) => gatekeeper.runGatekeeper(slug, options),
    },
    verification: {
      formatVerificationCommand: (area, rootDir) => formatVerificationCommand(area, rootDir),
      createVerificationProofIdentity: (command, rootDir) => createVerificationProofIdentity(command, rootDir),
      readReusableVerificationProof: (command, rootDir) => readReusableVerificationProof(command, rootDir),
      writeReusableVerificationProof: (command, rootDir, options) => (options === undefined
        ? writeReusableVerificationProof(command, rootDir)
        : writeReusableVerificationProof(command, rootDir, options)),
      runVerificationGate: (area, options) => runVerificationGate(area, options),
    },
    nel: {
      computeNELRecord: (range, options) => computeNELRecord(range, options),
    },
    documentWriter: {
      get write() { return writeJson; },
    },
    productConfig: {
      isForgejoReviewEnabled: (rootDir) => isForgejoReviewEnabled(rootDir),
    },
    agents: {
      startAgent: (step, options) => startAgent(step, options),
    },
    agentSelection: {
      eligibleAgentsForStep: (step, options) => eligibleAgentsForStep(step, options),
      selectAgent: (step, options) => selectAgent(step, options),
    },
    process: {
      spawnSync: (command, args, options) => spawnSync(command, args, options),
    },
  };
}

/**
 * Single use case instance for this adapter. Port methods resolve their module
 * bindings lazily, so one instance stays correct across mocked dependencies.
 */
const ports = createHandoffPorts();
const useCase = new HandoffCommandUseCase(ports);

/** @see HandoffCommandUseCase.verifyHandoff */
function verifyHandoff(slug, options = {}) {
  return useCase.verifyHandoff(slug, options);
}

/** @see HandoffCommandUseCase.performHandoff */
function performHandoff(slug, options = {}) {
  return useCase.performHandoff(slug, options);
}

/** @see HandoffCommandUseCase.resolveHandoffReviewAssignment */
function resolveHandoffReviewAssignment(implementerName, options = {}) {
  return useCase.resolveHandoffReviewAssignment(implementerName, options);
}

/** @see HandoffCommandUseCase.runDeclaredGates */
function runDeclaredGates(missionDir, rootDir, options = {}) {
  return useCase.runDeclaredGates(missionDir, rootDir, options);
}

/** @see HandoffCommandUseCase.validateDeclaredGates */
function validateDeclaredGates(commands, rootDir) {
  return useCase.validateDeclaredGates(commands, rootDir);
}

/** @see HandoffCommandUseCase.captureNelAtHandoff */
function captureNelAtHandoff(slug, options) {
  return useCase.captureNelAtHandoff(slug, options);
}

function evidenceCellHasVerifiableReference(cell, rootDir, knownTestNames) {
  return evidenceCellHasVerifiableReferenceWithPort(ports.fileSystem, cell, rootDir, knownTestNames);
}

function findUnverifiableGoalCheckRow(evidenceRows, rootDir) {
  return findUnverifiableGoalCheckRowWithPort(ports.fileSystem, evidenceRows, rootDir);
}

// Export for testing
export { evidenceCellHasVerifiableReference as _evidenceCellHasVerifiableReference };

// CLI request parsing and process exit handling belong to the interfaces layer.
// The composition root binds this adapter's ports to `createHandoffCommand`.
// Keep this module limited to its concrete adapter bindings and workflow seams.
export {
  buildAutoCheckpointContent as _buildAutoCheckpointContent,
  collectGoalCheckEvidenceRows as _collectGoalCheckEvidenceRows,
  findUnverifiableGoalCheckRow,
  findUnverifiableGoalCheckRow as _findUnverifiableGoalCheckRow,
  verifyHandoff,
  performHandoff,
  resolveHandoffReviewAssignment,
  gatekeeper,
  runDeclaredGates,
  captureNelAtHandoff,
  validateDeclaredGates,
};
