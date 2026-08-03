import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { launchPtySmoke } from './helpers/pty-smoke-harness.js';

const root = process.cwd();
const TIMEOUT_MS = 12_000;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
function plain(output: string): string { return output.replace(ANSI, ''); }

test('real PTY smoke: launch, keyboard navigation, resize, clean exit, timeout bound, and terminal restoration', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'parallix-pty-ui-fixture-'));
  try {
    await mkdir(path.join(fixtureRoot, 'backlog', 'tasks'), { recursive: true });
    await writeFile(path.join(fixtureRoot, 'backlog', 'tasks', 'task-pty-1.md'), [
      '---', 'id: TASK-PTY', 'title: PTY smoke mission', 'status: active', 'assignee: []', 'labels: []', '---', '',
    ].join('\n'));
    await writeFile(path.join(fixtureRoot, 'backlog', 'tasks', 'task-pty-2.md'), [
      '---', 'id: TASK-PTY-2', 'title: PTY second mission', 'status: active', 'assignee: []', 'labels: []', '---', '',
    ].join('\n'));
    const session = await launchPtySmoke([process.execPath, path.join(root, 'build/px.mjs'), 'ui'], { cwd: fixtureRoot, timeoutMs: TIMEOUT_MS });
    const deadline = Date.now() + 4_000;
    while (!/px board/.test(plain(session.output())) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.match(plain(session.output()), /px board/, 'real PTY must render the Ink board after launch');
    assert.match(plain(session.output()), /pty/i, 'real PTY must render the selectable fixture mission');
    session.send('\r');
    const confirmationDeadline = Date.now() + 2_000;
    while (!/CONFIRM CONSEQUENTIAL ACTION/.test(plain(session.output())) && Date.now() < confirmationDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.match(plain(session.output()), /CONFIRM CONSEQUENTIAL ACTION/, 'Enter must show guarded confirmation without launching an agent');
    session.send('\u001b');
    const cancellationDeadline = Date.now() + 2_000;
    while (!/CANCELLED: cancelled before dispatch/.test(plain(session.output())) && Date.now() < cancellationDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.match(plain(session.output()), /CANCELLED: cancelled before dispatch/, 'Escape must cancel before controller dispatch');
    session.send('\u001b[B');
    const focusDeadline = Date.now() + 2_000;
    while (!/▶.*PTY second/si.test(plain(session.output())) && Date.now() < focusDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.match(plain(session.output()), /▶.*PTY second/si, 'down arrow must move real-PTY focus to the second mission');
    await session.resize(60, 20);
    assert.equal(session.isAlive(), true, 'UI must remain alive until q is sent');
    const result = await session.exitCleanly();
    assert.equal(result.exitCode, 0, 'q must cleanly exit the real UI process');
    assert.equal(result.terminalRestored, true, 'Ink raw-mode cleanup must restore PTY terminal state');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('PTY smoke harness: has no agent, Forgejo, repository-write, or network capability', () => {
  const source = fs.readFileSync(path.join(root, 'test/helpers/pty-smoke-harness.ts'), 'utf8');
  assert.doesNotMatch(source, /from 'node:(?:net|http|https)'|spawn\(['"](?:git|curl|ssh)|fetch\(|https?:\/\/|writeFile|appendFile|git (?:commit|push)/i);
  assert.match(source, /tmpdir\(\)/, 'harness metadata must be isolated in the OS temporary directory');
});
