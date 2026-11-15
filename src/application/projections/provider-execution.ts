import type { AgentFamily } from '../../domain/agents.js';
import { missionId as parseMissionId, type MissionId } from '../../domain/mission.js';
import { legacyMissionTokens } from '../mission-terminal-compat.js';
import { parseAgentRunId } from '../../domain/agent-run.js';
import { sessionRole } from '../../domain/session.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { MissionCard, ReviewProgress } from './mission-board.js';
import type { MissionTerminalScope, MissionHistoryStorePort } from '../ports/mission-terminal.js';
import { getRun, observeRunExecution, type RunSummary } from '../run-history.js';
import { MAX_RUNS_PER_MISSION, runCaptureKind, type RunRecord } from '../run-history-types.js';

const REVIEW_SESSION_ROLE = sessionRole('review');

/** One current metadata/probe reading, never a cached positive or workflow state. */
export interface ProviderExecutionFacts {
  readonly observedAt: string;
  readonly invocations: readonly {
    readonly runId: string;
    readonly operationId: string | null;
    readonly family: AgentFamily;
    /** Missing on legacy or injected observations, which cannot occupy a reviewer slot. */
    readonly role?: RunRecord['role'];
  }[];
  /** Scoped diagnostics for the invocations or probes that failed; they never change another mission's counts. */
  readonly limitations: readonly string[];
  readonly recordedOperationIds?: readonly string[];
}
export interface ProviderExecutionReader {
  observe(_scope: MissionTerminalScope, _currentOperationId?: string): ProviderExecutionFacts;
}
/** A reader failure keeps its diagnostic on the mission it failed for and reports no confirmed provider. */
export const failedExecution = (reason = 'Provider execution observation failed'): ProviderExecutionFacts => ({ observedAt: new Date().toISOString(), invocations: [], limitations: [reason] });

const isMissionId = (value: string): boolean => { try { parseMissionId(value); return true; } catch { return false; } };

/** Records that the observed evidence could not settle one family's count, or any family's when `null`; `note` is the diagnostic when the board path does not already report one. */
type Uncertain = (_family: AgentFamily | null, _note?: string) => void;
const noUncertainty: Uncertain = () => undefined;

/** Read only owned metadata, with existing invocation identity and process-start probes. */
export function observeProviderExecution(store: MissionHistoryStorePort, identity: MissionTerminalScope, currentOperationId?: string): ProviderExecutionFacts {
  return observeMissionExecution(store, identity, noUncertainty, currentOperationId);
}

function observeMissionExecution(store: MissionHistoryStorePort, identity: MissionTerminalScope, uncertain: Uncertain, currentOperationId?: string): ProviderExecutionFacts {
  const invocations: ProviderExecutionFacts['invocations'][number][] = [];
  const limitations: string[] = [];
  const recordedOperationIds = new Set<string>();
  const supervisors = new Map<number, boolean>();
  const isAlive = (pid: number) => {
    if (!supervisors.has(pid)) { supervisors.set(pid, store.isAlive(pid)); }
    return supervisors.get(pid)!;
  };
  let probeLimited = false;
  const executionAlive = boundedExecutionProbe(store, () => { probeLimited = true; });
  try {
    const runs = readProviders(store, identity, limitations, isAlive, uncertain);
    // Stable sort retains recency within each priority: current owner, live supervisor, history.
    const priority = (run: RunSummary) => run.record.operationId === currentOperationId && currentOperationId !== undefined
      ? 2 : Number(isAlive(run.record.supervisorPid));
    runs.sort((left, right) => priority(right) - priority(left));
    for (const run of runs) {
      probeLimited = false;
      let inconclusive = false;
      const execution = observeRunExecution(run.record, run.state, { executionAlive, onInconclusive: () => { inconclusive = true; } });
      const current = potentiallyCurrent(run, currentOperationId, isAlive);
      collectInvocation({ ...run, execution }, invocations, recordedOperationIds, limitations, { inconclusive, current }, uncertain);
      if (probeLimited) {
        // A run past the probe budget may still be an orphan provider. The board reports it only while current; a sampler cannot read zero past it.
        const note = `${run.record.runId}: provider execution probe budget reached`;
        if (current) { limitations.push(note); }
        uncertain(run.record.family, note);
      }
    }
  } catch { limitations.push('Provider execution probe failed'); uncertain(null); }
  return { observedAt: new Date().toISOString(), invocations, limitations, recordedOperationIds: [...recordedOperationIds] };
}

