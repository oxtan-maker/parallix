import { spawn } from 'node:child_process';
import { retainGateOutput } from './gate-dashboard.js';

export function runGateCommand(command: string, _args: string[], options: { cwd: string, env: NodeJS.ProcessEnv, stdio: string, signal?: globalThis.AbortSignal, onOutput?: (_chunk: string, _stream: 'stdout' | 'stderr') => void, forwardOutput?: boolean, terminationGraceMs?: number }): Promise<{ status: number | null, stdout: string, stderr: string }> {
  return new Promise(resolve => {
    const child = spawn('bash', ['-c', command], { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let watchdog: NodeJS.Timeout | undefined;
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        if (process.platform === 'win32') { child.kill(signal); }
        else if (child.pid) { process.kill(-child.pid, signal); }
      } catch { /* The child already exited. */ }
    };
    const finish = (status: number | null) => {
      if (settled) { return; }
      settled = true;
      if (watchdog) { clearTimeout(watchdog); }
      options.signal?.removeEventListener('abort', stop);
      resolve({ status, stdout, stderr });
    };
    const stop = () => {
      if (settled || watchdog) { return; }
      signalGroup('SIGTERM');
      watchdog = setTimeout(() => {
        signalGroup('SIGKILL');
        child.stdout?.destroy();
        child.stderr?.destroy();
        stderr = retainGateOutput(stderr, '\nGate cancelled after termination grace period.');
        finish(null);
      }, options.terminationGraceMs ?? 5000);
    };
    options.signal?.addEventListener('abort', stop, { once: true });
    if (options.signal?.aborted) { stop(); }
    child.stdout?.on('data', chunk => {
      stdout = retainGateOutput(stdout, String(chunk));
      options.onOutput?.(String(chunk), 'stdout');
      if (options.forwardOutput && !process.stdout.write(chunk)) { child.stdout?.pause(); process.stdout.once('drain', () => child.stdout?.resume()); }
    });
    child.stderr?.on('data', chunk => {
      stderr = retainGateOutput(stderr, String(chunk));
      options.onOutput?.(String(chunk), 'stderr');
      if (options.forwardOutput && !process.stderr.write(chunk)) { child.stderr?.pause(); process.stderr.once('drain', () => child.stderr?.resume()); }
    });
    child.once('error', cause => { stderr = retainGateOutput(stderr, String(cause)); finish(null); });
    child.once('close', finish);
  });
}
