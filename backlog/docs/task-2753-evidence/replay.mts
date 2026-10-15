import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scenario } from '../../../test/helpers/review-classification.js';
import { tryClassifyReview } from '../../../src/application/review-classification/classify-review.js';
import { SystemOneDecisionAdapter } from '../../../src/adapters/decision/system-one.js';
import { withStatisticsDatabase } from '../../../test/fixtures/statistics-database.js';
import { SqliteReviewClassificationStore } from '../../../src/adapters/sqlite/review-classification-store.js';

const root = '/mnt/data/code/parallix-research/px-0010/oc';
const adapter = new SystemOneDecisionAdapter({ route: { provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/systemone', model: 'jev-latest', apiKey: process.env.OPENROUTER_API_KEY!, timeoutMs: 60000 }, availability: { status: 'available', provider: 'openrouter', model: 'jev-latest' } });
const results = [];
await withStatisticsDatabase(async ({ db }) => {
  const telemetry = new SqliteReviewClassificationStore(db);
  for (const id of ['task-2587-r2', 'task-2639-r2', 'task-2662-r2']) {
    const packetPath = `${root}/packets-fixed-validation/${id}.json`;
    const p = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
    const s = scenario('enabled', true);
    const mission = s.store.mission();
    const review = mission.review!;
    const prior = review.rounds[0];
    Object.assign(prior.decision!, { revision: p.priorHead, comment: p.priorReviewComment,
      findings: p.obligations.map((o: any) => ({ id: o.id, summary: o.text, location: null })) });
    Object.assign(prior, { implementerResponseContent: p.implementerResponse });
    Object.assign(prior.response!, { resultingRevision: p.candidateHead,
      resolutions: p.obligations.map((o: any) => ({ findingId: o.id, kind: 'fixed', evidence: p.implementerResponse })) });
    Object.assign(review.rounds[1].subject, { revision: p.candidateHead });
    s.round.verifiedRevision = p.candidateHead;
    Object.assign(s.classifier, { decision: adapter, telemetry: async () => telemetry,
      fingerprint: () => id, now: () => new Date().toISOString(), clock: () => performance.now() });
    s.classifier.evidence.tree = async () => p.repairPaths;
    s.classifier.evidence.diff = async (base, candidate) => {
      assert.equal(base, p.priorHead); assert.equal(candidate, p.candidateHead);
      return p.repairDiff;
    };
    const before = JSON.stringify(review);
    const outcome = await tryClassifyReview(s.context, s.round);
    assert.equal(outcome, null);
    assert.equal(JSON.stringify(review), before);
    assert.deepEqual(s.published, []);
    const calls = await telemetry.calls(String(mission.repositoryId));
    const row = calls.find(c => c.fingerprint === id)!;
    assert.ok(row?.shadow);
    assert.equal(row.obligations?.length, p.obligations.length);
    assert.ok(row.obligations?.every(o => o.probabilities && !o.failure));
    results.push({ historicalRound: id, packetPath, generalReviewerOutcome: p.label,
      applicationOutcome: outcome, authorityUnchanged: true, sqliteReadback: row });
    console.log(id, row.route, JSON.stringify(row.obligations));
  }
});
fs.writeFileSync('backlog/docs/task-2753-evidence/historical-shadow-replay.json', JSON.stringify({
  executedAt: new Date().toISOString(), implementation: '23bceb324ec0e76630595e0203886682526bc43b',
  setup: 'Historical packet-backed evidence port and isolated in-memory Mission scaffold; real SystemOne adapter calls, production tryClassifyReview and SQLite telemetry store. No production database or review authority writes. Historical outcome is archived, not a fresh reviewer call. Temporary database removed after readback.',
  results }, null, 2) + '\n');
