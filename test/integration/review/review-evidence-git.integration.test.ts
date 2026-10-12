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
