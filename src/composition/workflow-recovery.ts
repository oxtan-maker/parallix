import { spawn } from 'node:child_process';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { failure } from '../application/contracts.js';
import { resolveDatabasePath } from '../adapters/sqlite/database-path-resolver.js';
import { cliInvocation, type CliInvocation } from '../adapters/process/cli-invocation.js';
import type { composeWorkflowOperations } from './workflow-operations.js';
import { setImmediate } from 'node:timers/promises';
import * as fmt from '../application/presentation/cli-format.js';

export const workflowRecoverySystem = { spawn };

/** Recovery observes native processes and retained output outside the UI loop. */
export function startWorkflowRecovery(root: string, configuration: ParallixConfiguration, cli: CliInvocation = cliInvocation(process.argv[1])) {
  let child: ReturnType<typeof spawn> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let detach: (() => void) | null = null;
  let closed = false;
  let attempts = 0;
  const failed = (reason: string) => {
    if (closed) { return; }
    attempts++;
    const detail = `Workflow recovery worker failed (attempt ${attempts}/3): ${reason}.`;
    if (attempts >= 3) {
      fmt.log.plainError(`${detail} Automatic recovery is unavailable. Check operator database access and the configured CLI, then restart px web or px ui. Existing workflow owners continue independently.`);
      return;
    }
    const delay = Math.min(2000 * 2 ** (attempts - 1), 4000);
    fmt.log.plainError(`${detail} Retrying in ${delay} ms; check operator database access and the configured CLI.`);
    retry = setTimeout(start, delay); retry.unref();
  };
  const start = () => {
    if (closed) { return; }
    let launched: ReturnType<typeof spawn>;
    try {
      launched = workflowRecoverySystem.spawn(cli.command, [...cli.args, '--workflow-recover', root], {
        cwd: root, env: { ...configuration.forwardedEnvironment }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
    } catch (error) { failed(error instanceof Error ? error.message : String(error)); return; }
    child = launched;
    let ended = false;
    const healthy = setTimeout(() => { attempts = 0; }, 30000);
    healthy.unref();
    const restart = (reason: string) => {
      if (ended) { return; } ended = true;
      clearTimeout(healthy);
      launched.removeListener('error', onError); launched.removeListener('exit', onExit);
      if (child === launched) { child = null; }
      failed(reason);
    };
    const onError = (error: Error) => restart(error.message);
    const onExit = (code: number | null, signal: string | null) => restart(`exited with ${signal ?? `code ${code ?? 'unknown'}`}`);
    launched.once('error', onError);
    launched.once('exit', onExit);
    detach = () => { clearTimeout(healthy); launched.removeListener('error', onError); launched.removeListener('exit', onExit); };
  };
  start();
  return {
    async close(): Promise<void> {
      closed = true;
      if (retry) { clearTimeout(retry); }
      const current = child; child = null;
      if (!current) { return; }
      detach?.(); detach = null;
      await new Promise<void>((resolve, reject) => {
        let diagnostic = '';
        const onError = (error: Error) => { diagnostic = error.message; };
        const signal = (value: NodeJS.Signals) => { try { current.kill(value); } catch (error) { onError(error as Error); } };
        const cleanup = () => {
          clearTimeout(terminate); clearTimeout(force); clearTimeout(deadline);
          current.removeListener('exit', onExit); current.removeListener('error', onError);
        };
        const onExit = () => { cleanup(); resolve(); };
        const terminate = setTimeout(() => { signal('SIGTERM'); }, 2000);
        const force = setTimeout(() => { signal('SIGKILL'); }, 4000);
        const deadline = setTimeout(() => {
          cleanup(); reject(new Error(`Recovery worker termination is unconfirmed${diagnostic ? `: ${diagnostic}` : ''}`));
        }, 6000);
        current.once('exit', onExit); current.on('error', onError);
        try { if (current.connected) { current.disconnect(); } else { signal('SIGTERM'); } }
        catch (error) { onError(error as Error); signal('SIGTERM'); }
      });
    },
  };
}

/** Each recovery pass settles before scheduling the next; IPC owns its lifetime. */
export async function runWorkflowRecovery(root: string, configuration: ParallixConfiguration,
  compose: typeof composeWorkflowOperations | undefined = undefined, lifetime: Pick<NodeJS.Process, 'connected' | 'once'> = process): Promise<void> {
  if (!lifetime.connected) { return; }
  let disconnected!: () => void;
  const stop = new Promise<void>(resolve => { disconnected = resolve; });
  let stopped = !lifetime.connected;
  let timer: ReturnType<typeof setTimeout> | null = null;
  lifetime.once('disconnect', () => { stopped = true; if (timer) { clearTimeout(timer); } disconnected(); });
  if (!compose) {
    // IPC shutdown can arrive while the canonical bundle is being compiled.
    // Observe it before loading or opening services that no host still owns.
    await setImmediate();
    if (stopped || !lifetime.connected) { return; }
    compose = (await import('./workflow-operations.js')).composeWorkflowOperations;
    if (stopped || !lifetime.connected) { return; }
  }
  const owned = await compose(root, configuration,
    { canExecute: () => false, dispatch: async () => failure('unavailable', 'Recovery cannot execute commands') },
    resolveDatabasePath({ configuration }), async () => { throw new Error('Recovery cannot admit commands'); }, undefined, false);
  let active: Promise<void> = Promise.resolve();
  const recover = () => {
    if (stopped) { return; }
    active = owned.service.recover().catch(() => {}).finally(() => {
      if (!stopped) { timer = setTimeout(recover, 2000); }
    });
  };
  try {
    recover();
    if (!stopped) { await stop; }
    await active;
  } finally { if (timer) { clearTimeout(timer); } await owned.close(); }
}
