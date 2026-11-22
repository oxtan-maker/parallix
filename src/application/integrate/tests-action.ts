/**
 * Integration tests as a review-step verification action (TASK-2859.14).
 *
 * The executor runs only when the next-action owner returns `tests`: the fixed
 * sequence returns it for an approved candidate whose exact-current tests are
 * known to be missing (TASK-2859.17). It needs no landing eligibility: it never runs the
 * integration preflight, lifecycle recovery or landing, and never records an
 * approval. It rebases through the integration rebase owner, runs the
 * configured pre-integration gates through the gate-step owner (which writes the
 * gate-run record and routes a red run through the rebound kernel), and returns
 * control to the next-action owner or a typed human hand-off.
 */
import { missionId } from '../../domain/mission.js';
import type { ParallixConfiguration } from '../ports/configuration.js';
import type { IntegrationMissionServices, IntegrationMissionServicesFactory } from '../ports/integration-records.js';
import type { IntegrateWorkflowPorts, IntegrationGateRoute, IntegrationGateRunRecord } from '../ports/integrate-workflow.js';
import type { LiveMissionExecutionContext, MissionExecutionContext } from '../ports/mission-execution-context.js';
import { fixedVerificationNextAction, type FixedVerificationNextAction } from '../verification-policy/fixed-next-action.js';
import type { IntegrationContext, IntegrationContextOptions } from './context.js';
import type { GateStepRequest, IntegrateSeams } from './gates.js';
import { IntegrationStopsForHuman } from './review-before-integration.js';
import { integrationSeams } from '../integrate-entry.js';
import type { IntegrateOptions } from '../integrate-workflow.js';
import { passingIntegrationReceiptApplies } from '../../domain/integration-validation-policy.js';

export interface TestsActionRequest {
  readonly slug: string;
  /** The verification action a policy selected; null, the fixed sequence decides from exact-current evidence. */
  readonly policySelection: 'tests' | null;
  /** Asked after the mandatory rebase with the head to be tested; false when the policy no longer recommends tests there. */
  readonly stillSelected?: (_revision: string) => Promise<boolean>;
  readonly executionContext: MissionExecutionContext;
  readonly missionServicesFn: IntegrationMissionServicesFactory;
  readonly seams: IntegrateSeams;
  readonly configuration?: ParallixConfiguration;
  readonly realAgent?: string | null;
  readonly realAgentModel?: string | null;
}

/** The gate-run writer's identity for the verdict: which run, on which revision, with which per-hook results. */
export type TestsActionEvidence = Pick<IntegrationGateRunRecord, 'gateRunId' | 'revision' | 'outcomes'>;

export type TestsActionHandoffReason =
  | 'concurrent-entry' | 'mission-unavailable' | 'mission-checkout-unavailable' | 'rebase-dead-end'
  | 'gate-evidence-unavailable' | 'gate-evidence-refused' | 'repair-refused' | 'interrupted';

export type TestsActionOutcome =
  | { readonly kind: 'not-selected'; readonly next: FixedVerificationNextAction | null }
  | { readonly kind: 'completed'; readonly verdict: 'passed' | 'cancelled'; readonly evidence: TestsActionEvidence;
    /** True when a complete passing run already covered this exact head, so nothing ran or was written again. */
    readonly recorded: boolean; readonly repairRoute: null; readonly next: FixedVerificationNextAction | null }
  | { readonly kind: 'completed'; readonly verdict: 'failed';
    /** The red run's record; null (unknown) when it could not be read before repair replaced it. */
    readonly evidence: TestsActionEvidence | null;
    readonly recorded: false; readonly repairRoute: IntegrationGateRoute; readonly next: FixedVerificationNextAction | null }
  | { readonly kind: 'completed'; readonly verdict: 'failed'; readonly evidence: TestsActionEvidence | null;
    readonly recorded: false; readonly repairRoute: null; readonly retryWithoutRepair: true;
    readonly next: FixedVerificationNextAction | null }
  | { readonly kind: 'human-handoff'; readonly reason: TestsActionHandoffReason; readonly detail: string };

/** How the gate-step owner settled the action; the record only supplies identity. */
type GateStepDecision =
  | { readonly kind: 'passed' }
  | { readonly kind: 'retry-selected'; readonly redRun: IntegrationGateRunRecord | null }
  | { readonly kind: 'routed'; readonly route: IntegrationGateRoute; readonly redRun: IntegrationGateRunRecord | null }
  | { readonly kind: 'repair-refused'; readonly detail: string }
  | { readonly kind: 'stopped'; readonly detail: string };

