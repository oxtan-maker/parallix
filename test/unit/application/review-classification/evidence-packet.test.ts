import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePacket, resolveEvidencePath, sourceWindows } from '../../../../src/application/review-classification/evidence-packet.js';
import type { RepeatFindingEvidence, ReviewEvidencePort } from '../../../../src/application/ports/review-evidence.js';

// New boundary: language-neutral packet assembly; review-loop tests own routing effects.
const input: RepeatFindingEvidence = {
  priorRevision: 'a'.repeat(40), candidateRevision: 'b'.repeat(40),
  findings: [{ id: 'F1', summary: 'x.java:1 drops output', location: 'x.java:1' }],
  priorReviewComment: 'Fix `lib/x.java` preserving required output.', implementerResponse: 'Fixed F1 in x.java',
  resolvedFindingIds: ['F1'],
};
const repository: ReviewEvidencePort = {
  tree: async () => ['lib/x.java'], source: async () => 'return output;\n',
  diff: async () => '+++ b/lib/x.java\n@@ -1 +1 @@\n-return null;\n+return output;\n',
};

test('mechanical evidence resolves unique basenames across languages without substitution (TASK-2658)', () => {
  for (const extension of ['java', 'cpp', 'py', 'rs', 'sh']) {
    assert.equal(resolveEvidencePath(`x.${extension}`, [`lib/x.${extension}`]), `lib/x.${extension}`);
  }
  assert.equal(resolveEvidencePath('x.java', ['a/x.java', 'b/x.java']), null);
  assert.equal(resolveEvidencePath('x.js', ['x.ts']), null);
});

test('packet retains actual review and response with complete cited files at pinned revisions', async () => {
  const reads: string[] = [];
  const packet = await buildEvidencePacket(input, { ...repository, source: async (revision, path) => {
    reads.push(`${revision}:${path}`); return 'return output;\n';
  } });
  assert.ok('request' in packet);
  assert.deepEqual(reads, [`${input.candidateRevision}:lib/x.java`]);
  const state = packet.request.state as Record<string, unknown>;
  assert.equal(state.priorReviewComment, input.priorReviewComment);
  assert.equal(state.implementerResponse, input.implementerResponse);
  assert.match(JSON.stringify(state.candidateSourceExcerpts), /return output/);
});

test('partial findings, missing revisions and unresolved references fall back', async () => {
  for (const mutation of [{ resolvedFindingIds: [] }, { priorRevision: 'HEAD' }, { implementerResponse: '' }]) {
    assert.deepEqual(await buildEvidencePacket({ ...input, ...mutation }, repository), { fallback: 'incomplete-evidence' });
  }
  assert.deepEqual(await buildEvidencePacket(input, { ...repository, tree: async () => ['a/x.java', 'b/x.java'] }),
    { fallback: 'missing-or-ambiguous-path' });
  assert.deepEqual(await buildEvidencePacket(input, { ...repository, source: async () => { throw new Error('missing'); } }),
    { fallback: 'repository-read-failed' });
});

test('bounded windows disclose omissions and do not claim resolved dependencies', () => {
  const source = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}\n`).join('');
  const result = sourceWindows(source, [400], [], []);
  assert.deepEqual(result.excerpts.map(e => [e.startLine, e.endLine]), [[370, 430]]);
  assert.deepEqual(result.omissions, ['Omitted lines 1-369', 'Omitted lines 431-1000']);
  assert.match(result.excerpts[0].boundary!, /no complete-function claim/);
});

test('absolute citations resolve only inside the supplied worktree and retain line hints', async () => {
  const source = Array.from({ length: 1000 }, (_, i) => `line ${i + 1} ${'x'.repeat(200)}\n`).join('');
  const absolute = { ...input, findings: [{ id: 'F1', summary: 'drops output', location: '/repo/mission/lib/x.java:400' }],
    priorReviewComment: 'at runSmoke (/repo/mission/lib/x.java:400:14)', implementerResponse: 'Fixed F1' };
  const port = { ...repository, source: async () => source, diff: async () => '' };
  const packet = await buildEvidencePacket(absolute, port, '/repo/mission/');
  assert.ok('request' in packet);
  assert.deepEqual(packet.paths, ['lib/x.java']);
  assert.match(JSON.stringify(packet.request.state), /"startLine":370,"endLine":430/);
  assert.equal((packet.request.state as Record<string, unknown>).priorReviewComment, absolute.priorReviewComment);
  const fileUrl = { ...absolute, findings: [{ ...absolute.findings[0], location: `file://${absolute.findings[0].location}` }],
    priorReviewComment: 'at file:///repo/mission/lib/x.java:400:14' };
  const urlPacket = await buildEvidencePacket(fileUrl, port, '/repo/mission');
  assert.ok('request' in urlPacket);
  assert.deepEqual(urlPacket.paths, ['lib/x.java']);
  assert.match(JSON.stringify(urlPacket.request.state), /"startLine":370,"endLine":430/);
  for (const root of [undefined, '/foreign/mission', '/repo/miss']) {
    assert.deepEqual(await buildEvidencePacket(absolute, port, root), { fallback: 'missing-or-ambiguous-path' });
  }
});

