/** Derive accounting and stage-consistent metrics without repeating paid model calls. */
import fs from 'node:fs';
import path from 'node:path';
import { gradeRawEvaluation } from './lead-judgment-evaluation-fixtures.js';
import type { DecisionResult } from '../src/application/ports/decision.js';
interface RecordedTrial {
  repeat: number; case: string; arm: string; elapsedMs: number; selected: string | null;
  actions: number; recoveryLaunches: number; grade: Record<string, unknown>;
  captures: Array<{ result?: DecisionResult; elapsedMs: number; error?: string }>;
}
const results = process.argv[process.argv.indexOf('--results') + 1];
const output = process.argv[process.argv.indexOf('--output') + 1];
if (!process.argv.includes('--results') || !process.argv.includes('--output') || !results || !output) {
  throw new Error('Usage: tsx scripts/analyze-lead-judgment.ts --results <results.json> --output <accounting.json>');
}
const data = JSON.parse(fs.readFileSync(results, 'utf8')) as {
  protocol: { revision: string; cases: Array<{ id: string; expected: string[] }> }; trials: RecordedTrial[] };
const rows = data.trials.map(t => {
  const expected = data.protocol.cases.find(c => c.id === t.case)?.expected;
  if (!expected) { throw new Error(`Missing frozen expectation for ${t.case}`); }
  const answer = t.captures.at(-1)?.result?.answers.action;
  const raw = answer?.type === 'choice' ? answer.selected : null;
  const usage = t.captures.map(c => c.result?.usage);
  const total = (key: 'inputTokens' | 'outputTokens' | 'cost') =>
    usage.every(u => u?.[key] !== undefined) ? usage.reduce((n, u) => n + (u?.[key] ?? 0), 0) : null;
  return { repeat: t.repeat, case: t.case, arm: t.arm, calls: t.captures.length,
    inputTokens: total('inputTokens'), outputTokens: total('outputTokens'), providerCost: total('cost'),
    trialElapsedMs: t.elapsedMs, callElapsedMs: t.captures.map(c => c.elapsedMs), actions: t.actions,
    recoveries: t.recoveryLaunches, rawModelAction: raw, ...gradeRawEvaluation(expected, raw),
    controllerOrActorAction: t.selected, finalStateGrade: t.grade, errors: t.captures.filter(c => c.error).map(c => c.error) };
});
const byArm = [...new Set(rows.map(t => t.arm))].map(arm => {
  const ts = rows.filter(t => t.arm === arm);
  return { arm, trials: ts.length, modelProposals: ts.filter(t => t.modelProposal).length,
    appropriateRawProposals: ts.filter(t => t.appropriateRawProposal === true).length,
    inappropriateRawContinuations: ts.filter(t => t.inappropriateRawContinuation).length,
    executedUnsafeActions: ts.filter(t => t.finalStateGrade.executedUnsafeAction === true).length,
    inputTokens: ts.reduce((n, t) => n + (t.inputTokens ?? 0), 0),
    outputTokens: ts.reduce((n, t) => n + (t.outputTokens ?? 0), 0),
    providerCost: ts.reduce((n, t) => n + (t.providerCost ?? 0), 0),
    hasMissingUsage: ts.some(t => t.inputTokens === null || t.outputTokens === null || t.providerCost === null) };
});
const record = { derivedFrom: path.basename(results), protocolRevision: data.protocol.revision,
  metricStages: 'Raw model proposals compared before admission across every arm. Controller/actor selection and final executor effects are separate. No-call live controls are excluded from model denominators.', byArm, trials: rows };
fs.writeFileSync(output, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(byArm, null, 2));
