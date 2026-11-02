/** Manual, disposable application benchmark. No live mission, database, provider or statistics access.
 * Run: node --import tsx tools/review-classification/benchmark-packing.ts [real|double]
 * Bound a parent run externally with timeout; progress reports preserve started work on termination.
 */
import assert from 'node:assert/strict';
import { agentFamily } from '../../src/domain/agents.js';
import { hostname, cpus } from 'node:os';
import { scenario } from '../../test/helpers/review-classification.js';
import { oversizedClassifierEvidence, evidenceCharacters, countingEvidenceBudget } from '../../test/helpers/oversized-classifier-evidence.js';
import { main } from '../../src/interfaces/cli/runtime.js';
import { createReviewCommand } from '../../src/interfaces/cli/review.js';
import { ReviewCommandUseCase } from '../../src/application/review-command-use-case.js';
import { createReviewWorkflowAdapter } from '../../src/adapters/review/review-workflow-adapter.js';
import { ReviewState } from '../../src/adapters/review/review-state.js';
import { fakeReviewLoopPorts } from '../../test/helpers/review-loop-ports.js';
import { tempRoots } from '../../test/bootstrap-parallix-home.js';
import { packArchivedState } from '../../src/application/review-classification/archived-packing.js';
import { createDecisionPort } from '../../src/composition/decision.js';
import { resolveConfiguration } from '../../src/composition/config.js';
import type { DecisionData, DecisionRequest } from '../../src/application/ports/decision.js';

const mode = process.argv[2] ?? 'real';
assert.ok(['real', 'double'].includes(mode));
const fixture = oversizedClassifierEvidence();
const s = scenario(); // Fresh in-memory MissionStore, telemetry and publication double on every invocation.
s.classifier.evidence = fixture.repository;
Object.assign(s.store.mission(), { assignee: agentFamily('codex') });
const prior = s.store.mission().review!.rounds[0];
assert.equal(prior.decision?.kind, 'changes-requested');
Object.assign(prior, { decision: { ...prior.decision, comment: fixture.paths.join(' ') } });
const packet = await packArchivedState({ priorRevision: 'a'.repeat(40), candidateRevision: 'b'.repeat(40),
  findings: prior.decision!.kind === 'changes-requested' ? prior.decision!.findings : [],
  priorReviewComment: fixture.paths.join(' '), implementerResponse: prior.implementerResponseContent!,
}, fixture.repository);
// Explicit environment avoids reading credentials or operator configuration. No transport is reachable.
const adapter = createDecisionPort(resolveConfiguration({ JEV_CODE_PROVIDER: 'typesafe', TYPESAFE_API_KEY: 'disposable' }).decision,
  async () => assert.fail('manual benchmark must never contact a provider'));
const budget = mode === 'double' ? countingEvidenceBudget().measure : adapter.requestBudget.bind(adapter);
const counts = { expensiveCallsStarted: 0, expensiveCallsCompleted: 0, fullState: 0, charactersStarted: 0, charactersCompleted: 0 };
const start = performance.now(), cpuStart = process.cpuUsage();
function report(phase: string, extra: object = {}) {
  const cpu = process.cpuUsage(cpuStart);
  console.log(JSON.stringify({ phase, mode, wallMs: performance.now() - start, cpuMs: (cpu.user + cpu.system) / 1000, ...counts, ...extra }));
}
s.classifier.decision.requestBudget = (request: DecisionRequest) => {
  const characters = evidenceCharacters(request.state) + evidenceCharacters(request.questions as DecisionData);
  const full = request.state && typeof request.state === 'object' && 'finding' in request.state;
  counts.expensiveCallsStarted++; counts.charactersStarted += characters;
  if (full) { counts.fullState++; }
  if (full || counts.expensiveCallsStarted % 50 === 0) { report('count-start'); }
  const measured = budget(request);
  counts.expensiveCallsCompleted++; counts.charactersCompleted += characters;
  return measured;
};
let providerCalls = 0;
s.classifier.decision.decide = async request => {
  const b = s.classifier.decision.requestBudget(request);
  assert.ok(b.requestBytes <= b.maxRequestBytes && b.inputTokens <= Math.min(32000, b.maxInputTokens)
    && b.contextTokens <= Math.min(30000, b.maxContextTokens));
  providerCalls++;
  return { provider: 'disposable', model: 'double', answers: { resolution: { type: 'choice', selected: 'insufficient_evidence',
    probabilities: { addresses: 0, does_not_address: 0, insufficient_evidence: 1 }, confidence: 1 } } };
};
report('start', { workstation: hostname(), cpu: cpus()[0]?.model, node: process.version,
  cleanupRoots: [...tempRoots], command: 'px review task-2658 --max-attempts 2',
  fixture: { sources: fixture.paths.length, sourceCharacters: fixture.source.length, diffCharacters: fixture.diff.length,
    packetJsonCharacters: JSON.stringify(packet.request).length }, isolation: 'in-memory repository, MissionStore, telemetry and publication; provider double' });
const state = new ReviewState('task-2658', { implementer: 'codex', reviewer: 'claude' });
state.round = 2;
state.phase = 'reviewing';
state.startedAt = '2026-10-01T00:03:00Z';
const delegated: string[] = [];
const fake = fakeReviewLoopPorts({ slug: 'task-2658', state, worktree: s.context.ports.worktree,
  provider: {}, missionStore: s.store, lifecycle: s.context.ports.lifecycle,
  preReview: { head: () => 'b'.repeat(40) },
  agents: { launch: async launch => { delegated.push(launch.role); throw new Error('Disposable general-review boundary reached'); } },
});
const ports = { ...fake.ports, classification: s.classifier };
const command = createReviewCommand(new ReviewCommandUseCase(createReviewWorkflowAdapter({
  inferSlugFn: () => 'task-2658', resolveWorktreeFn: () => ports.worktree, missionStore: s.store,
  readReviewStateFn: async () => state, continueReviewClearsInterventionFn: async () => {},
  reviewLoopMechanisms: () => ports, log: () => {}, error: () => {},
})));
await main(['review', 'task-2658', '--max-attempts', '2'], {
  runtime: { ci: true, noTui: true }, cwdFn: () => ports.worktree, loadAliasesFn: () => ({}), commandFns: { review: command },
  logFn: () => {}, errorFn: message => { throw new Error(message); }, exitFn: code => { throw new Error(`CLI exit ${code}`); },
});
assert.ok(delegated.includes('reviewer'), 'insufficient evidence reaches general review through the public CLI');
assert.equal(providerCalls, 3, 'reduced packet must be exactly admitted for all questions');
assert.deepEqual(s.published, []);
assert.equal(s.attempts[0].reason, 'abstention');
report('complete', { result: 'exact-admission; three independent abstentions; general-review fallback', providerCalls,
  omittedDiffCount: s.attempts[0].omittedDiffCount, omittedTokens: s.attempts[0].omittedTokens, cleanup: 'all evidence, stores, telemetry and publications were disposable memory; no persistent or live writes' });
