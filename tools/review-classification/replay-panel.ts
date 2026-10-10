/** Read-only audit of exported measurement samples; never calls a model or writes statistics. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { aggregatePanel, panelVote } from '../../src/application/review-classification/panel.js';
import { PANEL_QUESTIONS, PANEL_PROMPT_VERSION } from '../../src/application/review-classification/panel-questions.js';
import { PANEL_POLICY_VERSION } from '../../src/domain/classifier-review.js';
import type { ClassifierCallMeasurement } from '../../src/application/ports/review-classification-telemetry.js';
import { ARCHIVED_PACKING_VERSION } from '../../src/application/review-classification/archived-packing.js';

const file = process.argv[2];
if (!file) { throw new Error('Usage: npx tsx tools/review-classification/replay-panel.ts <exported-samples.json>'); }
const exported = JSON.parse(fs.readFileSync(file, 'utf8')) as ClassifierCallMeasurement[];
if (!Array.isArray(exported)) { throw new Error('Expected exported sample arrays'); }
const rows = exported.flat() as ClassifierCallMeasurement[];
if (rows.length > 1000) { throw new Error('Expected at most 1000 exported samples'); }
for (const row of rows) {
  const panel = row.panel;
  if (!panel) { console.log(JSON.stringify({ mission: row.mission, round: row.round, historical: true })); continue; }
  if (panel.policyVersion !== PANEL_POLICY_VERSION || panel.promptVersion !== PANEL_PROMPT_VERSION || row.packetVersion !== ARCHIVED_PACKING_VERSION) {
    throw new Error('Unrecognized policy, question or packing identity');
  }
  for (const member of panel.members) {
    const question = PANEL_QUESTIONS[member.question];
    if (!question || createHash('sha256').update(JSON.stringify(question)).digest('hex') !== member.questionHash) { throw new Error('Question hash mismatch'); }
    if (member.failure) { continue; }
    const recomputed = panelVote(member.question, { provider: member.provider, model: member.model!, answers: { resolution: {
      type: 'choice', selected: member.selected!, probabilities: member.probabilities!, confidence: 0,
    } } });
    if (recomputed.failure || recomputed.vote !== member.vote) { throw new Error('Stored vote differs from frozen policy'); }
  }
  const replay = aggregatePanel(panel.members);
  // Application guards, shadow mode and preparation failures may defer an otherwise voting panel.
  if (panel.outcome !== 'reviewer' && replay.route !== panel.outcome) { throw new Error('Stored applied outcome differs from frozen policy'); }
  console.log(JSON.stringify({ mission: row.mission, round: row.round, priorRevision: row.priorRevision,
    candidateRevision: row.candidateRevision, packetHash: row.packetHash, calls: panel.calls, replay: replay.route,
    applied: row.route, reason: row.reason, members: panel.members }));
}
