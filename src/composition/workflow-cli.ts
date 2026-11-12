import { reviewOperation } from '../domain/review-command-policy.js';
import { isOpenWorkflow, isWorkflowCommand } from '../domain/workflow-operation.js';
import { workflowFailureSummary, type WorkflowFailureFacts } from '../application/presentation/workflow-failure.js';
import { stripTerminalControl } from '../application/run-history.js';
import { parseReviewCliRequest } from '../interfaces/cli/review.js';
import { parseIntegrateCliRequest } from '../interfaces/cli/integrate.js';
import { randomUUID } from 'node:crypto';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { Command } from '../interfaces/cli/runtime.js';
import type { ProductionApplicationServices } from './application-services.js';
import { hasMissionWriteAuthorization } from '../application/ports/mission-write-authorization.js';
import { inferSlug } from '../adapters/filesystem/mission-utils.js';
import type { BoardCommandRequest } from '../application/controller/board-command.js';

/** Closed CLI commands preserve their existing parser and flags inside the owner. */
export function ownWorkflowCli(registry: Record<string, Command>, open: () => Promise<ProductionApplicationServices>, operatorReview = false): void {
  for (const command of ['draft', 'review', 'rebase', 'integrate'] as const) {
    const original = registry[command];
    registry[command] = async (args: string[], options: Record<string, unknown> = {}) => {
      const reviewRequest = command === 'review' ? parseReviewCliRequest(args) : null;
      if (command === 'integrate') { parseIntegrateCliRequest(args, options.configuration as ParallixConfiguration | undefined); }
      if (bypassOwnership(command, args)) {
        return original(args, options);
      }
      const slug = inferSlug(command === 'review' ? reviewRequest?.explicitSlug : args[0]?.startsWith('-') ? undefined : args[0]);
      if (!slug) { return original(args, options); }
      // Review runs under a detached owner. Losing its observer must not fence
      // the reviewer; explicit stop retains shutdown authority.
      const cancellation = { requested: false, stopOwnedWorkflow: command !== 'review' };
      const interrupt = () => { cancellation.requested = true; };
      // Keep this listener through settlement and graph close. Repeated Ctrl+C
      // requests the same cleanup rather than killing its foreground waiter.
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', interrupt);
      let graph: ProductionApplicationServices | undefined;
      let failed = true;
      try {
        graph = await open();
        await dispatchOwnedCli(command, args, slug, graph, cancellation, operatorReview);
        failed = false;
      } finally {
        if (failed && process.stdout.isTTY) { process.stdout.write('\x1b[?25h\x1b[?1049l\r\x1b[2K'); }
        try { await graph?.operatorState.close(); }
        finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
      }
    };
  }
  registry.stop = async (args: string[]) => {
    const slug = inferSlug(args[0]);
    if (!slug) { throw new Error('px stop requires a mission'); }
    const interrupt = () => {};
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    let graph: ProductionApplicationServices | undefined;
    try {
      graph = await open();
      const result = await graph.presentationCapabilities?.commandController.dispatch({ operationId: randomUUID(), missionId: slug, kind: 'workflow:stop', capabilities: new Set(['workflow:stop']) });
      if (result?.status !== 'completed') { throw new Error(`Stop ${slug}: ${result?.error?.message ?? 'Stop failed'}`); }
      console.log(`Stop ${slug}: owned-work shutdown confirmed; mission and history retained.`);
    } finally {
      try { await graph?.operatorState.close(); }
      finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
    }
  };
}

