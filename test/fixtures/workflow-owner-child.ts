import { processStartIdentity } from '../../src/adapters/process/process-liveness.js';
import { composeWorkflowOperations } from '../../src/composition/workflow-operations.js';
import { workflowObservationCapabilities } from '../../src/composition/workflow-observation.js';
import { createMissionTerminalCapability } from '../../src/composition/mission-terminal-capability.js';
/** Real worker entry with deterministic mechanism doubles; never uses a model. */
import fs from 'node:fs';
import path from 'node:path';
import { flushCompileCache } from 'node:module';
import { runWorkflowWorker } from '../../src/composition/workflow-operations.js';
import type { createProductionApplicationServices } from '../../src/composition/application-services.js';
import { resolveProcessConfiguration } from '../../src/composition/config.js';
import { BoardCommandController } from '../../src/application/controller/board-controller.js';
import { runWorkflowObservation } from '../../src/composition/workflow-observation.js';

/** Block this executor/observer itself without paying for a polling subprocess. */
function synchronousBarrier(release: string): void {
  const deadline = Date.now() + Number(process.env.PARALLIX_FIXTURE_DEADLINE_MS ?? 20_000);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(release)) {
    if (Date.now() >= deadline) { throw new Error(`Fixture barrier expired: ${release}`); }
    Atomics.wait(sleeper, 0, 0, 10);
  }
}

const createGraph: typeof createProductionApplicationServices = async (root, progress, options) => {
  const { createProductionApplicationServices } = await import('../../src/composition/application-services.js');
  const graph = await createProductionApplicationServices(root, progress, options);
  const fixtureRoot = options!.configuration!.storage.parallixHome!;
  const ports = graph.executePorts;
  const originalWorkspace = ports.workspace;
  const workspace = {
    ...originalWorkspace,
    async preflight(slug: string) {
      console.log(`PREFLIGHT-ENTER:${slug}`);
      fs.writeFileSync(path.join(fixtureRoot, `${slug}.entered`), 'entered');
      // Synchronous work in the real executor must not stall HTTP or SSE.
      synchronousBarrier(path.join(fixtureRoot, `${slug}.release`));
      console.log(`PREFLIGHT-EXIT:${slug}`); return true;
    },
    async resolveWorktree() { return root; },
    async resolveTaskFile() { return { ok: true }; },
    async readTaskStatus() { return 'active'; },
    async enforceCommitSafety() {},
  };
  const executePorts = { ...ports, workspace,
    agentExecution: {
      eligible: async () => true,
      async select() { return 'codex'; }, async prepare() { return { prompt: 'fixture', agent: 'codex', agentConfig: {} }; },
      async launch(request: { onAgentChanged?: (_agent: string) => Promise<void>; slug: string }) {
        await request.onAgentChanged?.('codex'); console.log(`AGENT-OUTPUT:${request.slug}`);
        if (fs.existsSync(path.join(fixtureRoot, 'provider-fixture'))) {
          const { fixtureProvider, barrier } = await import('./workflow-provider.js');
          if (fs.existsSync(path.join(fixtureRoot, 'capacity.hold'))) { await barrier(fixtureRoot, `${request.slug}.capacity`); }
          const familyFile = path.join(fixtureRoot, `${request.slug}.families`);
          const families: string[] = fs.existsSync(familyFile) ? JSON.parse(fs.readFileSync(familyFile, 'utf8')) : ['codex'];
          for (const [index, family] of families.entries()) {
            await request.onAgentChanged?.(family);
            await fixtureProvider(fixtureRoot, request.slug, options!.configuration!, family, index + 1);
          }
        }
        return { agent: 'codex', rebaseDeferred: true, errored: false, errorMessage: null, exitStatus: 0, detail: {} };
      } },
    telemetry: { async recordLaunchTelemetry() {} },
    checkpointValidation: { async validateBeforeHandoff() { if (fs.existsSync(path.join(fixtureRoot, 'provider-fixture'))) { const { barrier } = await import('./workflow-provider.js'); await barrier(fixtureRoot, 'post-agent-gate'); } console.log('CHECKPOINT-GATE'); return { ok: true }; } },
    handoffExecution: { async run() { console.log('HANDOFF-OUTPUT'); return { ok: true }; }, async repairHygiene() { return { repaired: false }; }, classifyFailure() { return null; }, isRelaunchableFailure() { return false; } },
    autonomousReview: { async start() { console.log('REVIEW-OUTPUT'); } },
  };
  if (!graph.presentationCapabilities) { throw new Error('Fixture graph missing'); }
  const raw = new BoardCommandController(executePorts, undefined, {}, graph.currentWork, graph.mission!.store);
  return { ...graph, executePorts, presentationCapabilities: { ...graph.presentationCapabilities, commandController: raw } };
};

