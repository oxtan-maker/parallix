import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePacket as buildPacket, resolveEvidencePath, sourceWindows, MAX_PACKET_BYTES, type MeasureRequest } from '../../../../src/application/review-classification/evidence-packet.js';
import type { DecisionRequest } from '../../../../src/application/ports/decision.js';
import type { ReviewFindingEvidence, ReviewEvidencePort } from '../../../../src/application/ports/review-evidence.js';

// New boundary: language-neutral packet assembly; review-loop tests own routing effects.
const input: ReviewFindingEvidence = {
  priorRevision: 'a'.repeat(40), candidateRevision: 'b'.repeat(40),
  findings: [{ id: 'F1', summary: 'x.java:1 drops output', location: 'x.java:1' }],
  priorReviewComment: 'Fix `lib/x.java` preserving required output.', implementerResponse: 'Fixed F1 in x.java',
};
const encodedBytes: MeasureRequest = request => Buffer.byteLength(JSON.stringify(request));
const buildEvidencePacket = (evidence: ReviewFindingEvidence, port: ReviewEvidencePort, worktree?: string, measure: MeasureRequest = encodedBytes) =>
  buildPacket(evidence, port, worktree, measure);
const omissionsOf = (request: DecisionRequest) => (request.state as { contextOmissions: string[] }).contextOmissions.join('\n');
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
  assert.deepEqual(reads, [`${input.candidateRevision}:lib/x.java`]);
  const state = packet.request.state as Record<string, unknown>;
  assert.equal(state.priorReviewComment, input.priorReviewComment);
  assert.equal(state.implementerResponse, input.implementerResponse);
  assert.match(JSON.stringify(state.candidateSourceExcerpts), /return output/);
});

test('thin evidence is sent with declared omissions instead of falling back (TASK-2675)', async () => {
  const empty = await buildEvidencePacket({ ...input, priorReviewComment: '', implementerResponse: '', humanFeedback: 'Also fix the null path.' }, repository);
  assert.match(omissionsOf(empty.request), /Prior review comment: none retained/);
  assert.match(omissionsOf(empty.request), /Implementer response: none retained/);
  assert.equal((empty.request.state as Record<string, unknown>).humanFeedback, 'Also fix the null path.');
  const ambiguous = await buildEvidencePacket(input, { ...repository, tree: async () => ['a/x.java', 'b/x.java'] });
  assert.match(omissionsOf(ambiguous.request), /F1: cited path x\.java is missing or ambiguous/);
  assert.match(omissionsOf(ambiguous.request), /No cited file resolved/);
  assert.deepEqual(ambiguous.paths, []);
  const unreadable = await buildEvidencePacket(input, { ...repository, source: async () => { throw new Error('missing'); } });
  assert.match(omissionsOf(unreadable.request), /lib\/x\.java: source unavailable/);
  const noRepository = await buildEvidencePacket(input, { ...repository, tree: async () => { throw new Error('offline'); } });
  assert.match(omissionsOf(noRepository.request), /Repository tree unavailable/);
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
  assert.deepEqual(packet.paths, ['lib/x.java']);
  assert.match(JSON.stringify(packet.request.state), /"startLine":370,"endLine":430/);
  assert.equal((packet.request.state as Record<string, unknown>).priorReviewComment, absolute.priorReviewComment);
  const fileUrl = { ...absolute, findings: [{ ...absolute.findings[0], location: `file://${absolute.findings[0].location}` }],
    priorReviewComment: 'at file:///repo/mission/lib/x.java:400:14' };
  const urlPacket = await buildEvidencePacket(fileUrl, port, '/repo/mission');
  assert.deepEqual(urlPacket.paths, ['lib/x.java']);
  assert.match(JSON.stringify(urlPacket.request.state), /"startLine":370,"endLine":430/);
  for (const root of [undefined, '/foreign/mission', '/repo/miss']) {
    const foreign = await buildEvidencePacket(absolute, port, root);
    assert.deepEqual(foreign.paths, []);
    assert.match(omissionsOf(foreign.request), /missing or ambiguous/);
  }
});

test('source windows retain every line boundary without regex backtracking', () => {
  const result = sourceWindows('first\nsecond\nthird', [], [], []);
  assert.deepEqual(result.excerpts, [{ startLine: 1, endLine: 3, text: 'first\nsecond\nthird' }]);
});

