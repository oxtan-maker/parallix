import { randomUUID } from 'node:crypto';
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
      if (bypassOwnership(command, args)) {
        return original(args, options);
      }
      const slug = inferSlug(args[0]?.startsWith('-') ? undefined : args[0]);
      if (!slug) { return original(args, options); }
      const graph = await open();
      try {
        const controller = graph.presentationCapabilities?.commandController;
        if (!controller) { throw new Error('Workflow admission is unavailable'); }
        const loaded = await graph.mission?.store.load(slug as never);
        const kind = workflowKind(command, args, loaded?.kind === 'found' ? loaded.mission.status : null);
        const request: BoardCommandRequest = { operationId: randomUUID(), missionId: slug, kind,
          capabilities: new Set([kind]), invocation: { command, args } };
        const result = await controller.dispatch(request);
        if (result.status !== 'completed') { throw new Error(result.error?.message ?? result.status); }
      } finally { await graph.operatorState.close(); }
    };
  }
  registry.stop = async (args: string[]) => {
    const slug = inferSlug(args[0]);
    if (!slug) { throw new Error('px stop requires a mission'); }
    const graph = await open();
    try {
      const result = await graph.presentationCapabilities?.commandController.dispatch({ operationId: randomUUID(), missionId: slug, kind: 'workflow:stop', capabilities: new Set(['workflow:stop']) });
      if (result?.status !== 'completed') { throw new Error(result?.error?.message ?? 'Stop failed'); }
    } finally { await graph.operatorState.close(); }
  };
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
  write: (_text: string) => void = text => { process.stdout.write(text); }) {
  const offsets = new Map<string, number>();
  let last = '';
  let sequence = 0;
  return (operation: import('../domain/workflow-operation.js').WorkflowOperation): boolean => {
    const summary = operation.reason ?? operation.phase;
    if (summary !== last) {
      last = summary;
      const event = { operationId: operation.id, sequence: ++sequence, phase: operation.phase, message: summary,
        timestamp: operation.updatedAt, ...(operation.agent ? { agent: operation.agent } : {}) };
      progress?.(event);
      write(`[${operation.id}] ${summary}\n`);
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
        const page = terminal.page(operation.missionId, { runId: run.record.runId, stream, after: offsets.get(key) ?? 0 });
        if (!page.ok) { continue; }
        finished = finished && page.atEnd && !page.running;
        if (page.text) { write(page.text); }
        offsets.set(key, page.to);
      }
    }
    return finished;
  };
}