type TestsEvidenceFacts = { readonly testsConfigured?: boolean | null; readonly testsCurrent?: boolean | null };

export interface TestsActionDependencies {
  buildIntegrationContext(_slug: string, _options: IntegrationContextOptions): Promise<IntegrationContext>;
  runIntegrationRebase(_slug: string, _target: { baseWorktree: string; baseBranch: string; git: IntegrateWorkflowPorts['git']['git'];
    executionContext: LiveMissionExecutionContext; missionServicesFn?: IntegrationMissionServicesFactory }): Promise<void>;
  runRequiredLocalGates(_request: GateStepRequest): Promise<string>;
}

function handoff(reason: TestsActionHandoffReason, detail: string): TestsActionOutcome {
  return { kind: 'human-handoff', reason, detail };
}

function evidenceOf(run: IntegrationGateRunRecord): TestsActionEvidence {
  return { gateRunId: run.gateRunId, revision: run.revision, outcomes: run.outcomes };
}

/** A run this action settled: identified, on the tested head, and not the record that existed before it. */
function freshRun(run: IntegrationGateRunRecord | null, head: string | null, previous: IntegrationGateRunRecord | null,
  status: IntegrationGateRunRecord['status']): run is IntegrationGateRunRecord {
  return run !== null && run.status === status && run.gateRunId !== null && head !== null && run.revision === head
    && run.gateRunId !== previous?.gateRunId;
}

/**
 * Only a complete, current passing run of the configured plan on this exact
 * head can stand in for a rerun. It must carry the gate owner's receipt over
 * persisted fields (one green outcome per configured gate and nothing else; the
 * single writer settles executed and outcomes together, so this is the receipt
 * completeIntegrationGateRunReceipt accepts) and the adapter's input-identity
 * currency, the rule the existing consumers of the same record apply. Failed,
 * cancelled, partial, other-plan, unidentified or non-current records rerun.
 */
