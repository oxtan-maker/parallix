import { resolveVerificationResource, usesAdmittedVerification } from '../../config/product-config.js';
import { assertIndependentGateInvocation } from '../../../application/ports/gate-admission.js';
import { runConfiguredVerification } from '../../verification/configured-verification.js';
import { commitDirtyFiles } from '../../git/commit-dirty-files.js';
import { verificationEnvironment } from '../../config/verification-environment.js';
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
import * as git from '../../git/git.js';
import * as missionUtils from '../../filesystem/mission-utils.js';
import * as backlog from '../../backlog/backlog.js';
import * as forgejo from '../../forgejo/forgejo.js';
import { resolveReviewIdentity } from '../../review/review-state.js';
import * as setupReview from '../../review/setup-review.js';
import * as gatekeeper from '../../verification/gatekeeper.js';
import { formatVerificationCommand, isTransientVerificationFailure, resolveEffectiveArea, runVerificationGate } from '../../verification/verification.js';
import { createActiveVerificationIdentity as createVerificationProofIdentity, readActiveVerificationProof as readReusableVerificationProof, writeActiveVerificationProof as writeReusableVerificationProof } from '../../verification/active-verification-proof.js';
import { isForgejoReviewEnabled } from '../../config/product-config.js';
import { loadPhaseGates, runPhaseGates, runGateCommand, type GateCommandRunner } from '../../config/repository-gates.js';
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
import type { CaptureNelOptions, HandoffWorkflowPorts, PerformHandoffOptions, HandoffMissionServicesPort } from '../../../application/ports/handoff-workflow.js';
import { recordImplementerLaunch } from '../../../application/rebase-identity.js';

function createHandoffFileSystemPorts(): HandoffWorkflowPorts['fileSystem'] {
  return {
    existsSync: (target) => fs.existsSync(target),
    readText: (target) => fs.readFileSync(target, 'utf8'),
    writeText: (target, content) => fs.writeFileSync(target, content, 'utf8'),
    listNames: (target) => fs.readdirSync(target),
    listEntries: (target) => fs.readdirSync(target, { withFileTypes: true }),
  };
}

/**
 * Bind the concrete infrastructure modules to the handoff workflow ports.
 *
 * Every method reaches its module through the imported namespace *at call
 * time*, so a test that swaps a dependency module (see `test/lib/module-mock.ts`)
 * is still observed by the use case.
 */
function declaredCommandRunner(root: string, log: (message: string) => void, configuration?: ParallixConfiguration): GateCommandRunner {
  return async (command, args, options) => {
    const reusable = readReusableVerificationProof(command, root, { configuration });
    if (reusable.ok) {
      log(`  Gate reused proof ${reusable.identity}: ${command}`);
      return { status: 0, stdout: '', stderr: '' };
    }
    const before = createVerificationProofIdentity(command, root, { configuration });
    const result = await runGateCommand(command, args, options);
    if (result.status === 0 && before.ok) {
      const written = writeReusableVerificationProof(command, root, { configuration, expectedIdentity: before.identity });
      if (written.ok) { log(`  Gate executed; stored proof ${written.identity}: ${command}`); }
    }
    return result;
  };
}

function createDeclaredGateExecution(configuration?: ParallixConfiguration): NonNullable<HandoffWorkflowPorts['declaredGateExecution']> {
  return {
    run(commands, root, log) {
      assertIndependentGateInvocation();
      if (!usesAdmittedVerification(root)) { return null; }
      const resource = resolveVerificationResource(root);
      return runPhaseGates('handoff', { configuration, slug: '', checkoutPath: root, log,
        maxParallel: 1, commandRunner: declaredCommandRunner(root, log, configuration), gates: commands.map((command, order) => ({ key: `declared-${order}`, command, order, resource })),
      }).then(result => ({ ok: result.ok, error: result.error ?? undefined,
        gate: result.failedGate?.command ?? commands[0], stdout: result.failedGate?.stdout,
        stderr: result.failedGate?.stderr, exitCode: result.failedGate?.exitCode ?? null }));
    },
  };
}

export function createHandoffPorts(configuration?: ParallixConfiguration, missionServices?: HandoffMissionServicesPort): HandoffWorkflowPorts {
  return {
    declaredGateExecution: createDeclaredGateExecution(configuration),
    fileSystem: createHandoffFileSystemPorts(),
    git: {
      commitMissionChanges: (rootDir, slug, log, error) => commitDirtyFiles(rootDir, slug, args => git.git(args), log, error),
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
      rebaseBeforeReviewRound: (slug, options) => {
        const rebaseOptions = options as Parameters<typeof rebaseBeforeReviewRound>[1];
        return rebaseBeforeReviewRound(slug, {
          ...rebaseOptions,
          rebaseWorkflowOptions: { ...rebaseOptions?.rebaseWorkflowOptions, configuration },
        });
      },
    },
    gatekeeper: {
      runGatekeeper: (slug, options) => gatekeeper.runGatekeeper(slug, { ...options, configuration }),
    },
    repositoryGates: {
      loadPhaseGates: (rootDir, phase) => loadPhaseGates(rootDir, phase),
      runPhaseGates: (phase, options) => runPhaseGates(phase, { ...options, configuration }),
    },
    verification: {
      resolveEffectiveArea: (area, rootDir, missionDir) => resolveEffectiveArea(area, rootDir, missionDir),
      formatVerificationCommand: (area, rootDir) => formatVerificationCommand(area, rootDir),
      createVerificationProofIdentity: (command, rootDir) => createVerificationProofIdentity(command, rootDir, { configuration }),
      readReusableVerificationProof: (command, rootDir) => readReusableVerificationProof(command, rootDir, { configuration }),
      writeReusableVerificationProof: (command, rootDir, options) => writeReusableVerificationProof(command, rootDir, { ...options, configuration }),
      runVerificationGate: (area, options) => usesAdmittedVerification(options.rootDir ?? process.cwd())
        ? runConfiguredVerification(area, options.rootDir ?? process.cwd(), configuration)
        : runVerificationGate(area, { ...options, env: configuration?.forwardedEnvironment }),
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
      startAgent: (step, options) => startAgent(step, { ...options, configuration,
        onLaunch: async event => {
          if (missionServices) {
            const root = String(options.worktree || process.cwd());
            const services = await missionServices(root, { missionDir: root });
            await recordImplementerLaunch(String(options.slug), event.agent, services.store, services.lifecycle);
          }
          if (typeof options.onLaunch === 'function') { await options.onLaunch(event); }
        },
      }),
    },
    agentSelection: {
      eligibleAgentsForStep: (step, options) => eligibleAgentsForStep(step, { ...options, configuration }),
      selectAgent: (step, options) => selectAgent(step, { ...options, configuration }),
    },
    process: {
      spawnSync: (command, args, options) => git.run(command, args, { ...options,
        env: verificationEnvironment(configuration?.forwardedEnvironment ?? { ...process.env }),
      }),
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

/** Checked adapter options; lifecycle authority remains in the application use case. */
type HandoffAdapterOptions = PerformHandoffOptions & {
  configuration?: ParallixConfiguration;
  /** Caller metadata retained for bound handoff mechanisms; the use case resolves its own authority. */
  forgejoUser?: string | null;
  reviewIdentity?: string | null;
};
function performHandoff(slug: string, options: HandoffAdapterOptions = {}) {
  return new HandoffCommandUseCase(createHandoffPorts(options.configuration, options.missionServicesFn)).performHandoff(slug, options);
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
function captureNelAtHandoff(slug: string, options: CaptureNelOptions) {
  return useCase.captureNelAtHandoff(slug, options);
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