test('oversized evidence degrades to bounded packets that declare omissions (TASK-2675)', async () => {
  const huge = await buildEvidencePacket({ ...input, priorReviewComment: 'lib/x.java '.repeat(20000) }, repository);
  assert.match(omissionsOf(huge.request), /Prior review comment: truncated/);
  const uncited = { ...input, findings: [{ id: 'F1', summary: 'x.java fails', location: null }], priorReviewComment: 'Fix lib/x.java', implementerResponse: 'Fixed F1' };
  const result = await buildEvidencePacket(uncited, { ...repository, diff: async () => '', source: async () => 'x'.repeat(100000) });
  assert.match(omissionsOf(result.request), /lib\/x\.java:/);
  const state = result.request.state as { candidateSourceExcerpts: Record<string, unknown> };
  assert.ok(Object.keys(state.candidateSourceExcerpts).length === 0 || encodedBytes(result.request) <= MAX_PACKET_BYTES);
});

test('the last-resort packet still respects the measured budget (TASK-2675)', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `F${i}`, summary: `x.java finding ${i} ${'word '.repeat(6000)}`, location: null }));
  const packet = await buildEvidencePacket({ ...input, findings: many, priorReviewComment: 'lib/x.java', humanFeedback: 'note '.repeat(10000) },
    { ...repository, source: async () => 'x'.repeat(100000), diff: async () => '' });
  assert.ok(encodedBytes(packet.request) <= MAX_PACKET_BYTES, `${encodedBytes(packet.request)} bytes`);
  assert.match(omissionsOf(packet.request), /truncated to fit the packet budget/);
});

test('packet budget uses the measured encoded request size and degrades stepwise (TASK-2675)', async () => {
  const source = Array.from({ length: 1000 }, (_, i) => `line ${i + 1} ${'x'.repeat(40)}\n`).join('');
  const port = { ...repository, source: async () => source };
  const sizes: number[] = [];
  const everything = await buildEvidencePacket(input, port, undefined, request => { sizes.push(1); return encodedBytes(request); });
  assert.ok(sizes.length >= 1);
  const wholeFile = await buildEvidencePacket(input, port, undefined, () => 1);
  assert.match(JSON.stringify(wholeFile.request.state), /line 1000/);
  const windowed = await buildEvidencePacket(input, port, undefined, request => JSON.stringify(request).includes('line 1000 ') ? MAX_PACKET_BYTES + 1 : 1);
  assert.doesNotMatch(JSON.stringify(windowed.request.state), /line 1000 /);
  assert.match(omissionsOf(windowed.request), /Omitted lines/);
  const nothing = await buildEvidencePacket(input, port, undefined, () => MAX_PACKET_BYTES + 1);
  assert.deepEqual(nothing.paths, []);
  assert.match(omissionsOf(nothing.request), /no selectable window within the packet budget/);
  assert.match(JSON.stringify((nothing.request.state as { coverage: string }).coverage), /No source excerpts supplied/);
  assert.ok(everything.paths.length >= 1);
});

