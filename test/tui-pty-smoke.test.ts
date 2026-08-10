import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { launchPtySmoke } from './helpers/pty-smoke-harness.js';

const root = process.cwd();
const TIMEOUT_MS = 12_000;
// The integration suite runs test files on concurrent workers, so booting the
// real bundled CLI inside the PTY competes for CPU. Wait against the session
// timeout budget rather than a short fixed delay, and fail fast if the child
// dies instead of burning the whole budget.
const RENDER_TIMEOUT_MS = TIMEOUT_MS;
const INTERACTION_TIMEOUT_MS = 4_000;
const ANSI =/\u001b\[[0-9;?]*[ -/]*[@-~]/g;
function plain(output: string): string { return output.replace(ANSI, ''); }

async function waitForOutput(
  session: { readonly output: () => string; readonly isAlive: () => boolean },
  pattern: RegExp,
  milliseconds: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (!pattern.test(plain(session.output()))) {
    if (!session.isAlive() || Date.now() >= deadline) { break; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const output = plain(session.output());
  assert.match(output, pattern, `${message} (alive=${session.isAlive()}; output: ${JSON.stringify(output)})`);
}

test('real PTY smoke: launch, keyboard navigation, resize, clean exit, timeout bound, and terminal restoration', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'parallix-pty-ui-fixture-'));
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'parallix-pty-ui-state-'));
  try {
    await mkdir(path.join(fixtureRoot, 'backlog', 'tasks'), { recursive: true });
    await writeFile(path.join(fixtureRoot, 'backlog', 'tasks', 'task-pty-1.md'), [
      '---', 'id: TASK-PTY', 'title: PTY smoke mission', 'status: active', 'assignee: []', 'labels: []', '---', '',
    ].join('\n'));
    await writeFile(path.join(fixtureRoot, 'backlog', 'tasks', 'task-pty-2.md'), [
      '---', 'id: TASK-PTY-2', 'title: PTY second mission', 'status: active', 'assignee: []', 'labels: []', '---', '',
    ].join('\n'));
    const session = await launchPtySmoke([process.execPath, path.join(root, 'build/px.mjs'), 'ui'], {
      cwd: fixtureRoot,
      timeoutMs: TIMEOUT_MS,
      // The fixture reuses stable task ids. Give the real child a dedicated
      // SQLite home so another PTY fixture cannot make its import conflict.
      env: { ...process.env, PARALLIX_HOME: stateRoot },
    });
    await waitForOutput(session, /px board/, RENDER_TIMEOUT_MS, 'real PTY must render the Ink board after launch');
    assert.match(plain(session.output()), /pty/i, 'real PTY must render the selectable fixture mission');
    session.send('\r');
    await waitForOutput(session, /CONFIRM CONSEQUENTIAL ACTION/, INTERACTION_TIMEOUT_MS, 'Enter must show guarded confirmation without launching an agent');
    session.send('\u001b');
    await waitForOutput(session, /CANCELLED: cancelled before dispatch/, INTERACTION_TIMEOUT_MS, 'Escape must cancel before controller dispatch');
    session.send('\u001b[B');
    await waitForOutput(session, /▶.*PTY second/si, INTERACTION_TIMEOUT_MS, 'down arrow must move real-PTY focus to the second mission');
    await session.resize(60, 20);
    assert.equal(session.isAlive(), true, 'UI must remain alive until q is sent');
    const result = await session.exitCleanly();
    assert.equal(result.exitCode, 0, 'q must cleanly exit the real UI process');
    assert.equal(result.terminalRestored, true, 'Ink raw-mode cleanup must restore PTY terminal state');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test('PTY smoke harness: has no agent, Forgejo, repository-write, or network capability', () => {
  const source = fs.readFileSync(path.join(root, 'test/helpers/pty-smoke-harness.ts'), 'utf8');
  assert.doesNotMatch(source, /from 'node:(?:net|http|https)'|spawn\(['"](?:git|curl|ssh)|fetch\(|https?:\/\/|writeFile|appendFile|git (?:commit|push)/i);
  assert.match(source, /tmpdir\(\)/, 'harness metadata must be isolated in the OS temporary directory');
});
