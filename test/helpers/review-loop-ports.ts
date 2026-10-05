import { renderReviewLoopEvent } from '../../src/adapters/review/review-loop-presentation.js';
/**
 * Fake review-loop mechanism ports for application review-loop tests.
 *
 * Every port reports a neutral fact by default (provider disabled, nothing
 * consumed, checks pass); a test overrides only the methods its scenario
 * observes. The recorded effects let a test assert what the application loop
 * decided without any provider, Git, process, or filesystem mechanism.
 */
import { ReviewState } from '../../src/adapters/review/review-state.js';
import type {
  ReviewAgentLaunch, ReviewAgentPort, ReviewArtifactPort, ReviewControllerLock, ReviewerRoutingPort, ReviewHandoffPort,
  ReviewLoopOutput, ReviewLoopPorts, ReviewLoopState, ReviewProviderPort, ReviewStatePort, ReviewTaskMirrorPort, PreReviewPort, HumanFeedbackPort,
} from '../../src/application/ports/review-round.js';
import type { LoopContext } from '../../src/application/review-loop/round.js';

export interface ReviewLoopFakeOverrides {
  readonly slug?: string;
  /** The persisted round the state port starts with. */
  readonly state?: ReviewLoopState | null;
  readonly branch?: string;
  readonly worktree?: string;
  readonly stateport?: Partial<ReviewStatePort>;
  readonly task?: Partial<ReviewTaskMirrorPort>;
  readonly handoff?: ReviewHandoffPort | null;
  /** A provider port (merged over the fake provider) or null for provider=none. */
  readonly provider?: Partial<ReviewProviderPort> | null;
  readonly humanFeedback?: Partial<HumanFeedbackPort>;
  readonly routing?: Partial<ReviewerRoutingPort>;
  readonly agents?: Partial<ReviewAgentPort>;
  readonly artifacts?: Partial<ReviewArtifactPort>;
  readonly preReview?: Partial<PreReviewPort>;
  readonly output?: Partial<ReviewLoopOutput>;
  readonly lock?: ReviewControllerLock;
  readonly missionStore?: ReviewLoopPorts['missionStore'];
  readonly lifecycle?: ReviewLoopPorts['lifecycle'];
}

export interface ReviewLoopFake {
  readonly ports: ReviewLoopPorts;
  readonly logs: string[];
  readonly errors: string[];
  readonly exits: number[];
  readonly launches: ReviewAgentLaunch[];
  /** JSON snapshots of every persisted state, in write order. */
  readonly writes: Record<string, unknown>[];
  /** Backlog mirror effects: `active`, `review`, `approved`, `assign:<agent>`. */
  readonly mirrors: string[];
  readonly stops: string[];
  current(): ReviewLoopState | null;
}

/** The fake provider: an open PR, no review, no disposition. */
export function fakeProvider(overrides: Partial<ReviewProviderPort> = {}): ReviewProviderPort {
  return {
    ensureReachable: async () => true,
    openPullRequest: () => ({ kind: 'pull-request', provider: 'forgejo', id: '7', url: null, sourceBranch: 'mission/fake', targetBranch: 'main' }),
    latestReview: async () => null,
    pollReview: async () => null,
    pollDisposition: async () => null,
    publishRevision: () => ({ ok: true, status: 0, detail: '' }),
    ...overrides,
  };
}

