import { SqliteWorkflowOperationStore } from '../../src/adapters/sqlite/workflow-operation-store.js';
import type { CliInvocation } from '../../src/adapters/process/cli-invocation.js';
import { WorkflowOperationService } from '../../src/application/workflow-operation-service.js';
import { CurrentWorkRecorder } from '../../src/application/recording/current-work-recorder.js';
import { SqliteOperationalHistoryRepository } from '../../src/adapters/sqlite/operational-history-repository.js';
import { projectWorkflowBoard } from '../../src/application/projections/workflow-board.js';
import { completed } from '../../src/application/contracts.js';
import { createMissionTerminalCapability } from '../../src/composition/mission-terminal-capability.js';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { openMigratedMissionStore } from './mission-sqlite-store.js';
import { fixtureMission } from './mission-builders.js';
import { resolveCanonicalRepositoryId } from '../../src/adapters/git/repository-identity.js';
import { resolveConfiguration } from '../../src/composition/config.js';
import { createProductionApplicationServices } from '../../src/composition/application-services.js';
import { composeWorkflowOperations } from '../../src/composition/workflow-operations.js';
import { workflowObservationCapabilities } from '../../src/composition/workflow-observation.js';
import { createWebHost, type WebHost, type WebHostInfo } from '../../src/interfaces/web/host.js';
import { loadWebAssets } from '../../src/adapters/web/asset-store.js';
import { processStartIdentity } from '../../src/adapters/process/process-liveness.js';

