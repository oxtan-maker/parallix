import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('archived cited-path diff uses nine-character blob identities and pinned source (TASK-2716)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'px-archived-evidence-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'cited.ts'), 'old\n'); writeFileSync(join(repo, 'unrelated.ts'), 'old\n');
    git('add', '-A'); git('commit', '-q', '-m', 'before'); const before = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'cited.ts'), 'fixed\n'); writeFileSync(join(repo, 'unrelated.ts'), 'unrelated change\n');
    git('add', '-A'); git('commit', '-q', '-m', 'after'); const after = git('rev-parse', 'HEAD');
    const evidence = new GitReviewEvidence(repo);
    const diff = await evidence.diff(before, after, ['cited.ts']);
    assert.match(diff, /^index [a-f0-9]{9}\.\.[a-f0-9]{9}/m);
    assert.doesNotMatch(diff, /unrelated/);
    writeFileSync(join(repo, 'cited.ts'), 'mutable working tree\n');
    assert.equal(await evidence.source(after, 'cited.ts'), 'fixed\n');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('mission interdiff attributes spaced paths without preceding-file leakage (TASK-2732)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'px-space-evidence-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    writeFileSync(join(repo, 'a.ts'), 'old\n'); writeFileSync(join(repo, 'task with spaces.md'), 'old\n');
    git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'a.ts'), 'mission\n'); writeFileSync(join(repo, 'task with spaces.md'), 'mission\n');
    git('add', '-A'); git('commit', '-qm', 'prior'); const prior = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'task with spaces.md'), 'repaired\n');
    git('add', '-A'); git('commit', '-qm', 'repair'); const candidate = git('rev-parse', 'HEAD');
    const result = await new GitReviewEvidence(repo).missionInterdiff({ baseline: base, revision: prior }, { baseline: base, revision: candidate });
    assert.deepEqual(result.paths, ['task with spaces.md']);
    assert.match(result.diff, /task with spaces.md\t\+repaired/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('rebased main fix is retained as failure-path provenance (TASK-2732)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'px-main-fix-evidence-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'failure.ts'), 'broken\n'); writeFileSync(join(repo, 'mission.ts'), 'base\n');
    git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'mission');
    writeFileSync(join(repo, 'mission.ts'), 'mission\n'); git('add', '-A'); git('commit', '-qm', 'prior'); const prior = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    writeFileSync(join(repo, 'failure.ts'), 'fixed-by-main\n'); git('add', '-A'); git('commit', '-qm', 'main fix'); const main = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'mission'); git('rebase', '-q', 'main'); const candidate = git('rev-parse', 'HEAD');
    const evidence = new GitReviewEvidence(repo);
    const { buildArchivedEvidencePacket } = await import('../../../src/application/review-classification/archived-packing.js');
    const packet = await buildArchivedEvidencePacket({
      priorRevision: prior, candidateRevision: candidate,
      missionRange: { approved: { baseline: base, revision: prior }, candidate: { baseline: main, revision: candidate } },
      findings: [{ id: 'F1', summary: 'failure.ts remains broken', location: 'failure.ts:1' }],
      priorReviewComment: 'Fix failure.ts', implementerResponse: 'Main fixed it',
    }, evidence, () => ({ requestBytes: 1, maxRequestBytes: 1, inputTokens: 1, maxInputTokens: 1, contextTokens: 1, maxContextTokens: 1, tokenizerModel: 'stub' }));
    const state = packet.request.state as { diff: string; mainCommits: { revision: string; paths: string[]; diff: string }[] };
    assert.doesNotMatch(state.diff, /fixed-by-main/);
    assert.equal(state.mainCommits.length, 1);
    assert.equal(state.mainCommits[0].revision, main);
    assert.deepEqual(state.mainCommits[0].paths, ['failure.ts']);
    assert.match(state.mainCommits[0].diff, /fixed-by-main/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

import { GitMissionPatchComparison } from '../../../src/adapters/review/mission-patch-comparison.js';

test('approval patch equality survives rebases and spaced bookkeeping but retains manifest edits (TASK-2734)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'px-restore-patch-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
    const commit = (file: string, text: string, message: string) => { writeFileSync(join(repo, file), text); git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
    git('init', '-q', '-b', 'main');
    const pkg = { name: 'fixture', version: '1.2.3' };
    const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
    const base = commit('package.json', json(pkg), 'base');
    git('checkout', '-qb', 'mission');
    const approved = commit('file with spaces.txt', 'approved\n', 'feature');
    const comparison = new GitMissionPatchComparison(repo);
    assert.equal(await comparison.samePatch({ baseline: base, revision: approved }, { baseline: base, revision: approved }), true);
    git('checkout', '-q', 'main');
    const advanced = commit('main.txt', 'main only\n', 'advance');
    git('checkout', '-q', 'mission'); git('rebase', '-q', 'main');
    const rebased = git('rev-parse', 'HEAD');
    mkdirSync(join(repo, 'backlog', 'tasks'), { recursive: true });
    commit('backlog/tasks/task with spaces.md', 'lane transition\n', 'bookkeeping');
    assert.equal(await comparison.samePatch({ baseline: base, revision: approved }, { baseline: advanced, revision: git('rev-parse', 'HEAD') }), true);
    assert.notEqual(git('rev-parse', 'HEAD'), rebased);
    const bumped = commit('package.json', json({ ...pkg, version: '1.2.4' }), 'hook\n\nParallix-Bookkeeping: pre-commit-hook');
    assert.equal(await comparison.samePatch({ baseline: base, revision: approved }, { baseline: advanced, revision: bumped }), true);
    const changed = commit('package.json', json({ ...pkg, version: '1.2.4', scripts: { test: 'false' } }), 'config edit');
    assert.equal(await comparison.samePatch({ baseline: base, revision: approved }, { baseline: advanced, revision: changed }), false);
    const spaceChanged = commit('file with spaces.txt', 'repair\n', 'repair');
    assert.equal(await comparison.samePatch({ baseline: advanced, revision: changed }, { baseline: advanced, revision: spaceChanged }), false);
    await assert.rejects(comparison.samePatch({ baseline: base, revision: approved }, { baseline: 'f'.repeat(40), revision: spaceChanged }));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('release exception preserves approved manifest edits and rejects ordinary version edits (TASK-2734)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'px-release-boundary-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
    const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
    const commit = (value: unknown, message: string) => { writeFileSync(join(repo, 'package.json'), json(value)); git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
    git('init', '-q', '-b', 'main');
    const pkg = { name: 'fixture', version: '1.2.3', scripts: { test: 'test' } };
    const base = commit(pkg, 'base');
    const mission = { ...pkg, scripts: { test: 'npm test' } };
    const approved = commit(mission, 'approved mission config');
    const bumped = commit({ ...mission, version: '1.2.4' }, 'hook\n\nParallix-Bookkeeping: pre-commit-hook');
    const compare = new GitMissionPatchComparison(repo);
    assert.equal(await compare.samePatch({ baseline: base, revision: approved }, { baseline: base, revision: bumped }), true);
    const ordinary = commit({ ...mission, version: '1.2.5' }, 'ordinary version edit');
    assert.equal(await compare.samePatch({ baseline: base, revision: approved }, { baseline: base, revision: ordinary }), false);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});


test('weakening packets retain actual historical main baselines after rewritten main (TASK-2754)', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'px-rewritten-main-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
    const commit = (file: string, text: string) => { writeFileSync(join(repo, file), text); git('add', '-A'); git('commit', '-qm', file); return git('rev-parse', 'HEAD'); };
    git('init', '-q', '-b', 'main');
    const root = commit('check.ts', 'assert(true);\n');
    const oldMain = commit('main.ts', 'original main\n');
    git('checkout', '-qb', 'mission');
    const approved = commit('check.ts', 'assert(true);\n// approved fixture\n');
    git('checkout', '-q', 'main'); git('reset', '--hard', root);
    const newMain = commit('main.ts', 'rewritten main\n');
    git('checkout', '-q', 'mission'); git('rebase', '--onto', newMain, oldMain);
    const candidate = commit('check.ts', 'assert(true);\n// approved fixture\n// isolated cleanup\n');
    const evidence = new GitReviewEvidence(repo);
    assert.equal(await evidence.mergeBase(approved, 'main'), root);
    const { buildWeakeningPacket } = await import('../../../src/application/review-classification/weakening-packet.js');
    const request = await buildWeakeningPacket({ gate: 'unit', log: 'failed cleanup',
      approved: { baseline: oldMain, revision: approved }, candidate: { baseline: newMain, revision: candidate } },
      evidence, () => ({ inputTokens: 1, contextTokens: 1, maxInputTokens: 64000, maxContextTokens: 64000,
        requestBytes: 1, maxRequestBytes: 1000000, tokenizerModel: 'stub' }));
    const state = request.state as { rebase: { approvedBaseline: string; candidateBaseline: string }; changedPaths: string[]; repairDiff: string };
    assert.equal(state.rebase.approvedBaseline, oldMain);
    assert.equal(state.rebase.candidateBaseline, newMain);
    assert.deepEqual(state.changedPaths, ['check.ts']);
    assert.doesNotMatch(state.repairDiff, /rewritten main|original main/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
