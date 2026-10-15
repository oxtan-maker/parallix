
/**
 * HandoffExecutor — sequences a single handoff invocation (TASK-2332.09).
 *
 * Owns the step ordering of `performHandoff`: repository pre-gates, identity
 * derivation, recorded-checkpoint integrity, repository verification + rebase,
 * NEL capture, Forgejo PR, gatekeeper pre-review, declared-gate execution, and
 * the durable Mission state transition that precedes any Backlog effect.
 *
 * It reaches the outside world only through the injected port bag
 * (`./ports/handoff-workflow.js`). Every collaborator is constructed from that
 * bag; this module imports no adapter.
 */
import { handoffBudgetExceeded } from '../domain/mission-handoff-policy.js';
import * as fmt from './presentation/cli-format.js';
import { AGENT_COMMAND_COMPLETION_CONTRACT } from './agent-completion-contract.js';
import { isDbAdhocIdentity } from '../domain/mission.js';

import { DeclaredGateRunner } from './handoff-declared-gates.js';
import { HandoffContractVerifier, loadRecordedContract } from './handoff-contract.js';
import { GatekeeperRemediation, gatekeeperOutcome } from './handoff-gatekeeper-remediation.js';
import { HandoffForgejoPublisher } from './handoff-forgejo-publication.js';
import { HandoffGateRecovery } from './handoff-gate-recovery.js';
import { HandoffReviewSubmission } from './handoff-review-submission.js';
import { HandoffNelCapture } from './handoff-nel-capture.js';
import type { CaptureNelOptions, HandoffResult, HandoffWorkflowPorts, PerformHandoffOptions } from './ports/handoff-workflow.js';

/**
 * Application entry point for sequencing a handoff.
 *
 * The orchestrator is the single place that knows the handoff order of steps;
 * `HandoffCommandUseCase` composes it alongside the lighter-weight delegating
 * collaborators (gate validation, NEL capture, contract verification).
 */
export class HandoffExecutor {
  private readonly ports: HandoffWorkflowPorts;
  private readonly nel: HandoffNelCapture;
  private readonly contract: HandoffContractVerifier;
  private readonly forgejo: HandoffForgejoPublisher;
  private readonly gatekeeper: GatekeeperRemediation;
  private readonly gateRecovery: HandoffGateRecovery;
  private readonly submission: HandoffReviewSubmission;
  private readonly gates: DeclaredGateRunner;

  constructor(ports: HandoffWorkflowPorts, writeFallbackSummary: HandoffForgejoPublisher['writeFallbackSummary']) {
    this.ports = ports;
    this.nel = new HandoffNelCapture(ports);
    this.gates = new DeclaredGateRunner(ports);
    this.contract = new HandoffContractVerifier(ports);
    this.forgejo = new HandoffForgejoPublisher(ports, writeFallbackSummary);
    this.gatekeeper = new GatekeeperRemediation(ports);
    this.gateRecovery = new HandoffGateRecovery(ports, this.gates);
    this.submission = new HandoffReviewSubmission(ports);
  }