// Publish compiled fixture modules before starting the next isolated child.
flushCompileCache();

if (process.argv[2] === '--fixture-public') {
  const { setCommandPathProbe, setLauncherHealthProbe } = await import('../../src/adapters/agents/agents.js');
  setCommandPathProbe(() => '/controlled-provider');
  setLauncherHealthProbe(() => ({ ok: true }));
  const { run } = await import('../../src/composition/create-cli.js');
  const code = await run(process.argv.slice(4), { baseCwd: process.argv[3], environment: { ...process.env } });
  process.exit(code);
} else if (process.argv[2] === '--workflow-foreground') {
  const { ownWorkflowCli } = await import('../../src/composition/workflow-cli.js');
  const root = process.argv[3];
  const configuration = resolveProcessConfiguration();
  const graph = await createGraph(root, undefined, { configuration });
  const owned = await composeWorkflowOperations(root, configuration, graph.presentationCapabilities!.commandController,
    path.join(root, 'parallix.db'), async () => 'codex', { command: process.execPath, args: [...process.execArgv, import.meta.filename] });
  // Keep the real foreground wrapper, admission, workers and process boundaries;
  // substitute only the command body with the fixture's held preflight.
  const controller = { dispatch: (request: import('../../src/application/controller/board-command.js').BoardCommandRequest) =>
    owned.service.dispatch(request.kind === 'workflow:stop' ? request : { ...request, kind: 'active:execute', capabilities: new Set(['active:execute']), invocation: undefined }) };
  const registry = { review: async () => {} } as Record<string, import('../../src/interfaces/cli/runtime.js').Command>;
  ownWorkflowCli(registry, async () => ({ ...graph, presentationCapabilities: { ...graph.presentationCapabilities!, commandController: controller as never },
    operatorState: { ...graph.operatorState, close: async () => { await owned.close(); await graph.operatorState.close(); } } }));
  Promise.resolve().then(() => registry.review([process.argv[4], '--submit'])).then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });
} else if (process.argv[2] === '--workflow-http-host') {
  const { createWebHost } = await import('../../src/interfaces/web/host.js');
  const { loadWebAssets } = await import('../../src/adapters/web/asset-store.js');
  const root = process.argv[3];
  const configuration = resolveProcessConfiguration();
  const graph = await createGraph(root, undefined, { configuration });
  const cli = { command: process.execPath, args: [...process.execArgv, import.meta.filename] };
  const owned = await composeWorkflowOperations(root, configuration, graph.presentationCapabilities!.commandController,
    path.join(root, 'parallix.db'), async () => 'codex', cli);
  const transact = owned.operations.transaction.bind(owned.operations);
  owned.operations.transaction = async work => {
    const result = await transact(work);
    if (result && typeof result === 'object' && 'status' in result && result.status === 'accepted'
      && 'operation' in result && result.operation && typeof result.operation === 'object' && 'id' in result.operation) {
      process.send?.({ event: 'admission-committed', operationId: result.operation.id, time: Date.now() });
    }
    return result;
  };
  const observation = workflowObservationCapabilities(root, configuration, cli);
  const host = createWebHost({ assets: loadWebAssets(process.argv[4] ?? path.resolve(import.meta.dirname, '../../build/web')), buildProjection: observation.board,
    commandDispatcher: () => owned.service, missionTerminal: () => observation.terminal });
  process.send?.({ ...await host.start(), processId: process.pid });
  process.once('disconnect', () => { void (async () => {
    await host.close(); await observation.close(); await owned.close(); await graph.operatorState.close();
  })().finally(() => process.exit(0)); });
} else if (['--fixture-cli-execute', '--fixture-cli-lead'].includes(process.argv[2])) {
  const root = process.argv[3]; const slug = process.argv[4]; const configuration = resolveProcessConfiguration();
  const graph = await createGraph(root, undefined, { configuration });
  const owned = await composeWorkflowOperations(root, configuration, graph.presentationCapabilities!.commandController,
    path.join(root, 'parallix.db'), async () => 'codex', { command: process.execPath, args: [...process.execArgv, import.meta.filename] });
  try {
    const { default: active } = await import('../../src/adapters/cli/commands/active.js');
    if (process.argv[2] === '--fixture-cli-lead') {
      const { createLeadSupervisorPort } = await import('../../src/composition/lead-supervisor.js');
      const { createLeadCommand } = await import('../../src/interfaces/cli/lead.js');
      const { createActiveCommand } = await import('../../src/interfaces/cli/active.js');
      const { createCliServiceScope } = await import('../../src/composition/cli-service-scope.js');
      const target = { ...graph, presentationCapabilities: { ...graph.presentationCapabilities!, commandController: owned.service } };
      const scope = { ...createCliServiceScope(root, configuration), openWorkflowServices: async () => target };
      // Only the board queue is controlled; borrowing, forwarding, signals and ownership are real.
      target.presentationCapabilities.boardProjection = { ...graph.presentationCapabilities!.boardProjection,
        build: async () => ({ attentionQueue: [{ missionId: slug, card: { lane: 'active', gate: 'PASS', currentWork: null }, reason: { kind: 'none' }, action: { kind: 'active:execute', display: `px active ${slug}` } }] }) as never };
      const forwards = new Set<Promise<unknown>>();
      try {
        process.exitCode = await createLeadCommand(createLeadSupervisorPort(target, forwards, { rootDir: root, scope,
          active: createActiveCommand((request, options) => active([...request.args], options)), registry: {},
          runPublicCli: async () => { throw new Error('Unexpected non-active forward'); },
          launchRecovery: async () => { throw new Error('Unexpected recovery'); } }))([slug, '--poll', '60', '--budget', '0']);
      } finally { await Promise.allSettled(forwards); }
    } else {
      await active([slug, '--implementer', 'codex'], { controller: owned.service, rootDir: root, missionTitleFn: async () => 'fixture mission', exitFn: code => { throw new Error(`CLI exited ${code}`); } });
    }
  } finally { await owned.close(); await graph.operatorState.close(); }
} else if (process.argv[2] === '--workflow-observe') {
  runWorkflowObservation(process.argv[3], resolveProcessConfiguration(), (root, configuration) => {
    const terminal = createMissionTerminalCapability(root, configuration);
    return { ...terminal, live: mission => {
      fs.writeFileSync(path.join(root, 'terminal-probe.entered'), 'entered');
      synchronousBarrier(path.join(root, 'terminal-probe.release'));
      return terminal.live(mission);
    } };
  });
} else {
  const role = process.argv[2] === '--workflow-execute' ? 'executor' : 'supervisor';
  fs.writeFileSync(path.join(process.argv[4], `workflow-${role}-${process.pid}`), JSON.stringify({ pid: process.pid, identity: processStartIdentity(process.pid) }));
  runWorkflowWorker(process.argv[3], process.argv[4], resolveProcessConfiguration(), process.argv[2] === '--workflow-execute', createGraph)
    .then(code => process.exit(code), error => { console.error(error); process.exit(1); });
}
