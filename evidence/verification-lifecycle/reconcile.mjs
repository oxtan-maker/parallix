// Independent arithmetic over retained raw rows, with no application imports.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const directory = path.dirname(new URL(import.meta.url).pathname);
const load = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
const raw = load('history.json');
const report = load('report.json');
const latest = new Map();
for (const row of raw.filter(r => r.event_type === 'verification.attempt')) {
  const value = JSON.parse(row.event_data);
  latest.set(value.id, value);
}
const executions = [...latest.values()].filter(a => a.result !== 'reused');
const spans = executions.filter(a => a.startedAt && a.finishedAt)
  .map(a => [Date.parse(a.startedAt), Date.parse(a.finishedAt)]);
// Sweep signed boundary deltas; unlike the production merge algorithm.
function union(intervals) {
  const events = intervals.flatMap(([a, b]) => [[a, 1], [b, -1]]).sort((a, b) => a[0] - b[0]);
  let depth = 0, prior = null, total = 0;
  for (const [at, delta] of events) {
    if (depth > 0 && prior !== null) total += at - prior;
    depth += delta; prior = at;
  }
  return total;
}
const executionMs = union(spans);
const overlapMs = spans.reduce((sum, [a, b]) => sum + b - a, 0) - executionMs;
const cpuRows = executions.filter(a => a.cpu);
const cpuUs = cpuRows.reduce((sum, a) => sum + a.cpu.userUs + a.cpu.systemUs, 0);
assert.ok(cpuRows.every(a => a.cpu.parent === null), 'this real example has independent command trees');
const admission = executions.filter(a => a.startedAt).map(a => [Date.parse(a.requestedAt), Date.parse(a.startedAt)]);
const waitingMs = union([...admission, ...spans]) - executionMs;
const lifecycle = load('lifecycle.json');
const start = Math.min(...lifecycle.filter(e => e.from_status === null).map(e => Date.parse(e.occurred_at)));
const done = Math.min(...lifecycle.filter(e => e.to_status === 'done' && e.from_status !== 'done').map(e => Date.parse(e.occurred_at)));
const endToEndMs = done - start;
const contract = executions.filter(a => a.gate === 'contract');
const recoveryMs = Date.parse(contract.find(a => a.result === 'passed').finishedAt)
  - Date.parse(contract.find(a => a.result === 'failed').finishedAt);
const completedBatch = report.batches.find(batch => {
  const rows = [...latest.values()].filter(a => a.batchId === batch.batchId);
  return rows.some(a => a.gate === 'dependent');
});
const batchRows = [...latest.values()].filter(a => a.batchId === completedBatch.batchId);
const durations = Object.fromEntries(batchRows.map(a => [a.gate, Date.parse(a.finishedAt) - Date.parse(a.startedAt)]));
const criticalPathMs = Math.max(durations.contract, durations.parallel) + durations.dependent;
for (const key of ['executionMs', 'overlapMs', 'cpuUs', 'waitingMs', 'endToEndMs']) {
  assert.equal(report[key], { executionMs, overlapMs, cpuUs, waitingMs, endToEndMs }[key], key);
}
assert.equal(report.recovery.wallMs, recoveryMs);
assert.equal(completedBatch.criticalPathMs, criticalPathMs);
assert.equal(report.criticalPathMs, null, 'cross-batch workflow dependencies are unavailable');
assert.equal(executions.filter(a => a.result === 'failed').length, 1);
assert.equal(executions.filter(a => a.result === 'interrupted').length, 1);
assert.equal(report.reusedProofCount, 2);
const reconciliation = { executionMs, overlapMs, cpuUs, waitingMs, endToEndMs, recoveryMs,
  completedGateDag: { batchId: completedBatch.batchId, durations, criticalPathMs },
  population: { executions: executions.length, reusedProofs: report.reusedProofCount,
    knownCpuTrees: cpuRows.length, missingCpuTrees: executions.length - cpuRows.length },
  qualifications: 'Cancelled peer CPU is unknown, not zero. Unions remove concurrent elapsed double counting. No OS CPU is inferred from V8 samples. Workflow joins are unknown for the explicitly authorized in-process fixture. Agent CPU and inter-batch critical path are unknown. repairMs/reReviewMs come from typed, closed activity sources.',
  profilingDecision: 'The separate retained profiler experiment identifies repeated timezone construction as a candidate investigation. It does not profile these lifecycle gates, establish their workload equivalence or predict an optimization speedup.',
  references: ['history.json', 'lifecycle.json', 'report.json', 'stats.txt', '../verification-profile/report.json', '../verification-profile/analysis.json'],
};
fs.writeFileSync(path.join(directory, 'reconciliation.json'), JSON.stringify(reconciliation, null, 2) + '\n');
console.log(JSON.stringify(reconciliation, null, 2));