  /**
   * Execute the full handoff for a mission slug, sequencing every step and
   * failing closed on the first unrecoverable condition.
   */
  async performHandoff(slug: string, options: PerformHandoffOptions = {}): Promise<HandoffResult> {
    const ports = this.ports;
    const opts = options;
    const bindings = handoffBindings(ports, opts, this.nel);
    const { skipGate, worktree, forceWithLease, log, error, rebaseFn, runVerificationGateFn, startAgentFn, runGatekeeperFn, occurredAt, recoverGateFailure, captureNel } = bindings;
    const internalLog = (message: string) => {
      if (/\[(WARN|FAIL)\]|failed|failure|conflict|missing|blocked|fallback|degraded/i.test(message)) { log(message); }
    };

    // Recursion guard: prevent infinite retry loops when gatekeeper pushback
    // persists across relaunch attempts. Hard limit of 3 total handoff invocations.
    const { currentAttempt, retriesLeft } = handoffRetryBudget(bindings);
    if (handoffBudgetExceeded(currentAttempt)) {
      const msg = `Handoff exceeded maximum attempts (3). Manual intervention required.`;
      error(msg);
      return { ok: false, error: msg };
    }

    // Global retry budget: controls total relaunch attempts across all recursive calls.
    // Default is 2 (one initial + one retry). Decremented with each relaunch.

    // A recorded contract does not need a directory of legacy Markdown inputs.
    // Load it before location verification, and fail closed on missing DB state.
    const prepared = await this.prepareStart(slug, bindings, opts);
    if (!('contract' in prepared)) { return prepared; }
    const { contract, verification, forgejoUser, forgejoEnabled, isForgejoReviewEnabledFn, missionServicesFn } = prepared;
    const { area, branch, rootDir, missionDir: missionDirPath } = verification;

    const gateStage = {
      rootDir, forgejoUser, log, error, startAgentFn, recoverGateFailure, options: opts,
      retryHandoff: (retrySlug: string, retryOptions: PerformHandoffOptions) => this.performHandoff(retrySlug, retryOptions),
    };
    const verificationOutcome = await this.gateRecovery.verifyRepository(slug, { ...gateStage, skipGate, area, runVerificationGateFn });
    if (verificationOutcome) { return verificationOutcome; }

    const rebaseResult = await rebaseFn(slug, {
      worktree: worktree || undefined,
      log: internalLog,
      error,
      isForgejoReviewEnabledFn: isForgejoReviewEnabledFn,
    });
    const rebaseFailure = handoffRebaseFailure(rebaseResult, rootDir, ports, error);
    if (rebaseFailure) { return rebaseFailure; }

    // architecture invariant: NEL is persisted through SqliteMissionStore.recordNel() via the Mission
    // use case; nel-record.json is no longer staged or committed because the SQLite
    // database is the sole durable authority for Mission state.
    const nelResult = await captureNel(slug, { rootDir, missionDir: missionDirPath, log: internalLog, error, missionServicesFn });
    if (nelResult.ok === false && nelResult.persistenceFailed) {
      const msg = `NEL persistence failed; handoff stopped before review state advanced: ${nelResult.error}`;
      error(msg);
      return { ok: false, error: msg };
    } else if (nelResult.ok === false) {
      log(fmt.status('WARN', `NEL capture skipped: ${nelResult.error}`));
    }

    // Step 2: Forgejo PR Update/Create (optional mirror when Forgejo is enabled)
    const published = await this.forgejo.publishHandoffPr(slug, { forgejoEnabled, rootDir, forgejoUser, branch, forceWithLease, area, log, error, internalLog });
    if (!('token' in published)) { return published; }

    // Step 2.5: Gatekeeper pre-review validation
    // Run before transitioning Backlog to 'review' so missing artifacts are
    // flagged as a request-changes review instead of consuming a reviewer cycle.
    const gatekeeperResult = runGatekeeperFn(slug, { rootDir, log: internalLog, checkpointsRecorded: contract.draftedInDb });
    const gatekeeperVerdict = gatekeeperOutcome(gatekeeperResult, slug, log, error);
    if (gatekeeperVerdict.blocked) { return gatekeeperVerdict.blocked; }

    // Past this branch the gatekeeper never pushed back: the pushback path
    // returns through remediateGatekeeperPushback below. The flag is still
    // carried into the result so callers read one shape either way.
    const gatekeeperPushedBack = false;
    if (gatekeeperVerdict.pushedBack) {
      return await this.gatekeeper.remediateGatekeeperPushback(slug, {
        gatekeeperResult,
        rootDir,
        forgejoUser,
        retriesLeft,
        currentAttempt,
        log,
        error,
        startAgentFn,
        worktree,
        skipGate,
        forceWithLease,
        isForgejoReviewEnabledFn,
        rebaseFn,
        runVerificationGateFn,
        runGatekeeperFn,
        missionServicesFn,
        occurredAt,
        retryHandoff: (retrySlug, retryOptions) => this.performHandoff(retrySlug, retryOptions),
      });
    }

    const declaredGateOutcome = await this.gateRecovery.runDeclaredGates(slug, {
      ...gateStage, contract, missionDir: verification.missionDir || '', missionDirPath, internalLog, missionServicesFn,
    });
    if (declaredGateOutcome) { return declaredGateOutcome; }

    // architecture invariant: Transition Mission state through SqliteMissionStore FIRST.
    // The durable Mission state must commit before any external Backlog effect.
    // Database unavailability fails the operation (architecture invariant: fail-closed).
    return this.completeReview(slug, prepared, published, bindings, internalLog, gatekeeperPushedBack);
  }

