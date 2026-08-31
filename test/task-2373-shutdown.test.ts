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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { launchPtySmoke, type PtySmokeSession } from './helpers/pty-smoke-harness.js';
import { createMissionApplicationServices } from '../src/composition/application-services.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';

const execFileP = promisify(execFile);

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
    // Ctrl+C must reach the app as a raw keystroke; while the line discipline
    // is still cooked, 0x03 becomes a SIGINT to the whole foreground process
    // group (including the wrapper shell) instead of an input byte.
    await fixture.session.waitForRaw(LAUNCH_TIMEOUT_MS);
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

// ---------------------------------------------------------------------------
// TASK-2377 — SIGINT is a board exit path, on both sides of Ink's raw-mode
// window
// ---------------------------------------------------------------------------
//
// Ink's `exitOnCtrlC` only sees the 0x03 *byte*, and only once its raw-mode
// effect has run. Before that the line discipline is still cooked, so Ctrl+C
// arrives as a SIGINT to the foreground process group. These tests assert the
// board's own SIGINT handler (`src/interfaces/tui/ui-command.ts`) on both sides
// of that window: a numeric exit code rather than death by signal (which the
// harness would report as 128 + n), a restored terminal, and the pid gone.
//
// The non-raw cases put the line discipline back into canonical, signalling
// mode from the *test* process (`leaveRawMode`) instead of racing the board's
// startup. Sending the signal during startup would be timing-dependent, and a
// signal that lands before the 3 MB bundle has finished loading is outside any
// application handler's reach — it would prove nothing about this fix.

async function assertSigintExitsCleanly(fixture: BoardFixture, deliver: () => void, description: string): Promise<void> {
  const { session } = fixture;
  const pid = session.pid;
  deliver();
  const exitCode = await session.waitForExit(SHUTDOWN_BUDGET_MS);
  assert.equal(
    exitCode,
    0,
    `${description}: the board must exit with a numeric code of its own; 128+n means it died by signal instead`,
  );
  assert.ok(session.processGone(), `${description}: pid ${pid} must no longer exist`);
  assert.equal(await session.terminalRestored(), true, `${description}: terminal state must be restored`);
}

test('TASK-2377: SIGINT while the board is not in raw mode exits with a numeric code', async () => {
  const fixture = await launchBoard();
  try {
    await fixture.session.waitForRaw(LAUNCH_TIMEOUT_MS);
    await fixture.session.leaveRawMode();
    assert.equal(await fixture.session.isRaw(), false, 'this case must deliver the signal while raw mode is off');
    await assertSigintExitsCleanly(fixture, () => fixture.session.signal('SIGINT'), 'non-raw SIGINT');
  } finally {
    await fixture.dispose();
  }
});

test('TASK-2377: SIGINT after Ink enables raw mode exits the real board with a numeric code', async () => {
  const fixture = await launchBoard();
  try {
    await fixture.session.waitForRaw(LAUNCH_TIMEOUT_MS);
    assert.equal(await fixture.session.isRaw(), true, 'this case must exercise the window after Ink enables raw mode');
    await assertSigintExitsCleanly(fixture, () => fixture.session.signal('SIGINT'), 'post-raw SIGINT');
  } finally {
    await fixture.dispose();
  }
});

test('TASK-2377: Ctrl+C typed while the line discipline is cooked exits with a numeric code', async () => {
  const fixture = await launchBoard();
  try {
    await fixture.session.waitForRaw(LAUNCH_TIMEOUT_MS);
    await fixture.session.leaveRawMode();
    assert.equal(await fixture.session.isRaw(), false, 'this case must send 0x03 while the line discipline is cooked');
    // Cooked line discipline: this 0x03 becomes a SIGINT to the whole
    // foreground process group, not an input byte Ink can read. This is the
    // exact delivery path that used to kill the board mid-startup.
    await assertSigintExitsCleanly(fixture, () => fixture.session.send('\u0003'), 'cooked-mode Ctrl+C');
  } finally {
    await fixture.dispose();
  }
});