function readProviders(store: MissionHistoryStorePort, identity: MissionTerminalScope, limitations: string[], isAlive: (_pid: number) => boolean, uncertain: Uncertain): RunSummary[] {
  const seen = new Set<string>();
  const runs: RunSummary[] = [];
  for (const { runId, location } of providerRecords(store, identity, limitations, uncertain)) {
    if (seen.has(runId)) { continue; }
    let coordinator = false;
    const result = getRun({ runsDir: location.runsDir, fs: store.fs, isAlive, acceptRecord: record => {
      if (store.attribute(identity, record, location).kind !== 'attributed') { return false; }
      coordinator = runCaptureKind(record) === 'coordinator';
      return !coordinator;
    } }, runId);
    if (coordinator) { seen.add(runId); continue; }
    if (!result.ok || !result.run) {
      limitations.push(`${runId}: unreadable run metadata`);
      // The run id still names the provider family that may be running.
      uncertain(parseAgentRunId(runId)?.family ?? null);
      continue;
    }
    seen.add(runId);
    runs.push(result.run);
  }
  return runs;
}

/** Coordinator history is not execution evidence. Merge locations before recency ordering. */
function providerRecords(store: MissionHistoryStorePort, identity: MissionTerminalScope, limitations: string[], uncertain: Uncertain) {
  const candidates = store.locations(identity).flatMap(location => {
    const names = store.fs.inspectDirs?.(location.runsDir) ?? { ok: true as const, names: store.fs.listDirs(location.runsDir) };
    if (!names.ok) { limitations.push('Run metadata directory unavailable'); uncertain(null); return []; }
    return names.names.flatMap(runId => {
      const parsed = parseAgentRunId(runId);
      return parsed && parsed.family !== 'parallix'
        ? [{ runId, location, startedAtMs: Number.parseInt(runId.slice(runId.lastIndexOf('-') + 1), 36) }] : [];
    });
  });
  return candidates.sort((left, right) => right.startedAtMs - left.startedAtMs);
}

/** Bound provider process probes, not the number of retained historical captures. */
function boundedExecutionProbe(store: MissionHistoryStorePort, onLimit: () => void) {
  let remaining = MAX_RUNS_PER_MISSION;
  return (execution: Parameters<NonNullable<MissionHistoryStorePort['executionAlive']>>[0]): boolean | null => {
    if (remaining === 0) {
      onLimit();
      return null;
    }
    remaining--;
    // A throwing probe is that invocation's unavailable probe, not a failure of its siblings.
    try { return store.executionAlive?.(execution) ?? null; } catch { return null; }
  };
}

function collectInvocation(run: RunSummary, invocations: ProviderExecutionFacts['invocations'][number][], operations: Set<string>, limitations: string[], probe: { readonly inconclusive: boolean; readonly current: boolean }, uncertain: Uncertain) {
  const { record, execution } = run;
  if (runCaptureKind(record) !== 'agent') { return; }
  if (record.operationId) { operations.add(record.operationId); }
  if (execution === 'live' && record.family) {
    invocations.push({ runId: record.runId, operationId: record.operationId ?? null, family: record.family, role: record.role });
  } else if (execution === 'live') {
    limitations.push(`${record.runId}: live provider has no recorded agent family`);
    uncertain(null);
  } else if (probe.inconclusive) {
    // An orphan whose supervisor is gone may still run, so a sampler cannot read zero; the board reports it only while the run is current.
    const note = `${record.runId}: provider process probe unavailable`;
    if (probe.current) { limitations.push(note); }
    uncertain(record.family, note);
  }
}

function potentiallyCurrent(run: RunSummary, currentOperationId: string | undefined, isAlive: (_pid: number) => boolean): boolean {
  return (currentOperationId !== undefined && run.record.operationId === currentOperationId)
    || isAlive(run.record.supervisorPid);
}

