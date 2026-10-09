import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitReviewEvidence } from '../../../src/adapters/review/review-evidence.js';

// Real git: the mission interdiff never contains changes made only on the primary branch.
test('mission interdiff excludes main-only commits and reports rebase-shifted mission changes (TASK-2704)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'px-evidence-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
    const commit = (file: string, text: string, message: string) => { writeFileSync(join(repo, file), text); git('add', '-A'); git('commit', '-q', '-m', message); return git('rev-parse', 'HEAD'); };
    git('init', '-q', '-b', 'main');
    const base = commit('feature.ts', 'one\ntwo\nthree\n', 'base');
    git('checkout', '-q', '-b', 'mission');
    const approved = commit('feature.ts', 'one\ntwo\nthree\nmission\n', 'mission change');
    git('checkout', '-q', 'main');
    const advanced = commit('unrelated.ts', 'main only\n'.repeat(500), 'main advances');
    git('checkout', '-q', 'mission');
    git('rebase', '-q', 'main');
    writeFileSync(join(repo, 'feature.ts'), 'one\ntwo\nthree\nmission\nrepair\n'); git('add', '-A'); git('commit', '-q', '-m', 'repair');
    const candidate = git('rev-parse', 'HEAD');
    const evidence = new GitReviewEvidence(repo);
    const twoDot = await evidence.diff(approved, candidate, []);
    assert.match(twoDot, /unrelated\.ts/, 'the plain range is polluted by main');
    const interdiff = await evidence.missionInterdiff({ baseline: base, revision: approved }, { baseline: advanced, revision: candidate });
    assert.doesNotMatch(interdiff.diff, /main only/);
    assert.match(interdiff.diff, /\+\+?\+?repair|\+repair/);
    assert.deepEqual(interdiff.paths, ['feature.ts']);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
