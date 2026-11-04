import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { waitForAdmissionSync } from '../process/admission-wait.js';
import { gitLockPolicyFor } from './git-lock-resources.js';

/** A continuously listening child closes the gap between synchronous probes.
 * The main event loop cannot dispatch its CLI signal listeners while blocked.
 * Pipe EOF also ends the observer if its parent dies; no orphan lease survives.
 */
export function synchronousInterruption(gitDir?: string) {
  const root = fs.mkdtempSync(path.join(gitDir ?? os.tmpdir(), 'parallix-interrupt-'));
  const ready = path.join(root, 'ready'); const cancelled = path.join(root, 'cancelled');
  const child = spawn('sh', ['-c', `
ready=$1; cancelled=$2; owned=$3
interrupted=0
trap 'interrupted=1; printf SIGINT > "$cancelled"' INT
trap 'interrupted=1; printf SIGTERM > "$cancelled"' TERM
printf ready > "$ready"
while :; do
  interrupted=0
  IFS= read -r command && continue
  test "$interrupted" = 1 && continue
  break
done
rm -rf -- "$owned"
`, 'px-git-interrupt', ready, cancelled, root], { stdio: ['pipe', 'ignore', 'ignore'] });
  // A spawn failure is observed through both the event seam and bounded readiness.
  child.on('error', () => {});
  const close = () => {
    child.stdin?.destroy(); child.kill('SIGKILL'); fs.rmSync(root, { recursive: true, force: true });
  };
  try {
    const admitted = waitForAdmissionSync(() => fs.existsSync(ready) ? true : null,
      { ...gitLockPolicyFor('worktree', 2000), progressEveryMs: null });
    if (!admitted.acquired) { throw new Error('Cannot establish Git cancellation observer; operation state preserved'); }
  } catch (error) { close(); throw error; }
  return {
    check() {
      if (fs.existsSync(cancelled)) { throw new Error(`Git admission interrupted by ${fs.readFileSync(cancelled, 'utf8')}; lock and operation state preserved`); }
    }, close,
  };
}

/** Async paths can use ordinary signal handlers while the event loop runs. */
export function gitCancellation(signal?: AbortSignal) {
  const controller = new AbortController(); const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) { cancel(); }
  return { signal: controller.signal, close() {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    signal?.removeEventListener('abort', cancel);
  } };
}
