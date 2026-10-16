import { processStartIdentity } from '../../src/adapters/process/process-liveness.js';
import { composeWorkflowOperations } from '../../src/composition/workflow-operations.js';
import { workflowObservationCapabilities } from '../../src/composition/workflow-observation.js';
import { createMissionTerminalCapability } from '../../src/composition/mission-terminal-capability.js';
/** Real worker entry with deterministic mechanism doubles; never uses a model. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runWorkflowWorker } from '../../src/composition/workflow-operations.js';
import { createProductionApplicationServices } from '../../src/composition/application-services.js';
import { resolveProcessConfiguration } from '../../src/composition/config.js';
import { BoardCommandController } from '../../src/application/controller/board-controller.js';
import { runWorkflowObservation } from '../../src/composition/workflow-observation.js';

const createGraph: typeof createProductionApplicationServices = async (root, progress, options) => {
  const graph = await createProductionApplicationServices(root, progress, options);
  const ports = graph.executePorts;
  const originalWorkspace = ports.workspace;
  const workspace = {
    ...originalWorkspace,
    async preflight(slug: string) {
      console.log(`PREFLIGHT-ENTER:${slug}`);
      fs.writeFileSync(path.join(root, `${slug}.entered`), 'entered');
      // Synchronous work in the real executor must not stall HTTP or SSE.
      execFileSync(process.execPath, ['-e', `const fs=require('fs'); const deadline=Date.now()+20000; while(!fs.existsSync(process.argv[1])) { if(Date.now()>deadline)process.exit(9); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10); }`, path.join(root, `${slug}.release`)], { stdio: 'inherit' });
      console.log(`PREFLIGHT-EXIT:${slug}`); return true;
    },
    async resolveWorktree() { return root; },
    async resolveTaskFile() { return { ok: true }; },
    async readTaskStatus() { return 'active'; },
    async enforceCommitSafety() {},
  };
  const executePorts = { ...ports, workspace,
    agentExecution: { async select() { return 'codex'; }, async prepare() { return { prompt: 'fixture', agent: 'codex', agentConfig: {} }; },
      async launch(request: { onAgentChanged?: (_agent: string) => Promise<void>; slug: string }) {
        await request.onAgentChanged?.('codex'); console.log(`AGENT-OUTPUT:${request.slug}`);
        return { agent: 'codex', rebaseDeferred: true, errored: false, errorMessage: null, exitStatus: 0, detail: {} };
      } },
    telemetry: { async recordLaunchTelemetry() {} },
    checkpointValidation: { async validateBeforeHandoff() { console.log('CHECKPOINT-GATE'); return { ok: true }; } },
    handoffExecution: { async run() { console.log('HANDOFF-OUTPUT'); return { ok: true }; }, async repairHygiene() { return { repaired: false }; }, classifyFailure() { return null; }, isRelaunchableFailure() { return false; } },
    autonomousReview: { async start() { console.log('REVIEW-OUTPUT'); } },
  };
  if (!graph.presentationCapabilities) { throw new Error('Fixture graph missing'); }
  const raw = new BoardCommandController(executePorts, undefined, {}, graph.currentWork, graph.mission!.store);
  return { ...graph, executePorts, presentationCapabilities: { ...graph.presentationCapabilities, commandController: raw } };
};

if (process.argv[2] === '--workflow-http-host') {
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
} else if (process.argv[2] === '--workflow-observe') {
  runWorkflowObservation(process.argv[3], resolveProcessConfiguration(), (root, configuration) => {
    const terminal = createMissionTerminalCapability(root, configuration);
    return { ...terminal, live: mission => {
      fs.writeFileSync(path.join(root, 'terminal-probe.entered'), 'entered');
      execFileSync(process.execPath, ['-e', `const fs=require('fs'); const deadline=Date.now()+20000; while(!fs.existsSync(process.argv[1])) { if(Date.now()>deadline)process.exit(9); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10); }`, path.join(root, 'terminal-probe.release')], { stdio: 'inherit' });
      return terminal.live(mission);
    } };
  });
} else {
  const role = process.argv[2] === '--workflow-execute' ? 'executor' : 'supervisor';
  fs.writeFileSync(path.join(process.argv[4], `workflow-${role}-${process.pid}`), JSON.stringify({ pid: process.pid, identity: processStartIdentity(process.pid) }));
  runWorkflowWorker(process.argv[3], process.argv[4], resolveProcessConfiguration(), process.argv[2] === '--workflow-execute', createGraph)
    .then(code => process.exit(code), error => { console.error(error); process.exit(1); });
}