test('TASK-2377: repeated SIGINT during board shutdown still exits with a numeric code', async () => {
  const fixture = await launchBoard();
  try {
    await fixture.session.waitForRaw(LAUNCH_TIMEOUT_MS);
    await assertSigintExitsCleanly(fixture, () => {
      fixture.session.signal('SIGINT');
      fixture.session.signal('SIGINT');
      fixture.session.signal('SIGINT');
    }, 'repeated SIGINT');
  } finally {
    await fixture.dispose();
  }
});

// ---------------------------------------------------------------------------
// TASK-2375 SC3 — shutdown while a board-dispatched action is in flight
// ---------------------------------------------------------------------------
//
// Round-1 review (F2): the earlier SC3 tests dispatched into a plain temp
// directory, where the only dispatchable kind (`active:execute`) fails within
// milliseconds in preflight. Nothing was ever demonstrably in flight, a 100 ms
// sleep stood in for started synchronization, and no ownership outcome was
// asserted. This section launches the board over a real git mission fixture
// whose `claude` is a stub agent: `--help` exits 0 (the health probe), and a
// real launch writes its own PID to a start marker, then blocks for a long
// time. The quit key is sent only after the marker proves the dispatched child
// process is running (bounded wait, no sleeps), and the ownership outcome is
// asserted against the existing rule (CP-4 fire-and-forget detach): the board
// exits without waiting, and the child is reaped by OS session teardown
// (SIGHUP), never by a board-sent signal.

const DISPATCH_START_BUDGET_MS = 30_000;
const REAP_BUDGET_MS = 3_000;
const SC3_SLUG = 'task-2375shut';

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

async function gitIn(cwd: string, ...args: string[]): Promise<void> {
  await execFileP('git', args, { cwd });
}

async function seedInflightMission(fixtureRoot: string, stateRoot: string): Promise<void> {
  const services = await createMissionApplicationServices(fixtureRoot, {
    databasePath: path.join(stateRoot, 'parallix.db'),
  });
  const id = missionId(SC3_SLUG);
  const intake = await services.intake.execute({
    operationId: `${SC3_SLUG}-intake`,
    missionId: id,
    repositoryId: services.repositoryId,
    title: 'In-flight shutdown fixture',
    rawStatus: 'active',
    capabilities: new Set(['mission:intake']),
  });
  assert.equal(intake.status, 'completed', 'the fixture mission must be materialized for the authoritative board guard');
  // Intake materializes every mission as `backlog`; refinement is what
  // `px draft` records before a launch, and activation demands it.
  const refined = await services.lifecycle.transition({
    operationId: `${SC3_SLUG}-refine`,
    missionId: id,
    command: { type: 'refine' },
    actor: 'claude',
    occurredAt: new Date().toISOString(),
    capabilities: new Set(['mission:transition']),
  });
  assert.equal(refined.status, 'completed', 'the fixture mission must be refined before it can be activated');
  const activated = await services.lifecycle.activate({
    operationId: `${SC3_SLUG}-activate`,
    missionId: id,
    agent: agentFamily('claude'),
    occurredAt: new Date().toISOString(),
    capabilities: new Set(['mission:transition']),
  });
  assert.equal(activated.status, 'completed', 'the fixture mission authority must match the active board card');
}

interface InflightBoardFixture {
  readonly session: PtySmokeSession;
  readonly markerPath: string;
  readonly signalPath: string;
  childPid: number | null;
  dispose(): Promise<void>;
}

/**
 * A real mission fixture (git repo, mission branch, active classified task,
 * mission dir) plus a stub `claude` on PATH whose real launches write a start
 * marker (their own PID) and then block. The stub's signal traps record how
 * the child dies: SIGHUP (OS session teardown) or SIGINT (the Ctrl+C group
 * broadcast) — neither is board-sent. A board would have to send SIGTERM or
 * SIGKILL to cancel, and that leaves no marker. `exec 2>/dev/null` is required:
 * dash reports a SIGHUP'd foreground child with "Hangup\n" on stderr, and that
 * write into the board's closed pipe would raise EPIPE/SIGPIPE and kill the
 * shell before its trap could record the death signal.
 */