  private async completeReview(slug: string, prepared: HandoffStart, published: import('./handoff-forgejo-publication.js').HandoffPublication, bindings: HandoffBindings, internalLog: HandoffBindings['log'], gatekeeperPushedBack: boolean): Promise<HandoffResult> {
    const ports = this.ports;
    const { forgejoUser, forgejoEnabled, missionServicesFn, verification, evidence } = prepared;
    const { rootDir, branch, missionDir: missionDirPath } = verification;
    const { finalCheckpoint, checkpointContent, evidenceRows } = evidence;
    const { token, fallbackUser, submittedPr } = published;
    const { force, occurredAt, eligibleAgentsForStepFn, selectAgentFn, log, error } = bindings;
    const reviewOutcome = await this.submission.submit(slug, {
      rootDir, branch, missionDirPath, forgejoUser, submittedPr, occurredAt, missionServicesFn,
      eligibleAgentsForStepFn, selectAgentFn, log, error,
      checkpoint: finalCheckpoint ? { finalCheckpoint, checkpointContent, evidenceRows } : null,
    });
    if (reviewOutcome) { return reviewOutcome; }
    const taskImplementer = forgejoUser;
    if (!await ports.backlog.transitionTask(slug, 'review', { implementer: taskImplementer, rootDir, log: internalLog })) {
      // A DB-owned adhoc identity has no Backlog mirror to transition; the
      // authoritative lifecycle transition above already recorded the review
      // state. Backlog-backed missions keep the hard failure.
      if (!isDbAdhocIdentity(slug)) {
        const msg = `Could not transition task ${fmt.slug(slug)} to review.`;
        error(msg);
        return { ok: false, error: msg };
      }
      log(fmt.status('WARN', `No Backlog mirror to transition for DB-owned adhoc identity ${fmt.slug(slug)}; DB-authoritative lifecycle already recorded the review transition.`));
    }

    if (forgejoEnabled && token) {
      const pushOutcome = this.forgejo.pushBacklogTransition(slug, {
        rootDir,
        branch,
        token,
        fallbackUser,
        forgejoUser,
        force,
        log: internalLog,
        error,
        gatekeeperPushedBack,
      });
      if (pushOutcome) { return pushOutcome; }
    }

    log(fmt.status('PASS', 'Implementation is ready for independent review.'));
    return { ok: true, gatekeeperPushedBack };
  }