export function readProviderExecution(reader: ProviderExecutionReader, scope: MissionTerminalScope, currentOperationId?: string): ProviderExecutionFacts {
  try { return reader.observe(scope, currentOperationId); } catch { return failedExecution(); }
}

/** Overlay confirmed live native invocations onto the durable reviewer slots. */
function projectLiveReviewerRuns(progress: ReviewProgress | null, execution: ProviderExecutionFacts): ReviewProgress | null {
  if (!progress) { return null; }
  const claimed = new Set<string>();
  const reviewers = progress.reviewers.map(reviewer => {
    if (reviewer.runId !== null || reviewer.state === 'completed' || reviewer.state === 'failed') { return reviewer; }
    const live = execution.invocations.find(invocation => invocation.role === REVIEW_SESSION_ROLE
      && invocation.family === reviewer.reviewer && !claimed.has(invocation.runId));
    if (!live) { return reviewer; }
    claimed.add(live.runId);
    return { ...reviewer, runId: live.runId, runLabel: live.runId, state: 'running' as const };
  });
  const outstanding = reviewers.filter(reviewer => reviewer.state !== 'completed').length;
  return { ...progress, reviewers, nextAction: reviewers.some(reviewer => reviewer.state === 'running')
    ? `Wait for ${outstanding} reviewer outcome${outstanding === 1 ? '' : 's'}.` : progress.nextAction };
}

/** Apply one provider observation to a card, including its live reviewer overlay. */
export function projectProviderExecutionCard(card: MissionCard, execution: ProviderExecutionFacts): MissionCard {
  return { ...card, execution, reviewProgress: projectLiveReviewerRuns(card.reviewProgress ?? null, execution) };
}

/** Apply one repository observation to both surfaces, independent of workflow activity. */
export function projectProviderExecution(board: import('./board.js').BoardProjection, reader: ProviderExecutionReader, operations: readonly WorkflowOperation[] = []): import('./board.js').BoardProjection {
  const owners = new Map(operations.filter(operation => operation.repositoryId === board.repositoryId).map(operation => [operation.missionId, operation.id]));
  const stages = board.stages.map(stage => ({ ...stage, cards: stage.cards.map(card => {
    const execution = readProviderExecution(reader, { repositoryId: board.repositoryId, missionId: card.id }, owners.get(card.id));
    return projectProviderExecutionCard(card, execution);
  }) }));
  return projectExecutionMetrics({ ...board, stages });
}

export function projectExecutionMetrics(board: import('./board.js').BoardProjection): import('./board.js').BoardProjection {
  const invocations = board.stages.flatMap(stage => stage.cards.flatMap(card => card.execution?.invocations ?? []));
  const families = new Map(board.metrics.agentAvailability.map(agent => [agent.family, agent]));
  for (const run of invocations) { if (!families.has(run.family)) { families.set(run.family, { family: run.family, available: false, blockedForMs: 0, reason: 'Family not configured for new launches' }); } }
  return { ...board, metrics: { ...board.metrics,
    agentAvailability: [...families.values()].map(agent => ({ ...agent,
      runningSessions: invocations.filter(run => run.family === agent.family).length })),
  } };
}

/** One slim, repository-scoped read of confirmed live provider invocations for same-host samplers. */
export interface ProviderExecutionSnapshot {
  readonly kind: 'provider-execution-snapshot';
  readonly version: 1;
  readonly observedAt: string;
  readonly invocations: readonly {
    /** Null when the retained record names only a pre-lossless storage token, which is not a Mission id. */
    readonly missionId: string | null;
    readonly runId: string;
    readonly family: AgentFamily;
    readonly role: string | null;
    readonly operationId: string | null;
  }[];
  /** `running` is null when the evidence that could change this family's count is missing; zero is only a clean observation. */
  readonly families: readonly { readonly family: AgentFamily; readonly running: number | null }[];
  readonly health: 'complete' | 'limited' | 'unavailable';
  readonly limitations: readonly { readonly missionId: string | null; readonly message: string }[];
}

/**
 * Observe every Mission that retains run history through the per-Mission
 * observer, so attribution, exclusions and the probe budget stay identical
 * to the board. A failure narrows the counts it could affect to unknown and
 * never hides a confirmed sibling invocation.
 */