async function dispatchOwnedCli(command: 'draft' | 'review' | 'rebase' | 'integrate', args: string[], slug: string, graph: ProductionApplicationServices,
  cancellation: { requested: boolean; stopOwnedWorkflow: boolean }, operatorReview: boolean): Promise<void> {
  const controller = graph.presentationCapabilities?.commandController;
  if (!controller) { throw new Error('Workflow admission is unavailable'); }
  const kind = workflowKind(command);
  const request: BoardCommandRequest = { operationId: randomUUID(), missionId: slug, kind,
    capabilities: new Set([kind]), cancellation, operatorInvocation: operatorReview && command === 'review', invocation: { command, args, interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) } };
  const result = await controller.dispatch(request);
  if (cancellation.requested) { throw new Error(result.error?.message ?? 'Workflow interrupted'); }
  if (result.status !== 'completed') { throw new Error(result.error?.message ?? result.status); }
}

function bypassOwnership(command: string, args: readonly string[]): boolean {
  return hasMissionWriteAuthorization() || args.includes('--help') || args.includes('--dry-run')
    || command === 'integrate' && args.includes('--recover-landed')
    || command === 'review' && !['enter', 'submit'].includes(reviewOperation(args));
}
function workflowKind(command: string): 'draft:create' | 'integrate:merge' | 'rebase:run' | 'review:submit' {
  if (command === 'draft') { return 'draft:create'; }
  if (command === 'integrate') { return 'integrate:merge'; }
  if (command === 'rebase') { return 'rebase:run'; }
  return 'review:submit';
}


/** CLI observation follows retained coordinator bytes; it never owns execution. */
export const ACTIVE_WORKFLOW_OBSERVATION_MS = 1_000;
export const IDLE_WORKFLOW_OBSERVATION_MS = 5_000;

export interface WorkflowObservationTiming {
  readonly now: () => number;
  readonly activeMs: number;
  readonly idleMs: number;
}

type WorkflowOperation = import('../domain/workflow-operation.js').WorkflowOperation;
type WorkflowTerminal = Pick<import('../application/ports/mission-terminal.js').MissionTerminalCapability, 'history' | 'page'>;
type CoordinatorRun = import('../application/run-history.js').RunSummary;

interface WorkflowObservationState {
  coordinators: CoordinatorRun[];
  discovered: boolean;
  discoveryFailures: number;
  nextDiscoveryAt: number;
  nextReadAt: number;
  lastOperation: string;
  lastFinished: boolean;
}

interface WorkflowProgressState { last: string; sequence: number }

async function publishWorkflowProgress(operation: WorkflowOperation,
  activity: import('../application/ports/execution-activity.js').ExecutionActivityReadPort | undefined,
  progress: import('../application/controller/board-command.js').BoardProgressSink | undefined,
  state: WorkflowProgressState): Promise<void> {
  const snapshot = (await activity?.loadMissionCurrentWork(operation.missionId))?.[0];
  const event = workflowProgress(operation, state.sequence + 1, snapshot?.frames.at(-1)?.event);
  if (event.message === state.last) { return; }
  state.last = event.message;
  state.sequence += 1;
  progress?.(event);
}

function workflowOperationFingerprint(operation: WorkflowOperation): string {
  return `${operation.id}\0${operation.phase}\0${operation.updatedAt ?? ''}\0${operation.reason ?? ''}`;
}

function workflowObservationInterval(operation: WorkflowOperation, coordinators: readonly CoordinatorRun[], timing: WorkflowObservationTiming): number {
  return isOpenWorkflow(operation) || coordinators.some(run => run.state === 'running') ? timing.activeMs : timing.idleMs;
}

function refreshCoordinatorRuns(terminal: WorkflowTerminal, operation: WorkflowOperation, state: WorkflowObservationState,
  offsets: ReadonlyMap<string, number>, reportLoss: (_key: string, _text: string) => void,
  timing: WorkflowObservationTiming, now: number): boolean {
  const history = terminal.history(operation.missionId);
  if (!history.ok) {
    state.discoveryFailures += 1;
    const retry = Math.min(timing.idleMs, timing.activeMs * 2 ** Math.min(state.discoveryFailures - 1, 8));
    state.nextDiscoveryAt = now + retry;
    state.nextReadAt = state.nextDiscoveryAt;
    return false;
  }
  state.discovered = true;
  state.discoveryFailures = 0;
  const next = history.runs.filter(({ record }) => record.operationId === operation.id
    && record.captureKind === 'coordinator' && record.supervisorPid !== process.pid);
  for (const key of offsets.keys()) {
    if (!next.some(({ record }) => key.startsWith(`${record.runId}:`))) { reportLoss(key, 'the operation\'s retained output has expired'); }
  }
  state.coordinators = next;
  state.nextDiscoveryAt = now + workflowObservationInterval(operation, next, timing);
  return true;
}