/** Isolated real store/host/process fixture shared by retained and manual checks. */
export async function workflowBoard(count = 2, options: { cli?: CliInvocation; inProcess?: boolean; providers?: boolean } = {}) {
  const fixture = await openMigratedMissionStore();
  const root = fixture.root;
  const hosts = new Map<number, string>();
  const emergencyCleanup = () => {
    if (!fs.existsSync(root)) { return; }
    fs.writeFileSync(path.join(root, 'terminal-probe.release'), 'release');
    for (const name of fs.readdirSync(root)) {
      if (name.endsWith('.entered')) { fs.writeFileSync(path.join(root, name.replace(/\.entered$/, '.release')), 'release'); }
      if (!/^workflow-(supervisor|executor)-/.test(name)) { continue; }
      try {
        const owner = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')) as { pid: number; identity: string };
        if (processStartIdentity(owner.pid) !== owner.identity) { continue; }
        try { process.kill(-owner.pid, 'SIGKILL'); } catch { process.kill(owner.pid, 'SIGKILL'); }
      } catch { /* exited or incomplete startup marker */ }
    }
    for (const [pid, identity] of hosts) {
      if (processStartIdentity(pid) === identity) { try { process.kill(pid, 'SIGKILL'); } catch { /* exited */ } }
    }
  };
  // Run before bootstrap removes case roots, including its SIGTERM -> exit path.
  process.prependListener('exit', emergencyCleanup);
  execFileSync('git', ['init', '--quiet', root]);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { terminal: { host: 'pipe', whenUnavailable: 'fallback' } } }));
  if (options.providers) {
    fs.writeFileSync(path.join(root, 'provider-fixture'), 'enabled');
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config/agents.json'), JSON.stringify({ families: ['codex', 'claude'] }));
  }
  const repository = resolveCanonicalRepositoryId(root);
  const slugs = Array.from({ length: count }, (_, index) => `task-worker-${index + 1}`);
  for (const slug of slugs) { await fixture.store.save(fixtureMission(slug, { status: 'refined', repositoryId: repository }), null); }
  const configuration = resolveConfiguration({ ...process.env, PARALLIX_HOME: root, PARALLIX_TERMINAL_STATE_DIR: path.join(root, 'terminal-state'), PARALLIX_TEST_NO_FORGEJO: '1', PARALLIX_NO_TUI: '1' });
  const cli = options.cli ?? { command: process.execPath, args: ['--import', createRequire(import.meta.url).resolve('tsx'), path.resolve('test/fixtures/workflow-owner-child.ts')] };
  const graph = await createProductionApplicationServices(root, undefined, { configuration });
  const owned = await composeWorkflowOperations(root, configuration, graph.presentationCapabilities!.commandController,
    path.join(root, 'parallix.db'), async () => 'codex', cli);
  const held = new Map<string, () => void>();
  const entered = new Set<string>();
  const executions: Promise<void>[] = [];
  let service = owned.service;
  const operations = options.inProcess ? new SqliteWorkflowOperationStore(fixture.database, repository) : owned.operations;
  if (options.inProcess) {
    service = new WorkflowOperationService(operations, fixture.store,
      { canExecute: () => true, async dispatch<T>(request: { missionId: string }) {
        entered.add(request.missionId);
        await new Promise<void>(resolve => { held.set(request.missionId, resolve); });
        return completed({} as T);
      } },
      { identity: () => ({ pid: process.pid, identity: processStartIdentity(process.pid)! }),
        async launch(id) { const running = service.run(id);
          void running.catch(() => {}); executions.push(running); }, async alive() { return true; },
        async stop() { return true; } },
      new CurrentWorkRecorder(new SqliteOperationalHistoryRepository(fixture.database), { processId: process.pid }),
      repository, async () => 'codex', async () => {});
  }
  const terminal = createMissionTerminalCapability(root, configuration);
  const observation = workflowObservationCapabilities(root, configuration, cli);
  const assets = loadWebAssets(path.resolve('build/web'));
  const hostEvents: Array<{ event: string; operationId: string; time: number }> = [];
  let host: Pick<WebHost, 'close'> | null = null;
  const start = async (separateProcess = false): Promise<WebHostInfo & { processId?: number }> => {
    await host?.close();
    if (separateProcess) {
      const child = spawn(cli.command, [...cli.args, '--workflow-http-host', root, path.resolve('build/web')], { cwd: root,
        env: { ...configuration.forwardedEnvironment }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      child.once('spawn', () => { const identity = processStartIdentity(child.pid!); if (identity) { hosts.set(child.pid!, identity); } });
      child.once('exit', () => { hosts.delete(child.pid!); });
      let diagnostic = '';
      child.stderr?.on('data', chunk => { diagnostic += String(chunk); });
      child.on('message', message => {
        const event = message as { event?: string; operationId: string; time: number };
        if (event.event === 'admission-committed') { hostEvents.push({ ...event, event: event.event }); }
      });
      const close = async () => {
        if (child.exitCode !== null || child.signalCode !== null) { return; }
        await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
      };
      host = { close };
      try {
        return await new Promise<WebHostInfo & { processId: number }>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('HTTP host startup timed out')), 10_000);
          child.once('message', info => { clearTimeout(timer); resolve(info as WebHostInfo & { processId: number }); });
          child.once('error', error => { clearTimeout(timer); reject(error); });
          child.once('exit', code => { clearTimeout(timer); reject(new Error(`HTTP host exited (${code}): ${diagnostic}`)); });
        });
      } catch (error) { await close(); throw error; }
    }
    const inProcess = createWebHost({ assets, buildProjection: options.inProcess ? async () => projectWorkflowBoard(await graph.presentationCapabilities!.boardProjection.build(), await operations.readOnly(() => operations.open())) : observation.board, commandDispatcher: () => service, missionTerminal: () => observation.terminal });
    host = inProcess;
    return inProcess.start();
  };
  let closed = false;
  return {
    root, slugs, configuration, terminal, hostEvents, store: fixture.store, database: fixture.database, service, operations, observation, start,
    probeEntered: () => fs.existsSync(path.join(root, 'terminal-probe.entered')),
    releaseProbe: () => fs.writeFileSync(path.join(root, 'terminal-probe.release'), 'release'),
    release(slug: string) { held.get(slug)?.(); fs.writeFileSync(path.join(root, `${slug}.release`), 'release'); },
    entered(slug: string) { return entered.has(slug) || fs.existsSync(path.join(root, `${slug}.entered`)); },
    async close() {
      if (closed) { return; } closed = true;
      try {
        fs.writeFileSync(path.join(root, 'terminal-probe.release'), 'release');
        // Release every entered provider/gate before awaiting HTTP or owner shutdown.
        // Failed assertions must not leave cleanup waiting on fixture deadlines.
        for (const name of fs.readdirSync(root)) {
          if (name.endsWith('.entered')) { fs.writeFileSync(path.join(root, name.replace(/\.entered$/, '.release')), 'release'); }
        }
        await host?.close();
        for (const slug of slugs) { fs.writeFileSync(path.join(root, `${slug}.release`), 'release'); }
        for (const slug of slugs) { await service.stop(slug).catch(() => {}); held.get(slug)?.(); }
        await Promise.all(executions);
        for (const slug of slugs) {
          await until(() => { try { terminal.retire(slug); return true; } catch { return false; } }, 'terminal retirement', 3000);
        }
      } finally {
        emergencyCleanup(); process.removeListener('exit', emergencyCleanup);
        try { await observation.close(); }
        finally {
          try { await owned.close(); }
          finally { try { await graph.operatorState.close(); } finally { await fixture.close(); } }
        }
      }
    },
  };
}

export async function until(check: () => boolean | Promise<boolean>, description: string, timeout = 20_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() >= deadline) { throw new Error(`Timed out: ${description}`); }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