export function observeRepositoryProviderExecution(store: MissionHistoryStorePort, repositoryId: MissionTerminalScope['repositoryId'], knownFamilies: readonly AgentFamily[]): ProviderExecutionSnapshot {
  const limitations: { missionId: string | null; message: string }[] = [];
  const invocations: ProviderExecutionSnapshot['invocations'][number][] = [];
  const unknown = new Set<AgentFamily>();
  let unknownAny = false;
  const listed = store.missionIds?.() ?? { ok: false as const };
  if (!listed.ok) {
    limitations.push({ missionId: null, message: 'Run metadata root unavailable' });
    return snapshotOf(invocations, knownFamilies, limitations, new Set(), true, 'unavailable');
  }
  // A canonical Mission already reads its legacy-token directory, so that directory is not a second Mission.
  const covered = new Set(listed.names.flatMap(name => legacyMissionTokens(name)));
  for (const name of listed.names.filter(name => !covered.has(name))) {
    // A directory name is the canonical or legacy Mission token; the record's own attribution still decides ownership.
    const identity = { repositoryId, missionId: name as MissionId };
    const owners = new Map<string, string>();
    // A legacy-token directory may hold records that name their canonical Mission; the observer attributes those exactly as it does for that Mission.
    const scoped: MissionHistoryStorePort = { ...store, attribute: (scope, record, location) => {
      let attribution = store.attribute(scope, record, location);
      const recorded = String(record.missionId ?? '');
      if (attribution.kind !== 'attributed' && legacyMissionTokens(recorded).includes(scope.missionId)) {
        attribution = store.attribute({ ...scope, missionId: recorded as MissionId }, record, location);
        if (attribution.kind === 'attributed') { owners.set(String((record as { runId?: unknown }).runId ?? ''), recorded); }
      }
      return attribution;
    } };
    const notes: string[] = [];
    const uncertain: Uncertain = (family, note) => {
      if (family === null) { unknownAny = true; } else { unknown.add(family); }
      if (note !== undefined) { notes.push(note); }
    };
    let facts: ProviderExecutionFacts;
    try { facts = observeMissionExecution(scoped, identity, uncertain); }
    catch { facts = failedExecution(); uncertain(null); }
    const messages = [...facts.limitations, ...new Set(notes.filter(note => !facts.limitations.includes(note)))];
    // A run recovered from a legacy-token directory belongs to the canonical Mission its record names, for its diagnostics as for its count.
    // A storage token that is no Mission id names nobody: an unattributable diagnostic stays unscoped (null).
    const ownerOf = (message: string) => owners.get(message.slice(0, Math.max(message.indexOf(':'), 0))) || (isMissionId(name) ? name : null);
    limitations.push(...messages.map(message => ({ missionId: ownerOf(message), message })));
    for (const run of facts.invocations) {
      const owner = owners.get(run.runId) || name;
      if (!isMissionId(owner)) {
        limitations.push({ missionId: null, message: `${run.runId}: Mission identity unavailable for a legacy storage token` });
      }
      invocations.push({ missionId: isMissionId(owner) ? owner : null, runId: run.runId, family: run.family, role: run.role ?? null, operationId: run.operationId });
    }
  }
  return snapshotOf(invocations, knownFamilies, limitations, unknown, unknownAny, limitations.length > 0 ? 'limited' : 'complete');
}

function snapshotOf(invocations: ProviderExecutionSnapshot['invocations'][number][], knownFamilies: readonly AgentFamily[], limitations: ProviderExecutionSnapshot['limitations'][number][],
  unknown: ReadonlySet<AgentFamily>, unknownAny: boolean, health: ProviderExecutionSnapshot['health']): ProviderExecutionSnapshot {
  const families = [...new Set([...knownFamilies, ...invocations.map(run => run.family), ...unknown])]
    .sort((left, right) => left.localeCompare(right));
  return { kind: 'provider-execution-snapshot', version: 1, observedAt: new Date().toISOString(), invocations, health, limitations,
    families: families.map(family => ({ family, running: unknownAny || unknown.has(family) ? null : invocations.filter(run => run.family === family).length })) };
}
