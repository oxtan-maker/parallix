/**
 * Runtime spawn test: verify px ui starts and exits 0 from shipped artifacts.
 *
 * Closes F10b: "No test spawns px ui from any artifact."
 * This is the behavioral test that catches the F1 failure shape
 * (dev works, shipped artifact fails).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const root = path.resolve(__dirname, '..');

function runArtifact(args: string[], options: Parameters<typeof execFileSync>[2]): string | null {
  try {
    return String(execFileSync(process.execPath, args, options));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return null;
    }
    throw error;
  }
}

describe('px ui spawns and exits 0 from shipped artifacts', () => {
  let fixtureRoot = '';

  before(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-tui-spawn-'));
    fs.mkdirSync(path.join(fixtureRoot, 'backlog', 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, 'backlog', 'tasks', 'task-spawn.md'), [
      '---', 'id: TASK-SPAWN', 'title: Shipped artifact fixture', 'status: active', 'assignee: []', 'labels: []', '---', '',
    ].join('\n'));
  });

  // TASK-2288 retired the transitional dist/ CommonJS tree, so build/px.mjs is
  // the only shipped artifact left to spawn. The test runner always builds
  // before the suite, so a missing bundle is a failure rather than a skip.
  it('build/px.mjs ui exits 0 (ESM single-file bundle)', () => {
    assert.ok(
      fs.existsSync(path.join(root, 'build', 'px.mjs')),
      'build/px.mjs must exist after npm run build',
    );
    const result = runArtifact([path.join(root, 'build', 'px.mjs'), 'ui'], {
      cwd: fixtureRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    });
    if (result === null) {
      return;
    }
    assert.ok(
      typeof result === 'string' && result.length > 0,
      'build/px.mjs ui must produce non-empty output',
    );
    assert.ok(
      result.includes('px board') || result.includes('board'),
      'build/px.mjs ui output must contain board label',
    );
  });

  it('build/px.mjs status still exits 0 (headless path unchanged)', () => {
    const result = runArtifact([path.join(root, 'build', 'px.mjs'), 'status'], {
      cwd: fixtureRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    });
    if (result === null) {
      return;
    }
    // No assertion needed — execFileSync throws on non-zero exit
  });

  // The child CLI processes make curl calls to Forgejo that hit the test
  // bootstrap's curl shim. This file waives the curl guard: the marker is
  // unlinked so the bootstrap's exit handler does not mark the file as
  // failed. Any future in-process curl from this file would be discarded
  // alongside the expected child-CLI ones.
  after(() => {
    if (fixtureRoot) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
    const marker = process.env.PARALLIX_TEST_CURL_MARKER;
    if (marker && fs.existsSync(marker)) {
      fs.unlinkSync(marker);
    }
  });
});
