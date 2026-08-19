/**
 * TASK-2377.01 — red reproduction for the PTY terminal-restore postcondition.
 *
 * The subject here is deliberately *not* the board: a bare idle `node -e` loop
 * has no SIGINT handler and never enables raw mode, so the terminal it runs on
 * is trivially "restored" the moment the process is gone. Any failure of the
 * terminal-restore assertion is therefore a harness defect, not an application
 * one.
 *
 * On the mission's parent commit the assertion fails with
 * `ENOENT: … /stty-after`, because the outer `script` shell shares the Ctrl+C
 * foreground process group and dies before it can write that postcondition
 * file. The fix (CP 2) moves the after-state capture into the test process,
 * which is outside the signal blast radius.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchPtySmoke } from './helpers/pty-smoke-harness.js';

const LAUNCH_TIMEOUT_MS = 20_000;
const SHUTDOWN_BUDGET_MS = 5_000;
const READY = 'PTY-SMOKE-READY';

test('TASK-2377: Ctrl+C through the PTY smoke harness still yields an observable terminal-restore postcondition', async () => {
  const session = await launchPtySmoke(
    [process.execPath, '-e', `process.stdout.write('${READY}\\n'); setInterval(() => {}, 1000);`],
    { cwd: process.cwd(), timeoutMs: LAUNCH_TIMEOUT_MS },
  );
  try {
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    while (!session.output().includes(READY)) {
      if (Date.now() >= deadline) { break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(session.output().includes(READY), `the idle process must announce itself before Ctrl+C (alive=${session.isAlive()})`);

    // Cooked line discipline: 0x03 becomes a SIGINT to the PTY's foreground
    // process group, which is exactly the case the harness must survive.
    session.send('\u0003');
    await session.waitForExit(SHUTDOWN_BUDGET_MS);
    assert.ok(session.processGone(), `pid ${session.pid} must be gone after Ctrl+C`);
    assert.equal(
      await session.terminalRestored(),
      true,
      'the terminal-restore postcondition must be observable after a Ctrl+C that kills the outer shell',
    );
  } finally {
    await session.cleanup();
  }
});