async function launchInflightBoard(): Promise<InflightBoardFixture> {
  const baseRoot = await mkdtemp(path.join(tmpdir(), 'parallix-2375-sc3-'));
  const fixtureRoot = path.join(baseRoot, SC3_SLUG);
  const stateRoot = path.join(baseRoot, 'state');
  const stubDir = path.join(baseRoot, 'stubs');
  const markerPath = path.join(baseRoot, 'claude-started');
  const signalPath = `${markerPath}.signal`;
  await mkdir(fixtureRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });
  await mkdir(stubDir, { recursive: true });
  await mkdir(path.join(fixtureRoot, 'backlog', 'tasks'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'missions', SC3_SLUG), { recursive: true });
  await writeFile(path.join(fixtureRoot, 'missions', SC3_SLUG, 'MISSION.md'), `# ${SC3_SLUG}\n`);
  await writeFile(
    path.join(fixtureRoot, 'backlog', 'tasks', `${SC3_SLUG}.md`),
    ['---', `id: ${SC3_SLUG.toUpperCase()}`, 'title: In-flight shutdown fixture', 'status: active', 'assignee: []', 'labels: [ai_sdlc]', '---', ''].join('\n'),
  );
  const stub = [
    '#!/bin/sh',
    'if [ "$1" = "--help" ]; then exit 0; fi',
    `echo $$ > "${markerPath}"`,
    'exec 2>/dev/null',
    `trap 'echo SIGHUP > "${signalPath}" 2>/dev/null' HUP`,
    `trap 'echo SIGINT > "${signalPath}" 2>/dev/null' INT`,
    'sleep 300',
  ].join('\n');
  await writeFile(path.join(stubDir, 'claude'), stub, { mode: 0o755 });

  // The verify-local git compat shim (Apple Git 2.24) misparses a bare
  // `init -q -b main` (the -q is taken as the target directory), so the
  // explicit `.` target is required, matching test/task-2286-native-sea-smoke.
  await gitIn(fixtureRoot, 'init', '-q', '-b', 'main', '.');
  await gitIn(fixtureRoot, 'config', 'user.email', 'fixture@parallix.local');
  await gitIn(fixtureRoot, 'config', 'user.name', 'fixture');
  await gitIn(fixtureRoot, 'add', '-A');
  await gitIn(fixtureRoot, 'commit', '-q', '-m', 'init');
  await gitIn(fixtureRoot, 'checkout', '-q', '-b', `mission/${SC3_SLUG}`);
  await seedInflightMission(fixtureRoot, stateRoot);

  const session = await launchPtySmoke([process.execPath, path.join(root, 'build/px.mjs'), 'ui'], {
    cwd: fixtureRoot,
    timeoutMs: LAUNCH_TIMEOUT_MS,
    env: {
      ...process.env,
      PARALLIX_HOME: stateRoot,
      PRIMARY_WORKTREE: fixtureRoot,
      WORKFLOW_AGENT: 'claude',
      PARALLIX_NO_BUBBLEWRAP: '1',
      PATH: `${stubDir}:${process.env.PATH}`,
    },
  });
  const fixture: InflightBoardFixture = {
    session,
    markerPath,
    signalPath,
    childPid: null,
    dispose: async () => {
      if (session.isAlive()) {
        try { session.signal('SIGKILL'); } catch { /* already gone */ }
      }
      if (fixture.childPid !== null && pidAlive(fixture.childPid)) {
        try { process.kill(fixture.childPid, 'SIGKILL'); } catch { /* already gone */ }
      }
      await session.cleanup();
      await rm(baseRoot, { recursive: true, force: true });
    },
  };
  await waitForOutput(session, /px board/, LAUNCH_TIMEOUT_MS, 'the real board must render before dispatch is exercised');
  return fixture;
}

/**
 * Arm and confirm the focused mission's action, then wait (bounded) until the
 * stub agent's start marker proves the dispatched child process is running.
 * This is the explicit started synchronization the mission requires — a
 * failure here means nothing was in flight when the quit key was sent.
 */