test('selected-choice routing retains fixed resolved and unresolved boundaries', async () => {
  const { classifyFindings } = await import('../../../../src/application/review-classification/routing-policy.js');
  const route = (selected: string, score: number) => classifyFindings({
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
  const { classifyFindings } = await import('../../../../src/application/review-classification/routing-policy.js');
  // Frozen complete-files responses: archive request hashes 7c2d5273… and 88321026….
  // These lock interpretation of the real safety signals, not model determinism.
  for (const probabilities of [
    { addresses: 0.24, insufficient_evidence: 0.73, does_not_address: 0.03 },
    { addresses: 0.37, insufficient_evidence: 0.62, does_not_address: 0.01 },
  ]) {
    assert.equal(classifyFindings({ provider: 'openrouter', model: 'typesafe/jev-1.13-20260917', answers: {
      resolution: { type: 'choice', selected: 'insufficient_evidence', probabilities, confidence: 0.59 },
    } }).route, 'reviewer');
  }
});

// Adapter tests own token-accounting correctness; this suite owns packing against its typed budget.
const repairBudget = (request: DecisionRequest) => {
  const bytes = Buffer.byteLength(JSON.stringify(request));
  return { requestBytes: bytes, inputTokens: bytes, contextTokens: bytes,
    maxRequestBytes: 1_000_000, maxInputTokens: 8000, maxContextTokens: 8000, tokenizerModel: 'packing-contract-double' };
};

test('repair packing preserves every hunk and includes changed files absent from the log (TASK-2692)', async () => {
  const diff = '--- a/lib/x.java\n+++ b/lib/x.java\n@@ -1 +1 @@\n-old\n+fixed\n'
    + '--- a/lib/uncited.rs\n+++ b/lib/uncited.rs\n@@ -1800 +1800 @@\n-broken\n+repaired\n';
  const reads: string[] = [];
  const packet = await buildPacket(input, {
    tree: async () => ['lib/x.java', 'lib/uncited.rs'],
    diff: async (_before, _after, paths) => { assert.deepEqual(paths, [], 'full repair range, not just cited paths'); return diff; },
    source: async (revision, path) => { reads.push(`${revision}:${path}`); return `${path} at ${revision}\n`; },
  }, undefined, encodedBytes, true, undefined, repairBudget);
  const state = packet.request.state as Record<string, unknown>;
  assert.equal(state.repairDiff, diff);
  assert.deepEqual(state.changedPaths, ['lib/uncited.rs', 'lib/x.java']);
  assert.equal(reads.length, 4, 'both pinned revisions of each changed file');
  assert.match(JSON.stringify(state.sourcePairs), /uncited\.rs/);
  assert.deepEqual(state.contextOmissions, []);
});

test('token pressure drops optional source pairs without truncating the repair diff (TASK-2692)', async () => {
  const diff = '--- a/lib/x.java\n+++ b/lib/x.java\n@@ -1900 +1900 @@\n-old\n+fixed-last-hunk\n';
  const packet = await buildPacket(input, { ...repository, diff: async () => diff,
    source: async () => 'huge optional context\n'.repeat(1000) }, undefined, encodedBytes, true, undefined, repairBudget);
  const state = packet.request.state as Record<string, unknown>;
  assert.equal(state.repairDiff, diff);
  assert.deepEqual(state.sourcePairs, []);
  assert.match(omissionsOf(packet.request), /complete source pair omitted; complete repair diff retained/);
  assert.ok(repairBudget(packet.request).contextTokens <= 8000);
});

test('mandatory repair evidence that cannot fit refuses a partial decision packet (TASK-2692)', async () => {
  await assert.rejects(buildPacket(input, { ...repository,
    diff: async () => '--- a/lib/x.java\n+++ b/lib/x.java\n+' + 'large mandatory change'.repeat(1000),
  }, undefined, encodedBytes, true, undefined, repairBudget), /Complete repair diff.*exceed/);
});

test('repair packing retains deletions, additions and explicitly cited unchanged context (TASK-2692)', async () => {
  const diff = '--- a/deleted.py\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted\n'
    + '--- /dev/null\n+++ b/added.rb\n@@ -0,0 +1 @@\n+added\n';
  const packet = await buildPacket({ ...input, findings: [{ ...input.findings[0], summary: 'x.java fails through lib/helper.c' }] }, {
    tree: async revision => revision === input.priorRevision ? ['deleted.py', 'lib/helper.c'] : ['added.rb', 'lib/helper.c'],
    source: async (_revision, path) => path, diff: async () => diff,
  }, undefined, encodedBytes, true, undefined, repairBudget);
  const pairs = (packet.request.state as { sourcePairs: { path: string; before: string | null; after: string | null }[] }).sourcePairs;
  assert.equal(pairs.find(p => p.path === 'deleted.py')?.after, null);
  assert.equal(pairs.find(p => p.path === 'added.rb')?.before, null);
  assert.ok(pairs.some(p => p.path === 'lib/helper.c'));
  assert.equal(pairs.length, 3);
});


test('repair packing keeps a complete candidate file under pressure from the prior revision (TASK-2692)', async () => {
  const packet = await buildPacket(input, { ...repository,
    source: async revision => revision === input.priorRevision ? 'large old file'.repeat(1000) : 'complete repaired file',
  }, undefined, encodedBytes, true, undefined, repairBudget);
  const pairs = (packet.request.state as { sourcePairs: { before: string | null; after: string; coverage: string }[] }).sourcePairs;
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].before, null);
  assert.equal(pairs[0].after, 'complete repaired file');
  assert.match(pairs[0].coverage, /prior whole file omitted, not absent/);
  assert.deepEqual((packet.request.state as { contextOmissions: string[] }).contextOmissions, []);
});