export function workflowCliObserver(terminal: WorkflowTerminal,
  progress?: import('../application/controller/board-command.js').BoardProgressSink,
  write: (_text: string) => void = text => { process.stdout.write(text); },
  interactive = Boolean(process.stdout.isTTY),
  activity?: import('../application/ports/execution-activity.js').ExecutionActivityReadPort,
  timing: WorkflowObservationTiming = { now: Date.now, activeMs: ACTIVE_WORKFLOW_OBSERVATION_MS, idleMs: IDLE_WORKFLOW_OBSERVATION_MS }) {
  const offsets = new Map<string, number>();
  const replay = workflowReplay(write, interactive);
  const lost = new Set<string>();
  const state: WorkflowObservationState = { coordinators: [], discovered: false, discoveryFailures: 0,
    nextDiscoveryAt: 0, nextReadAt: 0, lastOperation: '', lastFinished: true };
  // Retention may drop or expire retained bytes; replay says so instead of
  // skipping silently (TASK-2816). A fresh observer after a restart starts at 0.
  const reportLoss = (key: string, text: string) => {
    const notice = `\n[${key}: ${text}]\n`;
    if (!lost.has(notice)) { lost.add(notice); write(notice); }
  };
  /** Replay one stream from its last offset; `true` once it has ended. */
  const replayStream = (missionId: string, runId: string, stream: 'stdout' | 'stderr'): boolean => {
    const key = `${runId}:${stream}`;
    const after = offsets.get(key) ?? 0;
    const page = terminal.page(missionId, { runId, stream, presentation: 'terminal', after });
    if (!page.ok) {
      if (offsets.has(key)) { reportLoss(key, `output from byte ${after} is no longer retained (${page.error})`); }
      return true;
    }
    if (page.from > after) { reportLoss(key, `bytes ${after}-${page.from} were not retained`); }
    replay(key, page);
    offsets.set(key, page.to);
    return page.atEnd && !page.running;
  };
  const progressState: WorkflowProgressState = { last: '', sequence: 0 };
  return async (operation: WorkflowOperation): Promise<boolean> => {
    await publishWorkflowProgress(operation, activity, progress, progressState);
    const now = timing.now();
    const operationFingerprint = workflowOperationFingerprint(operation);
    const changed = operationFingerprint !== state.lastOperation;
    let interval = workflowObservationInterval(operation, state.coordinators, timing);
    if (!changed && now < state.nextReadAt) { return state.lastFinished; }
    state.lastOperation = operationFingerprint;
    if (!state.discovered || changed || now >= state.nextDiscoveryAt) {
      if (!refreshCoordinatorRuns(terminal, operation, state, offsets, reportLoss, timing, now)) { return state.lastFinished; }
      interval = workflowObservationInterval(operation, state.coordinators, timing);
    }
    let finished = true;
    // The observing CLI also retains its printed output. Replaying its own
    // capture feeds bytes back into itself and waits on its running record.
    for (const run of [...state.coordinators].reverse()) {
      for (const stream of ['stdout', 'stderr'] as const) {
        finished = replayStream(operation.missionId, run.record.runId, stream) && finished;
      }
    }
    state.lastFinished = finished;
    // A closed operation can still have more than one retained page to drain.
    // Keep paging at the active cadence until every selected stream reaches end.
    state.nextReadAt = now + (finished ? interval : timing.activeMs);
    return state.lastFinished;
  };
}