async function dispatchAndAwaitStart(fixture: InflightBoardFixture): Promise<void> {
  const { session } = fixture;
  session.send('\r');
  await waitForOutput(session, /CONFIRM CONSEQUENTIAL ACTION/, SHUTDOWN_BUDGET_MS, 'Enter must arm the confirmation dialog');
  session.send('\r'); // confirm — the dispatch is fire-and-forget
  const deadline = Date.now() + DISPATCH_START_BUDGET_MS;
  while (!existsSync(fixture.markerPath)) {
    if (!session.isAlive() || Date.now() >= deadline) { break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    existsSync(fixture.markerPath),
    `the dispatched action must be demonstrably in flight before quit (start marker; board alive=${session.isAlive()})`,
  );
  const childPid = Number(readFileSync(fixture.markerPath, 'utf8').trim());
  assert.ok(Number.isInteger(childPid) && childPid > 1, 'the start marker must carry the child pid');
  assert.ok(pidAlive(childPid), 'the in-flight child must be alive when the quit key is sent');
  fixture.childPid = childPid;
}

/**
 * Send the quit key and prove the shutdown outcome and the ownership rule:
 * the board PID is gone within the bounded budget, the terminal is restored,
 * and the in-flight child is reaped by a terminal-level signal (OS SIGHUP on
 * session teardown, or the Ctrl+C group broadcast) rather than cancelled by a
 * board-sent signal — fire-and-forget detach, no board-owned resource left
 * behind.
 */
async function assertInflightTermination(fixture: InflightBoardFixture, key: string, description: string): Promise<void> {
  const { session } = fixture;
  const pid = session.pid;
  session.send(key);
  const exitCode = await session.waitForExit(SHUTDOWN_BUDGET_MS);
  assert.ok(
    session.processGone(),
    `${description}: board pid ${pid} must no longer exist within ${SHUTDOWN_BUDGET_MS} ms of the key (exit code ${exitCode})`,
  );
  assert.equal(await session.terminalRestored(), true, `${description}: terminal raw-mode state must be restored`);

  const reapDeadline = Date.now() + REAP_BUDGET_MS;
  while (fixture.childPid !== null && pidAlive(fixture.childPid) && Date.now() < reapDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(
    fixture.childPid === null || !pidAlive(fixture.childPid),
    `${description}: in-flight child (pid ${fixture.childPid}) must be reaped after board exit — no board-owned handle left behind`,
  );
  const signalDeadline = Date.now() + REAP_BUDGET_MS;
  while (!existsSync(fixture.signalPath) && Date.now() < signalDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(
    existsSync(fixture.signalPath),
    `${description}: the child's death must be a terminal-level signal (OS SIGHUP or the Ctrl+C group broadcast), not a board-sent signal`,
  );
  const recorded = readFileSync(fixture.signalPath, 'utf8').trim();
  assert.ok(recorded === 'SIGHUP' || recorded === 'SIGINT', `${description}: recorded death signal must be SIGHUP or SIGINT, got "${recorded}"`);
}

test('TASK-2375 SC3: q terminates the real board while a dispatched action is demonstrably in flight', async () => {
  const fixture = await launchInflightBoard();
  try {
    await dispatchAndAwaitStart(fixture);
    await assertInflightTermination(fixture, 'q', 'q with in-flight action');
  } finally {
    await fixture.dispose();
  }
});

test('TASK-2375 SC3: Ctrl+C terminates the real board while a dispatched action is demonstrably in flight', async () => {
  const fixture = await launchInflightBoard();
  try {
    await dispatchAndAwaitStart(fixture);
    await assertInflightTermination(fixture, '\u0003', 'Ctrl+C with in-flight action');
  } finally {
    await fixture.dispose();
  }
});

test('TASK-2375 SC3: repeated in-flight dispatch-quit cycles leave no board or child PID behind', async () => {
  for (let index = 0; index < 3; index += 1) {
    const fixture = await launchInflightBoard();
    try {
      await dispatchAndAwaitStart(fixture);
      await assertInflightTermination(fixture, 'q', `in-flight dispatch-quit cycle ${index + 1}`);
    } finally {
      await fixture.dispose();
    }
  }
});
