import { isWorkflowCommand } from '../domain/workflow-operation.js';
import { workflowFailureSummary, type WorkflowFailureFacts } from '../application/presentation/workflow-failure.js';
import { stripTerminalControl } from '../application/run-history.js';
import { parseIntegrateCliRequest } from '../interfaces/cli/integrate.js';
import { randomUUID } from 'node:crypto';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { Command } from '../interfaces/cli/runtime.js';
import type { ProductionApplicationServices } from './application-services.js';
import { hasMissionWriteAuthorization } from '../application/ports/mission-write-authorization.js';
import { inferSlug } from '../adapters/filesystem/mission-utils.js';
import type { BoardCommandRequest } from '../application/controller/board-command.js';

/** Closed CLI commands preserve their existing parser and flags inside the owner. */
export function ownWorkflowCli(registry: Record<string, Command>, open: () => Promise<ProductionApplicationServices>): void {
  for (const command of ['draft', 'review', 'integrate'] as const) {
    const original = registry[command];
    registry[command] = async (args: string[], options: Record<string, unknown> = {}) => {
      if (command === 'integrate') { parseIntegrateCliRequest(args, options.configuration as ParallixConfiguration | undefined); }
      if (bypassOwnership(command, args)) {
        return original(args, options);
      }
      const slug = inferSlug(args[0]?.startsWith('-') ? undefined : args[0]);
      if (!slug) { return original(args, options); }
      const cancellation = { requested: false, stopOwnedWorkflow: true };
      const interrupt = () => { cancellation.requested = true; };
      // Keep this listener through settlement and graph close. Repeated Ctrl+C
      // requests the same cleanup rather than killing its foreground waiter.
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', interrupt);
      let graph: ProductionApplicationServices | undefined;
      let failed = true;
      try {
        graph = await open();
        await dispatchOwnedCli(command, args, slug, graph, cancellation);
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
      if (result?.status !== 'completed') { throw new Error(result?.error?.message ?? 'Stop failed'); }
    } finally {
      try { await graph?.operatorState.close(); }
      finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
    }
  };
}

async function dispatchOwnedCli(command: 'draft' | 'review' | 'integrate', args: string[], slug: string, graph: ProductionApplicationServices,
  cancellation: { requested: boolean; stopOwnedWorkflow: boolean }): Promise<void> {
  const controller = graph.presentationCapabilities?.commandController;
  if (!controller) { throw new Error('Workflow admission is unavailable'); }
  const loaded = await graph.mission?.store.load(slug as never);
  const kind = workflowKind(command, args, loaded?.kind === 'found' ? loaded.mission.status : null);
  const request: BoardCommandRequest = { operationId: randomUUID(), missionId: slug, kind,
    capabilities: new Set([kind]), cancellation, invocation: { command, args, interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) } };
  const result = await controller.dispatch(request);
  if (cancellation.requested) { throw new Error(result.error?.message ?? 'Workflow interrupted'); }
  if (result.status !== 'completed') { throw new Error(result.error?.message ?? result.status); }
}

function bypassOwnership(command: string, args: readonly string[]): boolean {
  return hasMissionWriteAuthorization() || args.includes('--help') || args.includes('--dry-run')
    || command === 'review' && !args.some(arg => ['--start', '--continue', '--submit'].includes(arg));
}
function workflowKind(command: string, args: readonly string[], status: string | null): 'draft:create' | 'integrate:merge' | 'handoff:record' | 'review:submit' {
  if (command === 'draft') { return 'draft:create'; }
  if (command === 'integrate') { return 'integrate:merge'; }
  return args.includes('--submit') || status === 'active' ? 'handoff:record' : 'review:submit';
}


/** CLI observation follows retained coordinator bytes; it never owns execution. */
export function workflowCliObserver(terminal: Pick<import('../application/ports/mission-terminal.js').MissionTerminalCapability, 'history' | 'page'>,
  progress?: import('../application/controller/board-command.js').BoardProgressSink,
  write: (_text: string) => void = text => { process.stdout.write(text); },
  interactive = Boolean(process.stdout.isTTY)) {
  const offsets = new Map<string, number>();
  const replay = workflowReplay(write, interactive);
  let last = '';
  let sequence = 0;
  return (operation: import('../domain/workflow-operation.js').WorkflowOperation): boolean => {
    const summary = operation.reason ?? operation.phase;
    if (summary !== last) {
      last = summary;
      const event = { operationId: operation.id, sequence: ++sequence, phase: operation.phase, message: summary,
        timestamp: operation.updatedAt, ...(operation.agent ? { agent: operation.agent } : {}) };
      progress?.(event);
    }
    const history = terminal.history(operation.missionId);
    if (!history.ok) { return true; }
    let finished = true;
    // The observing CLI also retains its printed output. Replaying its own
    // capture feeds bytes back into itself and waits on its running record.
    const coordinators = history.runs.filter(({ record }) => record.operationId === operation.id
      && record.captureKind === 'coordinator' && record.supervisorPid !== process.pid);
    for (const run of [...coordinators].reverse()) {
      for (const stream of ['stdout', 'stderr'] as const) {
        const key = `${run.record.runId}:${stream}`;
        const page = terminal.page(operation.missionId, { runId: run.record.runId, stream, presentation: 'terminal', after: offsets.get(key) ?? 0 });
        if (!page.ok) { continue; }
        finished = finished && page.atEnd && !page.running;
        replay(key, page);
        offsets.set(key, page.to);
      }
    }
    return finished;
  };
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
