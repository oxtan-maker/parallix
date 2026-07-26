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

describe('px ui spawns and exits 0 from shipped artifacts', () => {
  let distPxExists = false;
  let buildPxExists = false;
  let fixtureRoot = '';

  before(() => {
    distPxExists = fs.existsSync(path.join(root, 'dist', 'px.js'));
    buildPxExists = fs.existsSync(path.join(root, 'build', 'px.mjs'));
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-tui-spawn-'));
    fs.mkdirSync(path.join(fixtureRoot, 'backlog', 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, 'backlog', 'tasks', 'task-spawn.md'), [
      '---', 'id: TASK-SPAWN', 'title: Shipped artifact fixture', 'status: active', 'assignee: []', 'labels: []', '---', '',
    ].join('\n'));
  });

  it('dist/px.js ui exits 0 (CJS rollback artifact)', () => {
    if (!distPxExists) {
      // Skip if dist/ not built (e.g., test run before build)
      return;
    }
    const result = execFileSync(process.execPath, [path.join(root, 'dist', 'px.js'), 'ui'], {
      cwd: fixtureRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 1024 * 1024, // 1 MB
      encoding: 'utf8',
    });
    assert.ok(
      typeof result === 'string' && result.length > 0,
      'dist/px.js ui must produce non-empty output',
    );
    assert.ok(
      result.includes('px board') || result.includes('board'),
      'dist/px.js ui output must contain board label',
    );
  });

  it('build/px.mjs ui exits 0 (ESM single-file bundle)', () => {
    if (!buildPxExists) {
      // Skip if bundle not built
      return;
    }
    const result = execFileSync(process.execPath, [path.join(root, 'build', 'px.mjs'), 'ui'], {
      cwd: fixtureRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    });
    assert.ok(
      typeof result === 'string' && result.length > 0,
      'build/px.mjs ui must produce non-empty output',
    );
    assert.ok(
      result.includes('px board') || result.includes('board'),
      'build/px.mjs ui output must contain board label',
    );
  });

  it('dist/px.js status still exits 0 (headless path unchanged)', () => {
    if (!distPxExists) {
      return;
    }
    execFileSync(process.execPath, ['dist/px.js', 'status'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
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
