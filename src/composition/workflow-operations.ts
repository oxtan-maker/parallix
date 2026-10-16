import { requireWorkflowOwner } from '../domain/workflow-operation.js';
import { resolveDatabasePath } from '../adapters/sqlite/database-path-resolver.js';
import type { workflowCliObserver } from './workflow-cli.js';
import type { createMissionTerminalCapability } from './mission-terminal-capability.js';
import { missionLabels } from '../domain/mission.js';
import { completed, failure } from '../application/contracts.js';
import { hasMissionWriteAuthorization } from '../application/ports/mission-write-authorization.js';
import { projectWorkflowBoard } from '../application/projections/workflow-board.js';
import { configureMissionWriteAuthorization } from '../application/ports/mission-write-authorization.js';
import { randomUUID } from 'node:crypto';
import { hostWorkflowExecutor } from './mission-terminal.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { BoardCommandRequest, BoardCommandDispatcher } from '../application/controller/board-command.js';
import { WorkflowOperationService } from '../application/workflow-operation-service.js';
import { CurrentWorkRecorder } from '../application/recording/current-work-recorder.js';
import { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { SqliteWorkflowOperationStore } from '../adapters/sqlite/workflow-operation-store.js';
import { SqliteOperationalHistoryRepository } from '../adapters/sqlite/operational-history-repository.js';
import { WorkflowProcessAdapter } from '../adapters/process/workflow-process.js';
import { cliInvocation, type CliInvocation } from '../adapters/process/cli-invocation.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { resolveWorktree } from '../adapters/git/worktree.js';
import { openRunCapture } from '../adapters/filesystem/run-history-store.js';
import { resolveConfiguredCredentialRedactor } from '../application/recovery-evidence.js';
import type { createProductionApplicationServices } from './application-services.js';
import { createMissionStore } from './mission-persistence.js';
import { correlateMissionCapture } from './mission-terminal.js';
import { startWorkflowRecovery } from './workflow-recovery.js';

/** Admission owns a dedicated connection, never the HTTP graph's shared handle. */
export async function composeWorkflowOperations(root: string, configuration: ParallixConfiguration, dispatcher: BoardCommandDispatcher,
  dbPath: string, select: () => Promise<string>, cli: CliInvocation = cliInvocation(process.argv[1]), observe?: Parameters<typeof workflowCliObserver>[1] | false) {
  const db = new SqliteDatabaseAdapter(configuration);
  // Do not block the HTTP loop behind a worker's SQLite writer.
  await db.open({ path: dbPath, busyTimeoutMs: 0 });
  const repository = resolveCanonicalRepositoryId(root);
  let terminal: ReturnType<typeof createMissionTerminalCapability> | undefined;
  const loadTerminal = async () => {
    if (!terminal) {
      const { createMissionTerminalCapability } = await import('./mission-terminal-capability.js');
      terminal ??= createMissionTerminalCapability(root, configuration);
    }
    return terminal;
  };
  // Recovery needs terminal resources only when an operation has effects to
  // reconcile. An empty intent store must not initialize provider rendering.
  const terminalFactory = observe === false ? undefined : (await import('./mission-terminal-capability.js')).createMissionTerminalCapability;
  const observedTerminal = () => terminal ??= terminalFactory!(root, configuration);
  const processes = new WorkflowProcessAdapter(cli, root, configuration, async operation => {
    const history = (await loadTerminal()).history(operation.missionId);
    if (!history.ok) { return false; }
    return history.runs.filter(run => run.record.operationId === operation.id && run.record.captureKind === 'agent')
      .every(run => run.execution === 'stopped');
  }, async operation => {
    const history = (await loadTerminal()).history(operation.missionId);
    if (!history.ok) { return false; }
    for (const run of history.runs) {
      if (run.record.operationId !== operation.id || run.record.captureKind !== 'agent' || run.execution === 'stopped') { continue; }
      const execution = run.record.execution;
      if (!execution?.processIdentity || !await processes.stop({ pid: execution.pid, identity: execution.processIdentity })) { return false; }
    }
    return true;
  });
  const operations = new SqliteWorkflowOperationStore(db, repository);
  const work = new CurrentWorkRecorder(new SqliteOperationalHistoryRepository(db), {
    processId: process.pid,
    onPublication: publication => correlateMissionCapture(root, configuration, publication),
  });
  const observer = observe === false ? undefined : (await import('./workflow-cli.js')).workflowCliObserver;
  const service = new WorkflowOperationService(operations, createMissionStore(db), dispatcher, processes, work, repository,
    select, () => new Promise(resolve => setTimeout(resolve, 100)), async slug => {
      const { findTaskFile, getTaskFrontmatterValue, getTaskLabels, getTaskStatus } = await import('../adapters/backlog/backlog.js');
      const file = findTaskFile(slug, root);
      if (!file) { return null; }
      return { title: String(getTaskFrontmatterValue(file, 'title') ?? slug), labels: missionLabels(getTaskLabels(file)), status: String(getTaskStatus(file) ?? 'backlog') };
    }, observe === false ? undefined : observer!({
      history: mission => observedTerminal().history(mission),
      page: (mission, request) => observedTerminal().page(mission, request),
    }, observe));
  return { service, close: () => db.close(), operations };
}

/** The independent supervisor owns capture; executor stdio never uses HTTP IPC. */
interface WorkerDependencies {
  readonly worktree?: typeof resolveWorktree;
  readonly compose?: typeof composeWorkflowOperations;
  readonly capture?: typeof openRunCapture;
  readonly host?: typeof hostWorkflowExecutor;
}
export async function runWorkflowWorker(id: string, root: string, configuration: ParallixConfiguration, execute = false, createGraph: typeof createProductionApplicationServices = async (...args) => {
    const { createProductionApplicationServices } = await import('./application-services.js');
    return createProductionApplicationServices(...args);
  }, dependencies: WorkerDependencies = {}): Promise<number> {
  // Supervisors and duplicate executors use only the intent store. Build the
  // complete graph after the executor has won the authoritative claim.
  const raw: BoardCommandDispatcher = { canExecute: () => false, dispatch: async () => failure('unavailable', 'Supervisor cannot execute commands') };
  const owned = await (dependencies.compose ?? composeWorkflowOperations)(root, configuration, raw, resolveDatabasePath({ configuration }),
    async () => { throw new Error('Workers cannot admit commands'); }, undefined, false);
  try {
    const operation = await owned.service.operation(id);
    if (!operation) { throw new Error('Unknown workflow operation'); }
    if (execute) {
      await owned.service.run(id, request => executeWorkflowCommand(id, operation, request, owned.service, root, configuration, createGraph));
      return (await owned.service.operation(id))?.phase === 'completed' ? 0 : 1;
    }
    if (!await owned.service.reserveLaunch(id)) { return 0; }
    return await superviseWorkflow(id, operation, owned.service, root, configuration, dependencies);
  } catch (error) {
    await owned.service.startupFailed(id, error instanceof Error ? error.message : String(error)).catch(() => {});
    throw error;
  } finally { await owned.close(); }
}


/** The supervisor captures one reserved executor and reconciles executor exits. */
async function superviseWorkflow(id: string, operation: import('../application/ports/workflow-operation.js').WorkflowOperationRecord,
  service: WorkflowOperationService, root: string, configuration: ParallixConfiguration, dependencies: WorkerDependencies): Promise<number> {
  const runId = `workflow-${randomUUID()}`;
  const capture = (dependencies.capture ?? openRunCapture)({
    worktree: (dependencies.worktree ?? resolveWorktree)(operation.missionId) ?? root,
    identity: { repositoryId: operation.repositoryId, missionId: operation.missionId, role: operation.command.split(':')[0], family: null, attempt: null },
    runId, captureKind: 'coordinator', terminalHost: 'pipe',
    redactor: resolveConfiguredCredentialRedactor(configuration.runtime.credentialRedactor),
  });
  capture.correlateOperation(operation.id);
  const cli = cliInvocation(process.argv[1]);
  let result: Awaited<ReturnType<typeof hostWorkflowExecutor>>;
  try { result = await (dependencies.host ?? hostWorkflowExecutor)(cli, operation, root, runId, capture, configuration); }
  catch (error) {
    await service.startupFailed(id, error instanceof Error ? error.message : String(error));
    capture.finish({ exitCode: 1, signal: null, omissions: ['Workflow host failed before execution'] });
    throw error;
  }
  await service.startupFailed(id, `Workflow executor exited before claiming ownership (exit ${result.exitCode ?? result.signal ?? 'unknown'})`);
  await service.recover(id);
  capture.finish({ ...result, sources: [{ kind: 'terminal-bytes', path: 'stdout', covers: 'complete workflow process output, including inherited child stdio', complete: true }], omissions: [] });
  return result.exitCode ?? 1;
}


/** Executing owner composes providers only after winning the durable claim. */
async function executeWorkflowCommand(id: string, operation: import('../application/ports/workflow-operation.js').WorkflowOperationRecord,
  request: BoardCommandRequest, service: WorkflowOperationService, root: string, configuration: ParallixConfiguration,
  createGraph: typeof createProductionApplicationServices) {
  const current = await service.operation(id);
  if (!current) { throw new Error('Workflow ownership missing'); }
  configuration = { ...configuration,
    runtime: { ...configuration.runtime, workflowOperation: id, workflowGeneration: current.generation },
    forwardedEnvironment: { ...configuration.forwardedEnvironment, PARALLIX_WORKFLOW_OPERATION: id, PARALLIX_WORKFLOW_GENERATION: String(current.generation) },
  };
  // Bind progress when composing the application service: the controller's
  // service delegate owns these events, rather than its fallback renderer.
  const { renderActiveProgress } = await import('../adapters/cli/commands/active.js');
  const { log } = await import('../application/presentation/cli-format.js');
  const graph = await createGraph(root, event => renderActiveProgress(event, log.info), { configuration, inheritWorkflowAuthorization: false });
  try {
    const controller = graph.presentationCapabilities?.commandController;
    if (!controller) { throw new Error('Workflow authority is unavailable'); }
    configureMissionWriteAuthorization({ operationId: id, providerStarted: agent => service.progress(id, current.generation, 'execute', 'provider execution started', agent, true), progress: (phase, summary, agent) => service.progress(id, current.generation, phase, summary, agent), assert: async (mission, read) => {
      if (mission !== operation.missionId) { throw new Error('Workflow cannot mutate another mission'); }
      if (read) {
        const owner = await read(id);
        if (!owner) { throw new Error('Workflow owner missing'); }
        requireWorkflowOwner(owner, current.generation);
      } else { await service.assertOwner(id, current.generation); }
    } });
    if (operation.invocation) {
      const { run } = await import('./create-cli.js');
      const status = await run([operation.invocation.command, ...operation.invocation.args], { baseCwd: root, environment: configuration.forwardedEnvironment });
      return status === 0 ? completed({ operationId: id }) : failure('execution', `Workflow exited with status ${status}`);
    }
    return await controller.dispatch(request);
  }
  finally { configureMissionWriteAuthorization(null); await graph.operatorState.close(); }
}


/** Pure command reads use the graph's existing connection and never recover work. */
export function observeWorkflowOperations(graph: Awaited<ReturnType<typeof createProductionApplicationServices>>) {
  const capabilities = graph.presentationCapabilities;
  if (!capabilities || !graph.operatorState.db || !graph.mission) { return graph; }
  const operations = new SqliteWorkflowOperationStore(graph.operatorState.db as SqliteDatabaseAdapter, graph.mission.repositoryId);
  const projection = { buildMissionCard: capabilities.boardProjection.buildMissionCard.bind(capabilities.boardProjection),
    build: async () => projectWorkflowBoard(await capabilities.boardProjection.build(), await operations.readOnly(() => operations.open())) };
  return { ...graph, presentationCapabilities: { ...capabilities, boardProjection: projection,
    tui: { ...capabilities.tui, boardProjection: projection } } };
}

/** One shared owner boundary for the CLI, TUI and web graph. */
export async function attachWorkflowOperations(root: string, configuration: ParallixConfiguration,
  graph: Awaited<ReturnType<typeof createProductionApplicationServices>>, recover = false, progress?: import('../application/controller/board-command.js').BoardProgressSink) {
  if (hasMissionWriteAuthorization()) { return graph; }
  const capabilities = graph.presentationCapabilities;
  const dbPath = (graph.operatorState.db as SqliteDatabaseAdapter | null)?.getPath();
  if (!capabilities || !dbPath) { return graph; }
  const owned = await composeWorkflowOperations(root, configuration, capabilities.commandController, dbPath, async () => {
    const selected = await graph.executePorts.agentExecution.select?.('');
    if (!selected) { throw new Error('No configured execute agent'); } return selected;
  }, undefined, progress);
  const controller = owned.service;
  const recovery = recover ? startWorkflowRecovery(root, configuration) : null;
  const projection = { buildMissionCard: capabilities.boardProjection.buildMissionCard.bind(capabilities.boardProjection), build: async () => projectWorkflowBoard(await capabilities.boardProjection.build(), await owned.operations.readOnly(() => owned.operations.open())) };
  return { ...graph,
    presentationCapabilities: { ...capabilities, boardProjection: projection, commandController: controller,
      tui: { ...capabilities.tui, boardProjection: projection, commandController: controller, commandControllerFactory: () => controller } },
    operatorState: { ...graph.operatorState, close: async () => {
      try { await recovery?.close(); }
      finally { try { await owned.close(); } finally { await graph.operatorState.close(); } }
    } },
  };
}