export function fakeReviewLoopPorts(overrides: ReviewLoopFakeOverrides = {}): ReviewLoopFake {
  const slug = overrides.slug ?? 'fake-mission';
  const logs: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const launches: ReviewAgentLaunch[] = [];
  const writes: Record<string, unknown>[] = [];
  const mirrors: string[] = [];
  const stops: string[] = [];
  let current: ReviewLoopState | null = overrides.state ?? null;
  const state: ReviewStatePort = {
    read: async () => current,
    persist: async next => { current = next; writes.push(JSON.parse(JSON.stringify(next))); },
    reset: async () => { current = null; return true; },
    create: identity => new ReviewState(slug, identity),
    resume: persisted => ReviewState.from(slug, persisted as ReviewState),
    repairInvalidPhase: async () => {},
    openRound: async next => { next.phase = 'reviewing'; await state.persist(next); return true; },
    ...overrides.stateport,
  };
  const ports: ReviewLoopPorts = {
    branch: overrides.branch ?? `mission/${slug}`,
    worktree: overrides.worktree ?? '/tmp/fake-worktree',
    polling: { intervalMs: 10_000, timeoutMs: 600_000 },
    state,
    task: {
      task: { ok: true, taskFile: `/tmp/${slug}.md`, matches: [] },
      implementer: () => null,
      status: () => 'review',
      reportUnresolved: () => { errors.push(`unresolved task for ${slug}`); },
      mirror: async lane => { mirrors.push(lane); },
      mirrorApproved: async () => { mirrors.push('approved'); },
      assign: agent => { mirrors.push(`assign:${agent}`); return true; },
      ...overrides.task,
    },
    handoff: overrides.handoff ?? null,
    provider: overrides.provider === undefined || overrides.provider === null ? null : fakeProvider(overrides.provider),
    humanFeedback: { reconcile: async () => null, ...overrides.humanFeedback },
    routing: {
      eligibleFamilies: () => ['codex', 'claude'],
      launcherStatus: () => ({ supported: true, detail: '' }),
      nominate: excluded => {
        const nominee = ports.routing.eligibleFamilies().find(agent => !excluded.has(agent));
        if (!nominee) { throw new Error('no eligible reviewer'); }
        return nominee;
      },
      runtimeMatrix: () => [],
      ...overrides.routing,
    },
    agents: {
      dryRunPrompt: role => `${role} prompt`,
      recordStage: async () => {},
      ...overrides.agents,
      // Every launch is recorded; an override decides only what it reports.
      launch: async launch => {
        launches.push(launch);
        return overrides.agents?.launch ? await overrides.agents.launch(launch) : { agent: launch.agent, result: { status: 0 } };
      },
    },
    artifacts: {
      consumeReviewer: async () => ({ consumed: false }),
      consumeImplementer: async () => ({ consumed: false }),
      ...overrides.artifacts,
    },
    preReview: {
      refreshKnowledgeGraph: async () => {},
      rebase: async () => ({ ok: true }),
      runGate: async () => ({ ok: true }),
      reviewBaseline: () => 'baseline',
      head: () => 'head-1',
      ...overrides.preReview,
    },
    output: {
      emit: event => renderReviewLoopEvent(event, ports.output),
      log: message => { logs.push(message); },
      error: message => { errors.push(message); },
      exit: code => { exits.push(code); },
      onAutonomousStop: reason => { stops.push(reason); },
      ...overrides.output,
    },
    lock: overrides.lock ?? { tryAcquire: () => true, release: () => {} },
    missionStore: overrides.missionStore ?? null,
    lifecycle: overrides.lifecycle ?? null,
  };
  return { ports, logs, errors, exits, launches, writes, mirrors, stops, current: () => current };
}

/** A loop context over fake ports, for driving one application review-loop step. */
export function fakeLoopContext(fake: ReviewLoopFake, overrides: Partial<LoopContext> = {}): LoopContext {
  const state = fake.current() ?? new ReviewState('fake-mission', { reviewer: 'claude', implementer: 'codex' });
  return {
    ports: fake.ports,
    slug: 'fake-mission',
    focus: 'all',
    maxAttempts: 1,
    reboundsPerRound: 6,
    dryRun: false,
    isContinue: false,
    verbose: false,
    initialRound: state.round,
    state,
    identities: { implementer: state.implementer ?? 'codex', reviewer: state.reviewer ?? 'claude' },
    emit: event => fake.ports.output.emit(event),
    exit: code => fake.ports.output.exit(code),
    escalateToHumanReview: async reason => { fake.stops.push(reason); },
    ...overrides,
  };
}
