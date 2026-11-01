import { missionId } from '../domain/mission.js';
import { transitionReviewRepair } from './review-repair-lifecycle.js';

/**
 * ReviewPreparationExecutor — sequences a single review preparation invocation (TASK-2332.09).
 *
 * Owns the step ordering of `performReviewPreparation`: repository pre-gates, identity
 * derivation, recorded-checkpoint integrity, repository verification + rebase,
 * NEL capture, Forgejo PR, gatekeeper pre-review, declared-gate execution, and
 * the durable Mission state transition that precedes any Backlog effect.
 *
 * It reaches the outside world only through the injected port bag
 * (`./ports/review-preparation-workflow.js`). Every collaborator is constructed from that
 * bag; this module imports no adapter.
 */
import { reviewPreparationBudgetExceeded } from "../domain/mission-review-preparation-policy.js";
import * as fmt from './presentation/cli-format.js';
import { isDbAdhocIdentity } from '../domain/mission.js';

import { DeclaredGateRunner } from "./review-preparation-declared-gates.js";
import { ReviewPreparationContractVerifier, loadRecordedContract } from "./review-preparation-contract.js";
import { GatekeeperRemediation, gatekeeperOutcome } from "./review-preparation-gatekeeper-remediation.js";
import { type ReviewPreparationFallbackWriter, ReviewPreparationForgejoPublisher } from "./review-preparation-forgejo-publication.js";
import { ReviewPreparationGateRecovery, reviewPreparationRebaseFailure } from "./review-preparation-gate-recovery.js";
import { ReviewSubmissionService, beginReviewPreparation, recordReviewPreparationFailure } from "./review-submission-service.js";
import { ReviewPreparationNelCapture } from "./review-preparation-nel-capture.js";
import type { CaptureNelOptions, ReviewPreparationResult, ReviewPreparationWorkflowPorts, PerformReviewPreparationOptions } from "./ports/review-preparation-workflow.js";

/**
 * Application entry point for sequencing a review preparation.
 *
 * The orchestrator is the single place that knows the review preparation order of steps;
 * `ReviewPreparationCommandUseCase` composes it alongside the lighter-weight delegating
 * collaborators (gate validation, NEL capture, contract verification).
 */
export class ReviewPreparationExecutor {
  private readonly ports: ReviewPreparationWorkflowPorts;
  private readonly nel: ReviewPreparationNelCapture;
  private readonly contract: ReviewPreparationContractVerifier;
  private readonly forgejo: ReviewPreparationForgejoPublisher;
  private readonly gatekeeper: GatekeeperRemediation;
  private readonly gateRecovery: ReviewPreparationGateRecovery;
  private readonly submission: ReviewSubmissionService;
  private readonly gates: DeclaredGateRunner;

  constructor(ports: ReviewPreparationWorkflowPorts, writeFallbackSummary: ReviewPreparationFallbackWriter) {
    this.ports = ports;
    this.nel = new ReviewPreparationNelCapture(ports);
    this.gates = new DeclaredGateRunner(ports);
    this.contract = new ReviewPreparationContractVerifier(ports);
    this.forgejo = new ReviewPreparationForgejoPublisher(ports, writeFallbackSummary);
    this.gatekeeper = new GatekeeperRemediation(ports);
    this.gateRecovery = new ReviewPreparationGateRecovery(ports, this.gates);
    this.submission = new ReviewSubmissionService(ports);
  }

  /**
   * Execute the full review preparation for a mission slug, sequencing every step and
   * failing closed on the first unrecoverable condition.
   */
  async performReviewPreparation(slug: string, options: PerformReviewPreparationOptions = {}): Promise<ReviewPreparationResult> {
    const bindings = reviewPreparationBindings(this.ports, options, this.nel);
    const refusal = validateReviewPreparationRequest(slug, options, bindings, this.ports);
    if (refusal) { return refusal; }
    const root = bindings.worktree || this.ports.missionUtils.resolveWorktree(slug, { cwd: process.cwd() }) || process.cwd();
    if (!bindings.missionServicesFn) { return { ok: false, error: "mission services are not configured. Review preparation fails closed." }; }
    let services: Awaited<ReturnType<NonNullable<ReviewPreparationBindings['missionServicesFn']>>>;
    try {
      services = await bindings.missionServicesFn(root, { missionDir: root });
      await beginReviewPreparation(slug, services);
    } catch (cause) {
      return { ok: false, error: `Mission state transition failed: ${cause instanceof Error ? cause.message : String(cause)}. Review preparation fails closed.` };
    }
    const result = await this.prepareReview(slug, options);
    if (!result.ok && result.error) { await recordReviewPreparationFailure(slug, result.error, services, result.recoveryFailure ?? (result.gateFailure ? { kind: 'gate-failure', ...result.gateFailure } : undefined)); }
    return bindings.recoverGateFailure ? this.gateRecovery.repairPreparationFailure(slug, result, { root, services, startAgent: bindings.startAgentFn,
      verify: () => this.performReviewPreparation(slug, { ...options, recoverGateFailure: false }), log: bindings.log, error: bindings.error,
      attempts: reviewPreparationRetryBudget(bindings).retriesLeft }) : result;
  }

