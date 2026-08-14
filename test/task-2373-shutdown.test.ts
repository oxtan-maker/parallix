/**
 * TASK-2373 — deterministic `px board` shutdown, proved on real OS processes.
 *
 * Every test here launches the bundled CLI inside a real local PTY, records the
 * launched pid, and asserts that *that pid* is gone. "Ink's exit callback ran"
 * and "the timer was unref'd" are explicitly not accepted as evidence for these
 * criteria (mission anti-slop guardrail).
 *
 * CP-1 contributes the red case: `q` and Ctrl+C while a confirmation dialog is
 * armed. The remaining lifecycle cases are added in CP-7.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { launchPtySmoke, type PtySmokeSession } from './helpers/pty-smoke-harness.js';

const root = process.cwd();
const LAUNCH_TIMEOUT_MS = 20_000;
/** Mission bound: a real board must be gone within five seconds of the key. */
const SHUTDOWN_BUDGET_MS = 5_000;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function plain(output: string): string { return output.replace(ANSI, ''); }

async function waitForOutput(session: PtySmokeSession, pattern: RegExp, milliseconds: number, message: string): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (!pattern.test(plain(session.output()))) {
    if (!session.isAlive() || Date.now() >= deadline) { break; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.match(plain(session.output()), pattern, `${message} (alive=${session.isAlive()})`);
}

interface BoardFixture {
  readonly session: PtySmokeSession;
  dispose(): Promise<void>;
}

/** Launch a real interactive `px board` over a throwaway repository fixture. */
async function launchBoard(): Promise<BoardFixture> {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'parallix-2373-shutdown-fixture-'));
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'parallix-2373-shutdown-state-'));
  await mkdir(path.join(fixtureRoot, 'backlog', 'tasks'), { recursive: true });
  await writeFile(path.join(fixtureRoot, 'backlog', 'tasks', 'task-2373-shutdown.md'), [
    '---', 'id: TASK-SHUTDOWN', 'title: Shutdown fixture mission', 'status: active',
    'assignee: []', 'labels: []', '---', '',
  ].join('\n'));
  const session = await launchPtySmoke([process.execPath, path.join(root, 'build/px.mjs'), 'ui'], {
    cwd: fixtureRoot,
    timeoutMs: LAUNCH_TIMEOUT_MS,
    env: { ...process.env, PARALLIX_HOME: stateRoot },
  });
  await waitForOutput(session, /px board/, LAUNCH_TIMEOUT_MS, 'the real board must render before shutdown is exercised');
  return {
    session,
    dispose: async () => {
      if (session.isAlive()) {
        try { session.signal('SIGKILL'); } catch { /* already gone */ }
      }
      await session.cleanup();
      await rm(fixtureRoot, { recursive: true, force: true });
      await rm(stateRoot, { recursive: true, force: true });
    },
  };
}

/** Arm the guarded confirmation dialog on the focused mission. */
async function armConfirmation(session: PtySmokeSession): Promise<void> {
  session.send('\r');
  await waitForOutput(session, /CONFIRM CONSEQUENTIAL ACTION/, SHUTDOWN_BUDGET_MS, 'Enter must arm the confirmation dialog');
}

async function assertTerminates(fixture: BoardFixture, key: string, description: string): Promise<void> {
  const { session } = fixture;
  const pid = session.pid;
  session.send(key);
  const exitCode = await session.waitForExit(SHUTDOWN_BUDGET_MS);
  assert.ok(
    session.processGone(),
    `${description}: pid ${pid} must no longer exist (exit code ${exitCode})`,
  );
  assert.equal(await session.terminalRestored(), true, `${description}: terminal raw-mode state must be restored`);
}

async function assertTerminatesBySignal(fixture: BoardFixture, signal: NodeJS.Signals, description: string): Promise<void> {
  const { session } = fixture;
  const pid = session.pid;
  session.signal(signal);
  const exitCode = await session.waitForExit(SHUTDOWN_BUDGET_MS);
  assert.ok(session.processGone(), `${description}: pid ${pid} must no longer exist (exit code ${exitCode})`);
  assert.equal(await session.terminalRestored(), true, `${description}: terminal raw-mode state must be restored`);
}

test('SC19: q terminates a real idle px board and leaves its spawned PID gone', async () => {
  const fixture = await launchBoard();
  try {
    await assertTerminates(fixture, 'q', 'idle q');
  } finally {
    await fixture.dispose();
  }
});

test('SC20: Ctrl+C terminates a real idle px board and leaves its spawned PID gone', async () => {
  const fixture = await launchBoard();
  try {
    await assertTerminates(fixture, '\u0003', 'idle Ctrl+C');
  } finally {
    await fixture.dispose();
  }
});

test('TASK-2373 defect 6: q terminates a real px board while a confirmation dialog is armed', async () => {
  const fixture = await launchBoard();
  try {
    await armConfirmation(fixture.session);
    await assertTerminates(fixture, 'q', 'q with an armed confirmation');
  } finally {
    await fixture.dispose();
  }
});

test('TASK-2373 defect 6: Ctrl+C terminates a real px board while a confirmation dialog is armed', async () => {
  const fixture = await launchBoard();
  try {
    await armConfirmation(fixture.session);
    await assertTerminates(fixture, '\u0003', 'Ctrl+C with an armed confirmation');
  } finally {
    await fixture.dispose();
  }
});

test('SC22: SIGTERM terminates the real interactive board cleanly', async () => {
  const fixture = await launchBoard();
  try {
    await assertTerminatesBySignal(fixture, 'SIGTERM', 'SIGTERM');
  } finally {
    await fixture.dispose();
  }
});

test('SC26: ten real start-and-quit cycles leave every spawned board PID gone', async () => {
  for (let index = 0; index < 10; index += 1) {
    const fixture = await launchBoard();
    try {
      await assertTerminates(fixture, 'q', `cycle ${index + 1}`);
    } finally {
      await fixture.dispose();
    }
  }
});
