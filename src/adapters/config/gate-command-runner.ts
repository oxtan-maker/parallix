import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { VerificationMeasurement } from '../../application/ports/verification-observation.js';
import { retainGateOutput } from './gate-dashboard.js';
import { settleOnExit } from './child-exit.js';

export function runGateCommand(command: string, _args: string[], options: { cwd: string, env: NodeJS.ProcessEnv, stdio: string, signal?: globalThis.AbortSignal, onOutput?: (_chunk: string, _stream: 'stdout' | 'stderr') => void, forwardOutput?: boolean, bindProcessGroup?: (_pid: number) => void, terminationGraceMs?: number }): Promise<{ status: number | null, stdout: string, stderr: string, signal: string | null, cpu?: VerificationMeasurement['cpu'] }> {
  return new Promise(resolve => {
    if (options.signal?.aborted) { resolve({ status: null, signal: null, stdout: '', stderr: 'Gate cancelled before launch.' }); return; }
    const guarded = Boolean(options.bindProcessGroup);
    // Bash time uses OS rusage for the waited command tree. Dedicated fd 4
    // keeps measurements independent of command output (including forged text).
    const timed = `${guarded ? 'read -r admission <&3 || exit 125; ' : ''}TIMEFORMAT='%U %S'; { time bash -c "$1" 2>&5; } 5>&2 2>&4`;
    const child = spawn('bash', ['-c', timed, 'gate', command], {
      cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let measurement = '';
    (child.stdio[4] as import('node:stream').Readable).on('data', chunk => { measurement += String(chunk); });
    let watchdog: NodeJS.Timeout | undefined;
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        if (process.platform === 'win32') { child.kill(signal); }
        else if (child.pid) { process.kill(-child.pid, signal); }
      } catch { /* The child already exited. */ }
    };
    const finish = (status: number | null, signal: string | null = null) => {
      if (settled) { return; }
      settled = true;
      if (watchdog) { clearTimeout(watchdog); }
      options.signal?.removeEventListener('abort', stop);
      const match = measurement.trim().replaceAll(',', '.').match(/^(\d+\.\d+) (\d+\.\d+)$/);
      const cpu: VerificationMeasurement['cpu'] = match && !signal ? {
        userUs: Math.round(Number(match[1]) * 1e6), systemUs: Math.round(Number(match[2]) * 1e6),
        provenance: 'bash-time-waited-tree', boundary: randomUUID(), parent: null,
      } : null;
      resolve({ status, signal, stdout, stderr, cpu });
    };
    const stop = () => {
      if (settled || watchdog) { return; }
      signalGroup('SIGTERM');
      watchdog = setTimeout(() => {
        signalGroup('SIGKILL');
        child.stdout?.destroy();
        child.stderr?.destroy();
        stderr = retainGateOutput(stderr, '\nGate cancelled after termination grace period.');
        finish(null, 'SIGKILL');
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
    // Cancellation keeps its termination grace and group escalation.
    settleOnExit(child, finish, { terminating: () => Boolean(watchdog) });
    if (guarded && child.pid) {
      try {
        options.bindProcessGroup!(child.pid);
        (child.stdio[3] as import('node:stream').Writable).end('admitted\n');
      } catch (cause) {
        stderr = retainGateOutput(stderr, String(cause));
        signalGroup('SIGKILL');
      }
    }
  });
}