function workflowProgress(operation: import('../domain/workflow-operation.js').WorkflowOperation, sequence: number, activity?: import('../domain/execution-activity.js').ExecutionActivity) {
  const agent = activity ? activity.agent : null;
  return { operationId: operation.id, sequence, phase: activity?.phase ?? operation.phase,
    message: operation.reason ?? activity?.summary ?? operation.phase,
    timestamp: activity?.occurredAt ?? operation.updatedAt, ...(agent ? { agent } : {}) };
}

function workflowReplay(write: (_text: string) => void, interactive: boolean) {
  const pending = new Map<string, string>();
  return (key: string, page: { text: string; atEnd: boolean; running: boolean }): void => {
    if (interactive) { if (page.text) { write(page.text); } return; }
    const text = (pending.get(key) ?? '') + page.text;
    const cut = page.atEnd && !page.running ? text.length : text.lastIndexOf('\n') + 1;
    // Redirected progress contributes its final frame. Partial lines and
    // escape sequences remain buffered across polls, within a bounded tail.
    const complete = text.slice(0, cut).replace(/\r\n/g, '\n').split('\n')
      .map(line => stripTerminalControl(line.slice(line.lastIndexOf('\r') + 1))).join('\n');
    if (complete) { write(complete); }
    pending.set(key, text.slice(cut).slice(-65536));
  };
}

/** Decorate only CLI outcomes, after the owner's waiter has replayed output. */
export function workflowFailureController(
  controller: import('../application/controller/board-command.js').BoardCommandDispatcher,
  read: (_id: string) => Promise<import('../application/ports/workflow-operation.js').WorkflowOperationRecord | null>,
  evidence: (_operation: import('../application/ports/workflow-operation.js').WorkflowOperationRecord) => Promise<Partial<WorkflowFailureFacts>> = async () => ({}),
  current?: (_mission: string) => Promise<import('../application/ports/workflow-operation.js').WorkflowOperationRecord | null>,
): import('../application/controller/board-command.js').BoardCommandDispatcher {
  return {
    canExecute: kind => controller.canExecute(kind),
    ...(controller.admit ? { admit: (request: BoardCommandRequest) => controller.admit!(request) } : {}),
    ...(controller.operation ? { operation: (id: string) => controller.operation!(id) } : {}),
    ...(controller.current ? { current: (mission: string) => controller.current!(mission) } : {}),
    async dispatch<T>(request: BoardCommandRequest) {
      if (!isWorkflowCommand(request.kind) && request.kind !== 'workflow:stop') { return controller.dispatch<T>(request); }
      const stopping = await stoppingWorkflow(request, current);
      const result = await controller.dispatch<T>(request);
      if (result.status === 'completed' || !result.error) { return result; }
      let operation: Awaited<ReturnType<typeof read>> = null;
      let recorded: Partial<WorkflowFailureFacts> = {};
      try {
        operation = stopping ?? await read(request.operationId);
        if (operation) { recorded = await evidence(operation); }
      } catch { /* Presentation must not replace the original failure. */ }
      const message = workflowFailureSummary({ mission: request.missionId,
        stage: operation ? `${operation.command} / ${operation.phase}` : `${request.kind} / admission`,
        command: operation?.invocation ? `px ${operation.invocation.command} ${operation.invocation.args.join(' ')}` : `px ${request.kind.split(':')[0]} ${request.missionId}`,
        output: [], ...recorded, diagnostics: [result.error.message, ...(recorded.diagnostics ?? [])] });
      return { ...result, error: { ...result.error, message } };
    },
  };
}

async function stoppingWorkflow(request: BoardCommandRequest,
  current?: (_mission: string) => Promise<import('../application/ports/workflow-operation.js').WorkflowOperationRecord | null>) {
  try { return request.kind === 'workflow:stop' ? await current?.(request.missionId) ?? null : null; }
  catch { return null; } // Observation must not prevent stop dispatch.
}
