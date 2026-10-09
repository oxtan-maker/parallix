import type { ParallixConfiguration } from '../../../application/ports/configuration.js';
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
import { createVerificationProofIdentity, formatVerificationCommand, isTransientVerificationFailure, readReusableVerificationProof, runVerificationGate, writeReusableVerificationProof } from '../../verification/verification.js';
import { isForgejoReviewEnabled } from '../../config/product-config.js';
import { loadPhaseGates, runPhaseGates } from '../../config/repository-gates.js';
import { rebaseBeforeReviewRound } from '../../review/rebase.js';
import { computeNELRecord } from '../../git/net-engineering-lines.js';
import { writeJson } from '../../storage/storage.js';
import { eligibleAgentsForStep, selectAgent, startAgent } from '../../agents/agents.js';
import {
  HandoffCommandUseCase,
} from '../../../application/handoff-command-use-case.js';
import {
  collectGoalCheckEvidenceRows,
  findUnverifiableGoalCheckRow as findUnverifiableGoalCheckRowWithPort,
} from '../../review/review-static-evidence.js';
import type { CaptureNelOptions, HandoffWorkflowPorts, PerformHandoffOptions } from '../../../application/ports/handoff-workflow.js';

/**
 * Bind the concrete infrastructure modules to the handoff workflow ports.
 *
 * Every method reaches its module through the imported namespace *at call
 * time*, so a test that swaps a dependency module (see `test/lib/module-mock.ts`)
 * is still observed by the use case.
 */
export function createHandoffPorts(configuration?: ParallixConfiguration): HandoffWorkflowPorts {
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
      readToken: (user) => forgejo.readToken(user, undefined, configuration),
      resolveForgejoSettings: (rootDir) => forgejo.resolveForgejoSettings(rootDir, configuration),
      createPr: (branch, user, token, options) => forgejo.createPr(branch, user, token, { ...options, configuration }),
      authenticatedReviewUrl: (user, token, rootDir) => forgejo.authenticatedReviewUrl(user, token, rootDir, configuration),
      resolveTrackingBranchSha: (branch, rootDir) => forgejo.resolveTrackingBranchSha(branch, rootDir),
    },
    reviewIdentity: {
      resolveReviewIdentity: (slug, rootDir) => resolveReviewIdentity(slug, rootDir),
    },
    setupReview: {
      bootstrapReviewSurface: (rootDir, setup, options) => setupReview.bootstrapReviewSurface(rootDir, setup, options),
      get apiRequest() { return setupReview.apiRequest; },
    },
    rebase: {
      rebaseBeforeReviewRound: (slug, options) => rebaseBeforeReviewRound(slug, options),
    },
    gatekeeper: {
      runGatekeeper: (slug, options) => gatekeeper.runGatekeeper(slug, { ...options, configuration }),
    },
    repositoryGates: {
      loadPhaseGates: (rootDir, phase) => loadPhaseGates(rootDir, phase),
      runPhaseGates: (phase, options) => runPhaseGates(phase, { ...options, configuration }),
    },
    verification: {
      formatVerificationCommand: (area, rootDir) => formatVerificationCommand(area, rootDir),
      createVerificationProofIdentity: (command, rootDir) => createVerificationProofIdentity(command, rootDir),
      readReusableVerificationProof: (command, rootDir) => readReusableVerificationProof(command, rootDir, { configuration }),
      writeReusableVerificationProof: (command, rootDir, options) => writeReusableVerificationProof(command, rootDir, { ...options, configuration }),
      runVerificationGate: (area, options) => runVerificationGate(area, options),
      isTransientVerificationFailure: (output) => isTransientVerificationFailure(output),
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
      startAgent: (step, options) => startAgent(step, { ...options, configuration } as unknown as Parameters<typeof startAgent>[1]),
    },
    agentSelection: {
      eligibleAgentsForStep: (step, options) => eligibleAgentsForStep(step, { ...options, configuration }),
      selectAgent: (step, options) => selectAgent(step, { ...options, configuration }),
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

type UseCaseArgs<K extends keyof HandoffCommandUseCase> = HandoffCommandUseCase[K] extends (..._args: infer A) => unknown ? A : never;

/** @see HandoffCommandUseCase.verifyHandoff */
function verifyHandoff(...args: UseCaseArgs<'verifyHandoff'>) {
  return useCase.verifyHandoff(...args);
}

/**
 * @see HandoffCommandUseCase.performHandoff
 *
 * Legacy callers hand this seam a loose option bag (some still pass identity
 * hints the workflow never reads); the use case reads only its typed options.
 */
function performHandoff(slug: string, options: Record<string, unknown> & { configuration?: ParallixConfiguration } = {}) {
  return new HandoffCommandUseCase(createHandoffPorts(options.configuration)).performHandoff(slug, options as PerformHandoffOptions);
}

/** @see HandoffCommandUseCase.resolveHandoffReviewAssignment */
function resolveHandoffReviewAssignment(...args: UseCaseArgs<'resolveHandoffReviewAssignment'>) {
  return useCase.resolveHandoffReviewAssignment(...args);
}

/** @see HandoffCommandUseCase.runDeclaredGates */
function runDeclaredGates(...args: UseCaseArgs<'runDeclaredGates'>) {
  return useCase.runDeclaredGates(...args);
}

/** @see HandoffCommandUseCase.validateDeclaredGates */
function validateDeclaredGates(...args: UseCaseArgs<'validateDeclaredGates'>) {
  return useCase.validateDeclaredGates(...args);
}

/** @see HandoffCommandUseCase.captureNelAtHandoff */
function captureNelAtHandoff(slug: string, options: Record<string, unknown>) {
  return useCase.captureNelAtHandoff(slug, options as unknown as CaptureNelOptions);
}

function findUnverifiableGoalCheckRow(evidenceRows: string[], rootDir: string) {
  return findUnverifiableGoalCheckRowWithPort(ports.fileSystem, evidenceRows, rootDir);
}

// CLI request parsing and process exit handling belong to the interfaces layer.
// The composition root binds this adapter's ports to `createHandoffCommand`.
// Keep this module limited to its concrete adapter bindings and workflow seams.
export {
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