  private async prepareReview(slug: string, options: PerformReviewPreparationOptions): Promise<ReviewPreparationResult> {
    const ports = this.ports;
    const opts = options;
    const bindings = reviewPreparationBindings(ports, opts, this.nel);
    const { skipGate, worktree, forceWithLease, log, error, rebaseFn, runVerificationGateFn, startAgentFn, runGatekeeperFn, occurredAt, recoverGateFailure, captureNel } = bindings;
    const internalLog = (message: string) => {
      if (/\[(WARN|FAIL)\]|failed|failure|conflict|missing|blocked|fallback|degraded/i.test(message)) { log(message); }
    };

    // Recursion guard: prevent infinite retry loops when gatekeeper pushback
    // persists across relaunch attempts. Hard limit of 3 total review preparation invocations.
    const { currentAttempt, retriesLeft } = reviewPreparationRetryBudget(bindings);
    const requestFailure = validateReviewPreparationRequest(slug, opts, bindings, ports);
    if (requestFailure) { error(requestFailure.error); return requestFailure; }

    // A recorded contract does not need a directory of legacy Markdown inputs.
    // Load it before location verification, and fail closed on missing DB state.
    const prepared = await this.prepareCommittedStart(slug, bindings, opts);
    if (!('contract' in prepared)) { return prepared; }
    const { contract, verification, forgejoEnabled, isForgejoReviewEnabledFn, missionServicesFn } = prepared;
    const { area, branch, rootDir, missionDir: missionDirPath } = verification;

    const gateStage = {
      rootDir, forgejoUser: prepared.forgejoUser, log, error, startAgentFn, recoverGateFailure, options: opts,
      transitionToImplementer: async () => {
        const services = await missionServicesFn(rootDir, { missionDir: missionDirPath });
        const loaded = await services.store.load(missionId(slug));
        if (loaded.kind === 'found' && loaded.mission.assignee) { await transitionReviewRepair(slug, 'active', loaded.mission.assignee, services.store, services.lifecycle); }
      },
      retryReviewPreparation: (retrySlug: string, retryOptions: PerformReviewPreparationOptions) => this.performReviewPreparation(retrySlug, retryOptions),
    };
    const verificationOutcome = await this.gateRecovery.verifyRepository(slug, { ...gateStage, skipGate, area, runVerificationGateFn });
    if (verificationOutcome) { return verificationOutcome; }

    const rebased = await this.rebaseForReviewPreparation(slug, bindings, prepared, internalLog);
    if ('ok' in rebased) { return rebased; }
    const { forgejoUser } = rebased;
    prepared.forgejoUser = forgejoUser;

    // NEL is persisted once through the checked Mission
    // use case; nel-record.json is no longer staged or committed because the SQLite
    // database is the sole durable authority for Mission state.
    const nelResult = await captureNel(slug, { rootDir, missionDir: missionDirPath, log: internalLog, error, missionServicesFn });
    if (nelResult.ok === false && nelResult.persistenceFailed) {
      const msg = `NEL persistence failed; review preparation stopped before review state advanced: ${nelResult.error}`;
      error(msg);
      return { ok: false, error: msg };
    } else if (nelResult.ok === false) {
      log(fmt.status('WARN', `NEL capture skipped: ${nelResult.error}`));
    }

    // Step 2: Forgejo PR Update/Create (optional mirror when Forgejo is enabled)
    const published = await this.forgejo.publishReviewPreparationPr(slug, { forgejoEnabled, rootDir, forgejoUser, branch, forceWithLease, area, log, error, internalLog });
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
        transitionToImplementer: gateStage.transitionToImplementer,
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
        reviewer: options.reviewer,
        retryReviewPreparation: (retrySlug, retryOptions) => this.performReviewPreparation(retrySlug, retryOptions),
      });
    }

    const declaredGateOutcome = await this.gateRecovery.runDeclaredGates(slug, {
      ...gateStage, contract, missionDir: verification.missionDir || '', missionDirPath, internalLog, missionServicesFn,
    });
    if (declaredGateOutcome) { return declaredGateOutcome; }

    // architecture invariant: Transition Mission state through SqliteMissionStore FIRST.
    // The durable Mission state must commit before any external Backlog effect.
    // Database unavailability fails the operation (architecture invariant: fail-closed).
    return this.completeReview(slug, prepared, published, bindings, internalLog, gatekeeperPushedBack, options.reviewer);
  }

  /** Rebase onto the base branch, then re-read the implementer a repair may have replaced. */
  private async rebaseForReviewPreparation(slug: string, bindings: ReviewPreparationBindings, prepared: ReviewPreparationStart, internalLog: ReviewPreparationBindings['log']): Promise<ReviewPreparationResult | { forgejoUser: string }> {
    const { rebaseFn, worktree, error } = bindings;
    const { verification, isForgejoReviewEnabledFn, missionServicesFn } = prepared;
    const { rootDir, missionDir: missionDirPath } = verification;
    const rebaseResult = await rebaseFn(slug, {
      missionIdentityServices: async root => {
        const services = await missionServicesFn(root, { missionDir: missionDirPath });
        return { store: services.store, lifecycle: services.lifecycle };
      },
      worktree: worktree || undefined,
      log: internalLog,
      error,
      isForgejoReviewEnabledFn,
    });
    const rebaseFailure = reviewPreparationRebaseFailure(rebaseResult, rootDir, this.ports, error);
    if (rebaseFailure) { return rebaseFailure; }
    // A repair can launch a replacement implementer. Publication must use the
    // identity committed by that launch, not the pre-repair credential choice.
    const current = await loadRecordedContract(missionServicesFn, rootDir, missionDirPath, slug);
    if (!current.ok) { return { ok: false, error: current.error }; }
    const drift = implementerIdentityFailure(slug, current);
    if (drift) { error(drift); return { ok: false, error: drift }; }
    return { forgejoUser: current.implementer! };
  }

  private async completeReview(slug: string, prepared: ReviewPreparationStart, published: import("./review-preparation-forgejo-publication.js").ReviewPreparationPublication, bindings: ReviewPreparationBindings, internalLog: ReviewPreparationBindings['log'], gatekeeperPushedBack: boolean, reviewer?: import('../domain/agents.js').AgentFamily): Promise<ReviewPreparationResult> {
    const ports = this.ports;
    const { forgejoUser, forgejoEnabled, missionServicesFn, verification, evidence } = prepared;
    const { rootDir, branch, missionDir: missionDirPath } = verification;
    const { finalCheckpoint, checkpointContent, evidenceRows } = evidence;
    const { token, fallbackUser, submittedPr } = published;
    const { force, occurredAt, eligibleAgentsForStepFn, selectAgentFn, log, error } = bindings;
    const reviewOutcome = await this.submission.submit(slug, {
      rootDir, branch, missionDirPath, forgejoUser, submittedPr, occurredAt, missionServicesFn,
      eligibleAgentsForStepFn, selectAgentFn, log, error,
      reviewer,
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

  private async prepareCommittedStart(slug: string, bindings: ReviewPreparationBindings, opts: PerformReviewPreparationOptions): Promise<ReviewPreparationStart | ReviewPreparationResult> {
    const prepared = await this.prepareStart(slug, bindings, opts);
    if (!('contract' in prepared)) { return prepared; }
    const { blocker } = this.ports.git.commitMissionChanges(prepared.verification.rootDir, slug, bindings.log, bindings.error);
    if (blocker) {
      return { ok: false, error: blocker };
    }
    return prepared;
  }

  private async prepareStart(slug: string, bindings: ReviewPreparationBindings, opts: PerformReviewPreparationOptions): Promise<ReviewPreparationStart | ReviewPreparationResult> {
    const ports = this.ports;
    const { worktree, missionServicesFn, log, error } = bindings;
    const launchRoot = process.cwd();
    const contractRoot = worktree || ports.missionUtils.resolveWorktree(slug, { cwd: launchRoot }) || launchRoot;
    const contractDir = ports.missionUtils.findMissionDir(slug, contractRoot) || contractRoot;
    if (!missionServicesFn) {
      const msg = `Could not read Mission ${slug} from the operator database: mission services are not configured. Review preparation fails closed.`;
      error(msg);
      return { ok: false, error: msg };
    }
    const contract = await loadRecordedContract(missionServicesFn, contractRoot, contractDir, slug);
    if (contract.ok === false) {
      error(contract.error);
      return { ok: false, error: contract.error };
    }
    const verification = this.verifyReviewPreparation(slug, { worktree: contractRoot, recordedContract: contract.draftedInDb });
    if (verification.ok === false) {
      error(verification.error);
      return { ok: false, error: verification.error };
    }

    const { missionDir } = verification;
    const rootDir = verification.rootDir;
    const missionDirPath = missionDir;

    // Repository preparation runs after review entry; its actual failure decides repair.
    const preGateFailure = await runPreReviewPreparationGates(slug, rootDir, bindings, ports);
    if (preGateFailure) { return preGateFailure; }

    // Step 0: Resolve Backlog task for identity derivation.
    // A DB-owned adhoc identity (`px-<NNNN>`) is authoritative in the
    // operator database; its Backlog task file is a best-effort one-way mirror
    // only. A missing or deleted mirror must not block review preparation — the identity
    // and lifecycle are DB-authoritative. Backlog-backed missions keep the strict
    // contract: a missing task file is still a hard failure.
    const taskResolution = ports.backlog.resolveTaskFile(slug, rootDir);
    const identityFailure = reviewPreparationTaskFailure(slug, taskResolution, log, error);
    if (identityFailure) { return identityFailure; }

    // Pre-review preparation Content Integrity Check
    // Checkpoint evidence recorded through `px checkpoint record` is the
    // authority. When the Mission already carries recorded evidence, review preparation
    // verifies that and never looks for a checkpoint document: the document
    // path is the legacy fallback for missions whose evidence still only exists
    // as a committed `CP-N.md`.
    const evidence = this.contract.verifyCheckpointEvidence(slug, contract, { rootDir, missionDirPath, log, error });
    if (!('finalCheckpoint' in evidence)) { return evidence; }

    const isForgejoReviewEnabledFn = opts.isForgejoReviewEnabledFn || ports.productConfig.isForgejoReviewEnabled;
    const forgejoEnabled = isForgejoReviewEnabledFn(rootDir);

    const forgejoUser = contract.implementer;

    const identityDrift = implementerIdentityFailure(slug, contract);
    if (identityDrift || !forgejoUser) {
      const msg = identityDrift ?? '';
      error(msg);
      return { ok: false, error: msg };
    }

    return { contract, verification, evidence, forgejoUser, forgejoEnabled, isForgejoReviewEnabledFn, missionServicesFn };
  }

  /**
   * Verifies that the current environment is ready for review preparation.
   */
  verifyReviewPreparation(slug: string, options: { worktree?: string; recordedContract?: boolean } = {}):
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

  captureNelAtReviewPreparation(...args: Parameters<ReviewPreparationNelCapture["captureNelAtReviewPreparation"]>) {
    return this.nel.captureNelAtReviewPreparation(...args);
  }

  resolveReviewPreparationReviewAssignment(...args: Parameters<ReviewSubmissionService["resolveReviewPreparationReviewAssignment"]>) {
    return this.submission.resolveReviewPreparationReviewAssignment(...args);
  }
}

function reviewPreparationBindings(ports: ReviewPreparationWorkflowPorts, opts: PerformReviewPreparationOptions, nel: ReviewPreparationNelCapture) {
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
    // then passes the authoritative entry timestamp. A genuine review preparation
    // passes nothing and keeps the wall clock — the review preparation happens now.
    occurredAt = new Date().toISOString(),
    missionServicesFn = ports.missionServices,
    recoverGateFailure = false
  } = opts;
  const { eligibleAgentsForStepFn, selectAgentFn } = reviewPreparationSelectionBindings(ports, opts);
  const captureNel = captureNelFn || ((nelSlug: string, nelOptions: CaptureNelOptions) => nel.captureNelAtReviewPreparation(nelSlug, nelOptions));
  return { skipGate, worktree, force, forceWithLease, log, error, rebaseFn, runVerificationGateFn, maxAttempts, startAgentFn, remainingRetries, runGatekeeperFn, occurredAt, missionServicesFn, eligibleAgentsForStepFn, selectAgentFn, recoverGateFailure, captureNel };
}

/** Publication credentials come from the database implementer, which must agree with the current review round. */
function implementerIdentityFailure(slug: string, contract: { implementer?: string | null; review?: { rounds: readonly { implementer: string }[] } | null }): string | null {
  const implementer = contract.implementer;
  if (!implementer) { return `Mission ${slug} has no database-assigned implementer; review preparation cannot choose publication credentials.`; }
  const recordedImplementer = contract.review?.rounds.at(-1)?.implementer;
  if (recordedImplementer && recordedImplementer !== implementer) {
    return `Mission ${slug} implementer identity mismatch: database assignee ${implementer}, review implementer ${recordedImplementer}. Record the actual execute/repair launch before review preparation; reviewer identity cannot authorize publication.`;
  }
  return null;
}

type ReviewPreparationBindings = ReturnType<typeof reviewPreparationBindings>;
interface ReviewPreparationStart {
  contract: import("./review-preparation-contract.js").RecordedContract;
  verification: Extract<ReturnType<ReviewPreparationExecutor["verifyReviewPreparation"]>, { ok: true }>;
  evidence: import("./review-preparation-contract.js").VerifiedCheckpointDocument;
  forgejoUser: string; forgejoEnabled: boolean;
  isForgejoReviewEnabledFn: ReviewPreparationWorkflowPorts['productConfig']['isForgejoReviewEnabled'];
  missionServicesFn: NonNullable<ReviewPreparationBindings['missionServicesFn']>;
}

async function runPreReviewPreparationGates(slug: string, rootDir: string, bindings: ReviewPreparationBindings, ports: ReviewPreparationWorkflowPorts): Promise<ReviewPreparationResult | null> {
  const { skipGate, log, error } = bindings;
  if (!skipGate) {
    const preHandoffResult = await ports.repositoryGates.runPhaseGates('handoff', {
      slug,
      checkoutPath: rootDir,
      log: (/** @type {string} */ msg: string) => log(msg),
      error: (/** @type {string} */ msg: string) => error(msg),
    });
    if (!preHandoffResult.ok && !preHandoffResult.skipped) {
      const msg = `Pre-review preparation gate "${preHandoffResult.failedGate?.key}" failed for ${fmt.slug(slug)}: ${preHandoffResult.error}`;
      error(msg);
      return { ok: false, error: msg, reason: 'gate-failed' };
    }
  }

  return null;
}

function reviewPreparationTaskFailure(slug: string, taskResolution: ReturnType<ReviewPreparationWorkflowPorts['backlog']['resolveTaskFile']>, log: ReviewPreparationBindings['log'], error: ReviewPreparationBindings['error']): ReviewPreparationResult | null {
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

function reviewPreparationSelectionBindings(ports: ReviewPreparationWorkflowPorts, opts: PerformReviewPreparationOptions) {
  const { eligibleAgentsForStepFn = ports.agentSelection.eligibleAgentsForStep, selectAgentFn = ports.agentSelection.selectAgent } = opts;
  return { eligibleAgentsForStepFn, selectAgentFn };
}
function reviewPreparationRetryBudget(bindings: ReviewPreparationBindings) {
  return { currentAttempt: bindings.maxAttempts || 1, retriesLeft: bindings.remainingRetries !== undefined ? bindings.remainingRetries : 2 };
}

/** Refuse invalid retry budgets or explicit reviewers before review preparation effects. */
function validateReviewPreparationRequest(slug: string, options: PerformReviewPreparationOptions, bindings: ReviewPreparationBindings, ports: ReviewPreparationWorkflowPorts): { ok: false; error: string } | null {
  if (reviewPreparationBudgetExceeded(reviewPreparationRetryBudget(bindings).currentAttempt)) {
    return { ok: false, error: "Review preparation exceeded maximum attempts (3). Manual intervention required." };
  }
  const reviewer = options.reviewer;
  if (!reviewer) { return null; }
  try {
    const launchRoot = process.cwd();
    const worktree = bindings.worktree || ports.missionUtils.resolveWorktree(slug, { cwd: launchRoot }) || launchRoot;
    if (bindings.eligibleAgentsForStepFn('review', { worktree }).includes(reviewer)) { return null; }
    return { ok: false, error: `Reviewer ${reviewer} is not eligible for review. Choose a family configured for the review step.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Cannot validate reviewer ${reviewer}: ${detail}. Check the review agent configuration and retry.` };
  }
}