test('source windows retain every line boundary without regex backtracking', () => {
  const result = sourceWindows('first\nsecond\nthird', [], [], []);
  assert.deepEqual(result.excerpts, [{ startLine: 1, endLine: 3, text: 'first\nsecond\nthird' }]);
});

test('oversized evidence and no structural windows retain normal-review fallback', async () => {
  assert.deepEqual(await buildEvidencePacket({ ...input, priorReviewComment: 'lib/x.java '.repeat(20000) }, repository), { fallback: 'oversize' });
  const uncited = { ...input, findings: [{ id: 'F1', summary: 'x.java fails', location: null }], priorReviewComment: 'Fix lib/x.java', implementerResponse: 'Fixed F1' };
  const result = await buildEvidencePacket(uncited, { ...repository, diff: async () => '', source: async () => 'x'.repeat(100000) });
  assert.deepEqual(result, { fallback: 'no-structural-excerpts' });
});

test('selected-choice routing retains fixed resolved and unresolved boundaries', async () => {
  const { classifyRepeatFindings } = await import('../../../../src/application/review-classification/routing-policy.js');
  const route = (selected: string, score: number) => classifyRepeatFindings({
    provider: 'test', model: 'test', answers: { resolution: {
      type: 'choice', selected, probabilities: { [selected]: score }, confidence: 1,
    } },
  });
  assert.equal(route('addresses', 0.52).route, 'clear');
  assert.equal(route('addresses', 0.519).route, 'reviewer');
  assert.equal(route('does_not_address', 0.89).route, 'implementer');
  assert.equal(route('does_not_address', 0.889).route, 'reviewer');
  assert.equal(route('does_not_address', 0.88).route, 'reviewer', 'TASK-2641 F2 recorded incorrect return remains screened');
  assert.equal(route('does_not_address', 0.8).route, 'reviewer', 'TASK-2580 F4 recorded incorrect return remains screened');
  assert.equal(route('addresses', 0.51).route, 'reviewer', 'TASK-2544 borderline incorrect clear is screened');
  assert.equal(route('does_not_address', 0.89).route, 'implementer', 'TASK-2580 unresolved signal is retained');
  assert.equal(route('insufficient_evidence', 1).route, 'reviewer');
  assert.equal(route('addresses', Number.NaN).route, 'reviewer');
});

test('both known TASK-2599 safety failures retain reviewer escalation at frozen thresholds', async () => {
  const { classifyRepeatFindings } = await import('../../../../src/application/review-classification/routing-policy.js');
  // Frozen complete-files responses: archive request hashes 7c2d5273… and 88321026….
  // These lock interpretation of the real safety signals, not model determinism.
  for (const probabilities of [
    { addresses: 0.24, insufficient_evidence: 0.73, does_not_address: 0.03 },
    { addresses: 0.37, insufficient_evidence: 0.62, does_not_address: 0.01 },
  ]) {
    assert.equal(classifyRepeatFindings({ provider: 'openrouter', model: 'typesafe/jev-1.13-20260917', answers: {
      resolution: { type: 'choice', selected: 'insufficient_evidence', probabilities, confidence: 0.59 },
    } }).route, 'reviewer');
  }
});

test('new intent obligations cannot hide behind task status bookkeeping (TASK-2658)', async () => {
  const { hasBroaderReviewObligations } = await import('../../../../src/application/review-classification/routing-policy.js');
  const diff = 'diff --git a/x.java b/x.java\n--- a/x.java\n+++ b/x.java\n@@ -1 +1 @@\n-old\n+fixed\n'
    + 'diff --git a/intent.md b/intent.md\n--- a/intent.md\n+++ b/intent.md\n@@ -3 +3 @@\n';
  assert.equal(hasBroaderReviewObligations(diff + '-status: active\n+status: review\n', ['x.java'], 'intent.md'), false);
  assert.equal(hasBroaderReviewObligations(diff + '-old criterion\n+new requirement\n', ['x.java'], 'intent.md'), true);
  assert.equal(hasBroaderReviewObligations(diff + '-status: active\n+status: review\n', ['x.java']), true);
});

test('Git tab-terminated headers preserve status-only task mirrors with spaces', async () => {
  const { hasBroaderReviewObligations } = await import('../../../../src/application/review-classification/routing-policy.js');
  const mirror = 'backlog/tasks/task-9001 - Classifier-lifecycle.md';
  const diff = `diff --git a/x.java b/x.java\n--- a/x.java\n+++ b/x.java\n@@ -1 +1 @@\n-old\n+fixed\n`
    + `diff --git a/${mirror} b/${mirror}\n--- a/${mirror}\t\n+++ b/${mirror}\t\n@@ -1 +1 @@\n`;
  assert.equal(hasBroaderReviewObligations(diff + '-status: active\n+status: review\n', ['x.java'], mirror), false);
  assert.equal(hasBroaderReviewObligations(diff + '-old criterion\n+new requirement\n', ['x.java'], mirror), true);
});