  private async prepareStart(slug: string, bindings: HandoffBindings, opts: PerformHandoffOptions): Promise<HandoffStart | HandoffResult> {
    const ports = this.ports;
    const { worktree, missionServicesFn, log, error } = bindings;
    const launchRoot = process.cwd();
    const contractRoot = worktree || ports.missionUtils.resolveWorktree(slug, { cwd: launchRoot }) || launchRoot;
    const contractDir = ports.missionUtils.findMissionDir(slug, contractRoot) || contractRoot;
    if (!missionServicesFn) {
      const msg = `Could not read Mission ${slug} from the operator database: mission services are not configured. Handoff fails closed.`;
      error(msg);
      return { ok: false, error: msg };
    }
    const contract = await loadRecordedContract(missionServicesFn, contractRoot, contractDir, slug);
    if (contract.ok === false) {
      error(contract.error);
      return { ok: false, error: contract.error };
    }
    const verification = this.verifyHandoff(slug, { worktree: contractRoot, recordedContract: contract.draftedInDb });
    if (verification.ok === false) {
      error(verification.error);
      return { ok: false, error: verification.error };
    }

    const { missionDir } = verification;
    const rootDir = verification.rootDir;
    const missionDirPath = missionDir;

    // Step -1: Repository-configured pre-handoff gates (TASK-2457). These run
    // from the handoff checkout before any lifecycle transition. An unconfigured
    // repository runs no gate; a configured gate that exits non-zero blocks
    // handoff and leaves the task in its current lane (active), never advancing
    // to review.
    const preGateFailure = await runPreHandoffGates(slug, rootDir, bindings, ports);
    if (preGateFailure) { return preGateFailure; }

    // Step 0: Resolve Backlog task for identity derivation.
    // A DB-owned adhoc identity (`px-<NNNN>`) is authoritative in the
    // operator database; its Backlog task file is a best-effort one-way mirror
    // only. A missing or deleted mirror must not block handoff — the identity
    // and lifecycle are DB-authoritative. Backlog-backed missions keep the strict
    // contract: a missing task file is still a hard failure.
    const taskResolution = ports.backlog.resolveTaskFile(slug, rootDir);
    const identityFailure = handoffTaskFailure(slug, taskResolution, log, error);
    if (identityFailure) { return identityFailure; }

    // Pre-handoff Content Integrity Check
    // Checkpoint evidence recorded through `px checkpoint record` is the
    // authority. When the Mission already carries recorded evidence, handoff
    // verifies that and never looks for a checkpoint document: the document
    // path is the legacy fallback for missions whose evidence still only exists
    // as a committed `CP-N.md`.
    const evidence = this.contract.verifyCheckpointEvidence(slug, contract, { rootDir, missionDirPath, log, error });
    if (!('finalCheckpoint' in evidence)) { return evidence; }

    const isForgejoReviewEnabledFn = opts.isForgejoReviewEnabledFn || ports.productConfig.isForgejoReviewEnabled;
    const forgejoEnabled = isForgejoReviewEnabledFn(rootDir);

    const { forgejoUser: reviewStateUser } = await ports.reviewIdentity.resolveReviewIdentity(slug, rootDir);
    // Implementer derivation: prefer the review state, then the Backlog mirror
    // (Backlog-backed missions), then the DB-authoritative mission store's
    // assignee (DB-owned adhoc identities whose mirror was deleted).
    const forgejoUser = reviewStateUser
      || (taskResolution.taskFile ? ports.backlog.getTaskImplementer(taskResolution.taskFile) : null)
      || (await this.contract.deriveImplementerFromMissionStore(slug, missionServicesFn, rootDir, missionDirPath));

    if (!forgejoUser) {
      error('forgejoUser is required for performHandoff. Ensure the mission Review or the Backlog task has an agent family assigned.');
      return { ok: false, error: 'forgejoUser is required' };
    }

    return { contract, verification, evidence, forgejoUser, forgejoEnabled, isForgejoReviewEnabledFn, missionServicesFn };
  }