export function completeCurrentTestsPass(run: IntegrationGateRunRecord | null, head: string | null,
  configured: readonly { key: string; command: string }[]): run is IntegrationGateRunRecord {
  return passingIntegrationReceiptApplies(run, head, configured, 'exact');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function needsLandingEvidence(request: TestsActionRequest, missionStatus: string): boolean {
  return request.policySelection === null && missionStatus === 'integration';
}

function needsResolvedContext(selected: FixedVerificationNextAction, needsEvidence: boolean): boolean {
  return selected.kind === 'tests' || needsEvidence;
}

function stoppedByGateStep(ports: IntegrateWorkflowPorts, error: unknown): boolean {
  return error instanceof IntegrationStopsForHuman || ports.landing.isAbort(error);
}

/** Map the gate step's own decision to a completion edge; the record never upgrades it. */
async function settle(slug: string, decision: GateStepDecision, run: IntegrationGateRunRecord | null, tested: string | null,
  previous: IntegrationGateRunRecord | null,
  next: (_selection?: 'tests') => Promise<FixedVerificationNextAction | null>): Promise<TestsActionOutcome> {
  if (decision.kind === 'repair-refused') { return handoff('repair-refused', decision.detail); }
  if (decision.kind === 'retry-selected') {
    const evidence = freshRun(decision.redRun, tested, previous, 'failed') ? evidenceOf(decision.redRun) : null;
    return { kind: 'completed', verdict: 'failed', evidence, recorded: false, repairRoute: null,
      retryWithoutRepair: true, next: await next('tests') };
  }
  if (decision.kind === 'routed') {
    const evidence = freshRun(decision.redRun, tested, previous, 'failed') ? evidenceOf(decision.redRun) : null;
    return { kind: 'completed', verdict: 'failed', evidence, recorded: false, repairRoute: decision.route,
      next: await next() };
  }
  const status = decision.kind === 'passed' ? 'passed' : 'cancelled';
  if (!freshRun(run, tested, previous, status)) {
    return decision.kind === 'passed'
      ? handoff('gate-evidence-unavailable', `The gate step passed ${slug}, but no identified gate run was recorded for the tested head.`)
      : handoff('gate-evidence-refused', `The gate step stopped ${slug} without a passing verdict: ${decision.detail}`);
  }
  return { kind: 'completed', verdict: status, evidence: evidenceOf(run), recorded: false, repairRoute: null,
    next: await next() };
}

/** A rebase that changed the change identity resets what the policy knows, so its choice is asked again on the head that would be tested. */
async function choiceChanged(request: TestsActionRequest, tested: string | null): Promise<boolean> {
  return tested !== null && request.stillSelected !== undefined && !await request.stillSelected(tested);
}

/** The refused second actor is told which process owns the integration claim. */
function claimRefused(ports: IntegrateWorkflowPorts, slug: string): TestsActionOutcome {
  return handoff('concurrent-entry', `Integration of ${slug} is already running in ${ports.process.integrationClaimHolder?.(slug) ?? 'another process'}.`);
}

function readGateRun(ports: IntegrateWorkflowPorts, checkout: string): IntegrationGateRunRecord | null {
  try { return ports.gates.readGateRun?.(checkout) ?? null; } catch { return null; }
}

async function nextAction(services: IntegrationMissionServices, slug: string, policySelection?: 'tests') {
  const loaded = await services.store.load(missionId(slug));
  return loaded.kind === 'found' ? fixedVerificationNextAction({ mission: loaded.mission,
    policySelection: policySelection ?? null }) : null;
}

/** Exact-current evidence the fixed sequence needs in the landing lane; unreadable head stays unknown. */
function evidenceFacts(ports: IntegrateWorkflowPorts, slug: string, context: IntegrationContext): TestsEvidenceFacts {
  const checkout = ports.gates.resolveIntegrationVerificationWorktree(slug, { baseWorktree: context.baseWorktree });
  const tree = ports.gates.captureFinalIntegrationTree(checkout);
  const configured = ports.gates.loadPhaseGates(checkout, 'preIntegration');
  return { testsConfigured: configured.length > 0,
    testsCurrent: tree.ok && tree.commit ? completeCurrentTestsPass(readGateRun(ports, checkout), tree.commit, configured) : null };
}

export function createTestsActionExecutor(ports: IntegrateWorkflowPorts, dependencies: TestsActionDependencies) {
  async function rebase(slug: string, context: IntegrationContext, request: TestsActionRequest,
    executionContext: LiveMissionExecutionContext): Promise<TestsActionOutcome | null> {
    try {
      await dependencies.runIntegrationRebase(slug, { baseWorktree: context.baseWorktree, baseBranch: context.baseBranch,
        git: ports.git.git, executionContext, missionServicesFn: request.missionServicesFn });
      return null;
    } catch (error) {
      // Rebase conflicts and dead ends are outside the verification model: the
      // rebase workflow already printed its recovery path, and no gate runs.
      if (stoppedByGateStep(ports, error)) { return handoff('rebase-dead-end', messageOf(error)); }
      throw error;
    }
  }

  async function runGates(request: TestsActionRequest, context: IntegrationContext, services: IntegrationMissionServices,
    checkout: string): Promise<GateStepDecision> {
    let route: IntegrationGateRoute | null = null;
    let redRun: IntegrationGateRunRecord | null = null;
    let routed = false;
    let retrySelected = false;
    const seams: IntegrateSeams = { ...request.seams, routeIntegrationGateFailureFn: async failure => {
      // The gate step routes only a red run: that decision is the verdict. The
      // record read here supplies its identity before a repair rerun replaces it.
      routed = true;
      redRun = readGateRun(ports, checkout);
      route = await request.seams.routeIntegrationGateFailureFn(failure);
      return route;
    } };
    const missionLoad = await services.store.load(missionId(request.slug));
    try {
      await dependencies.runRequiredLocalGates({ slug: request.slug, context, missionLoad, missionServices: services,
        dryRun: true, noIntegrationGates: false, realAgent: request.realAgent ?? null,
        realAgentModel: request.realAgentModel ?? null, seams, configuration: request.configuration,
        ...(request.stillSelected ? { retryFailedTestsWithoutRepair: async revision => {
          redRun = readGateRun(ports, checkout);
          retrySelected = await request.stillSelected!(revision);
          return retrySelected;
        } } : {}) });
    } catch (error) {
      // A routed red run whose repair the rebound kernel or the lifecycle refused
      // (for example an effective approval that must first be revoked) is
      // reported, never treated as a completed repair.
      if (routed && !route) { return { kind: 'repair-refused', detail: messageOf(error) }; }
      if (!stoppedByGateStep(ports, error)) { throw error; }
      if (!route) { return { kind: 'stopped', detail: messageOf(error) }; }
    }
    return retrySelected ? { kind: 'retry-selected', redRun }
      : route ? { kind: 'routed', route, redRun } : { kind: 'passed' };
  }

  /** Resolve the live checkout and integration facts; nothing is rebased or run yet. */
  async function resolveContext(request: TestsActionRequest, services: IntegrationMissionServices)
    : Promise<{ context: IntegrationContext; executionContext: LiveMissionExecutionContext } | { handoff: TestsActionOutcome }> {
    const { slug } = request;
    if (request.executionContext.missionId !== slug) {
      return { handoff: handoff('mission-unavailable', `Execution context for ${request.executionContext.missionId} cannot run tests for ${slug}.`) };
    }
    const missionWorktree = request.executionContext.missionWorktree;
    if (!missionWorktree) { return { handoff: handoff('mission-checkout-unavailable', `Mission ${slug} has no checkout to test.`) }; }
    const executionContext = { ...request.executionContext, missionWorktree };
    const context = await dependencies.buildIntegrationContext(slug, { missionStore: services.store, executionContext,
      getCurrentBranchFn: () => ports.git.getCurrentBranch(missionWorktree) });
    return { context, executionContext };
  }

  async function execute(request: TestsActionRequest): Promise<TestsActionOutcome> {
    const { slug } = request;
    const services = await request.missionServicesFn(ports.process.cwd());
    const loaded = await services.store.load(missionId(slug));
    if (loaded.kind !== 'found') { return { kind: 'not-selected', next: null }; }
    let selected = fixedVerificationNextAction({ mission: loaded.mission, policySelection: request.policySelection });
    // Only the landing lane needs positive evidence before the fixed sequence may schedule tests.
    const needsEvidence = needsLandingEvidence(request, loaded.mission.status);
    const resolved = needsResolvedContext(selected, needsEvidence) ? await resolveContext(request, services) : null;
    if (resolved && 'handoff' in resolved) { return resolved.handoff; }
    if (needsEvidence && resolved) {
      selected = fixedVerificationNextAction({ mission: loaded.mission, ...evidenceFacts(ports, slug, resolved.context) });
    }
    if (selected.kind !== 'tests' || !resolved) { return { kind: 'not-selected', next: selected }; }
    const rebased = await rebase(slug, resolved.context, request, resolved.executionContext);
    if (rebased) { return rebased; }
    const { context } = resolved;
    const checkout = ports.gates.resolveIntegrationVerificationWorktree(slug, { baseWorktree: context.baseWorktree });
    const head = ports.gates.captureFinalIntegrationTree(checkout);
    const tested = head.ok ? head.commit ?? null : null;
    context.missionHeadSha = tested;
    if (await choiceChanged(request, tested)) { return { kind: 'not-selected', next: selected }; }
    const previous = readGateRun(ports, checkout);
    if (completeCurrentTestsPass(previous, tested, ports.gates.loadPhaseGates(checkout, 'preIntegration'))) {
      return { kind: 'completed', verdict: 'passed', evidence: evidenceOf(previous), recorded: true, repairRoute: null,
        next: await nextAction(services, slug) };
    }
    const decision = await runGates(request, context, services, checkout);
    return await settle(slug, decision, readGateRun(ports, checkout), tested, previous,
      selection => nextAction(services, slug, selection));
  }

  /** Run one policy-selected tests action under the mission's exclusive integration claim. */
  async function runTestsAction(request: TestsActionRequest): Promise<TestsActionOutcome> {
    const release = await ports.process.claimIntegration(request.slug);
    if (!release) { return claimRefused(ports, request.slug); }
    try { return await execute(request); }
    catch (error) { return handoff('interrupted', messageOf(error)); }
    finally { await release(); }
  }

  return { runTestsAction };
}

export type PolicyTestsActionOptions = IntegrateOptions & {
  readonly stillSelected?: TestsActionRequest['stillSelected'];
  readonly executionContext: MissionExecutionContext;
  readonly missionServicesFn: IntegrationMissionServicesFactory;
};

/** The review loop's policy-selected tests action: the integrate claim, rebase and gate owners, never landing. */
export async function runPolicyTestsAction(ports: IntegrateWorkflowPorts, dependencies: TestsActionDependencies,
  slug: string, options: PolicyTestsActionOptions): Promise<TestsActionOutcome> {
  return await createTestsActionExecutor(ports, dependencies).runTestsAction({ slug, policySelection: 'tests',
    executionContext: options.executionContext, missionServicesFn: options.missionServicesFn,
    seams: integrationSeams(options, ports), configuration: options.configuration, stillSelected: options.stillSelected });
}