  /**
   * Verifies that the current environment is ready for handoff.
   */
  verifyHandoff(slug: string, options: { worktree?: string; recordedContract?: boolean } = {}):
    | { ok: false; error: string }
    | { ok: true; missionDir: string; area: string; branch: string; rootDir: string } {
    const { git, missionUtils } = this.ports;
    const launchRoot = process.cwd();
    const rootDir = options.worktree || missionUtils.resolveWorktree(slug, { cwd: launchRoot }) || launchRoot;
    const missionDir = missionUtils.findMissionDir(slug, rootDir);
    if (!missionDir && !options.recordedContract) {
      return { ok: false, error: `Mission directory not found for slug: ${slug}` };
    }

    const area = this.ports.verification.resolveEffectiveArea(undefined, rootDir, missionDir);
    const branch = missionUtils.missionBranchName(slug, rootDir);
    const current = git.getCurrentBranch(rootDir);

    if (current !== branch) {
      return { ok: false, error: `Not on mission branch. Current: ${current}, Expected: ${branch}` };
    }

    return { ok: true, missionDir: missionDir || rootDir, area, branch, rootDir };
  }

  validateDeclaredGates(...args: Parameters<DeclaredGateRunner['validateDeclaredGates']>) {
    return this.gates.validateDeclaredGates(...args);
  }

  runDeclaredGates(...args: Parameters<DeclaredGateRunner['runDeclaredGates']>) {
    return this.gates.runDeclaredGates(...args);
  }

  executeGateCommands(...args: Parameters<DeclaredGateRunner['executeGateCommands']>) {
    return this.gates.executeGateCommands(...args);
  }

  captureNelAtHandoff(...args: Parameters<HandoffNelCapture['captureNelAtHandoff']>) {
    return this.nel.captureNelAtHandoff(...args);
  }

  resolveHandoffReviewAssignment(...args: Parameters<HandoffReviewSubmission['resolveHandoffReviewAssignment']>) {
    return this.submission.resolveHandoffReviewAssignment(...args);
  }
}

function handoffBindings(ports: HandoffWorkflowPorts, opts: PerformHandoffOptions, nel: HandoffNelCapture) {
  const {
    skipGate = false,
    worktree = null,
    force = false,
    forceWithLease = true,
    log = fmt.log.info,
    error = fmt.log.fail,
    rebaseFn = ports.rebase.rebaseBeforeReviewRound,
    runVerificationGateFn = ports.verification.runVerificationGate,
    maxAttempts,
    startAgentFn = ports.agents.startAgent,
    remainingRetries,
    runGatekeeperFn = ports.gatekeeper.runGatekeeper,
    captureNelFn,
    // TASK-2379 review round 1 (F1): lifecycle recovery re-invokes this
    // operation for a review that actually entered earlier; the caller
    // then passes the authoritative entry timestamp. A genuine handoff
    // passes nothing and keeps the wall clock — the handoff happens now.
    occurredAt = new Date().toISOString(),
    missionServicesFn = ports.missionServices,
    recoverGateFailure = false
  } = opts;
  const { eligibleAgentsForStepFn, selectAgentFn } = handoffSelectionBindings(ports, opts);
  const captureNel = captureNelFn || ((nelSlug: string, nelOptions: CaptureNelOptions) => nel.captureNelAtHandoff(nelSlug, nelOptions));
  return { skipGate, worktree, force, forceWithLease, log, error, rebaseFn, runVerificationGateFn, maxAttempts, startAgentFn, remainingRetries, runGatekeeperFn, occurredAt, missionServicesFn, eligibleAgentsForStepFn, selectAgentFn, recoverGateFailure, captureNel };
}

type HandoffBindings = ReturnType<typeof handoffBindings>;
interface HandoffStart {
  contract: import('./handoff-contract.js').RecordedContract;
  verification: Extract<ReturnType<HandoffExecutor['verifyHandoff']>, { ok: true }>;
  evidence: import('./handoff-contract.js').VerifiedCheckpointDocument;
  forgejoUser: string; forgejoEnabled: boolean;
  isForgejoReviewEnabledFn: HandoffWorkflowPorts['productConfig']['isForgejoReviewEnabled'];
  missionServicesFn: NonNullable<HandoffBindings['missionServicesFn']>;
}
function handoffRebaseFailure(rebaseResult: Awaited<ReturnType<HandoffWorkflowPorts['rebase']['rebaseBeforeReviewRound']>>, rootDir: string, ports: HandoffWorkflowPorts, error: HandoffBindings['error']): HandoffResult | null {
  if (!rebaseResult.ok) {
    if (rebaseResult.sharedFileConflicts) {
      const msg = `Rebase encountered shared-file conflicts. ${AGENT_COMMAND_COMPLETION_CONTRACT} Resolve the conflicts in the worktree, then re-run handoff.`;
      error(msg);
      return { ok: false, error: msg };
    } else if (rebaseResult.failure?.kind === 'gate') {
      // The rebase succeeded; the push-time verification gate did not. Keep
      // its process evidence so the rebound kernel classifies it as a gate
      // failure and the implementer sees the command and output, instead of
      // being told to fix a rebase that already works.
      const { gate } = rebaseResult.failure;
      const msg = `Pre-review push gate failed for area "${gate.area}": ${gate.command} exited with code ${gate.exitCode}.`;
      error(msg);
      return {
        ok: false,
        error: msg,
        gateOutput: { stdout: gate.stdout, stderr: gate.stderr },
        gateFailure: {
          area: gate.area, command: gate.command, cwd: rootDir, exitCode: gate.exitCode,
          stdout: gate.stdout, stderr: gate.stderr,
          ...(ports.verification.isTransientVerificationFailure({ stdout: gate.stdout, stderr: gate.stderr }) ? { transient: true } : {}),
        },
      };
    } else {
      const msg = 'Rebase failed before handoff. Ensure the mission branch can be rebased onto the latest primary branch.';
      error(msg);
      return { ok: false, error: msg };
    }
  }

  return null;
}

async function runPreHandoffGates(slug: string, rootDir: string, bindings: HandoffBindings, ports: HandoffWorkflowPorts): Promise<HandoffResult | null> {
  const { skipGate, log, error } = bindings;
  if (!skipGate) {
    const preHandoffResult = await ports.repositoryGates.runPhaseGates('handoff', {
      slug,
      checkoutPath: rootDir,
      log: (/** @type {string} */ msg: string) => log(msg),
      error: (/** @type {string} */ msg: string) => error(msg),
    });
    if (!preHandoffResult.ok && !preHandoffResult.skipped) {
      const msg = `Pre-handoff gate "${preHandoffResult.failedGate?.key}" failed for ${fmt.slug(slug)}: ${preHandoffResult.error}`;
      error(msg);
      return { ok: false, error: msg, reason: 'gate-failed' };
    }
  }

  return null;
}

function handoffTaskFailure(slug: string, taskResolution: ReturnType<HandoffWorkflowPorts['backlog']['resolveTaskFile']>, log: HandoffBindings['log'], error: HandoffBindings['error']): HandoffResult | null {
  const dbAdhocIdentity = isDbAdhocIdentity(slug);
  if (!taskResolution.ok && !dbAdhocIdentity) {
    const msg = `Backlog task file for ${fmt.slug(slug)} not found or ambiguous: ${taskResolution.reason}.`;
    error(msg);
    return { ok: false, error: msg };
  }
  if (dbAdhocIdentity && !taskResolution.ok) {
    log(fmt.status('WARN', `No Backlog mirror for DB-owned adhoc identity ${fmt.slug(slug)}; identity and lifecycle are DB-authoritative.`));
  }

  return null;
}

function handoffSelectionBindings(ports: HandoffWorkflowPorts, opts: PerformHandoffOptions) {
  const { eligibleAgentsForStepFn = ports.agentSelection.eligibleAgentsForStep, selectAgentFn = ports.agentSelection.selectAgent } = opts;
  return { eligibleAgentsForStepFn, selectAgentFn };
}
function handoffRetryBudget(bindings: HandoffBindings) {
  return { currentAttempt: bindings.maxAttempts || 1, retriesLeft: bindings.remainingRetries !== undefined ? bindings.remainingRetries : 2 };
}
