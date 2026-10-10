/** Manual disposable CLI exercise; excluded from test discovery and never uses operator state. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { main } from '../../src/interfaces/cli/runtime.js';
import { createReviewCommand } from '../../src/interfaces/cli/review.js';
import { ReviewCommandUseCase } from '../../src/application/review-command-use-case.js';
import { createReviewWorkflowAdapter } from '../../src/adapters/review/review-workflow-adapter.js';
import { ReviewState } from '../../src/adapters/review/review-state.js';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { SqliteReviewClassificationStore } from '../../src/adapters/sqlite/review-classification-store.js';
import { MissionLifecycleService } from '../../src/application/mission-lifecycle-service.js';
import { GitReviewEvidence } from '../../src/adapters/review/review-evidence.js';
import { createDecisionPort } from '../../src/composition/decision.js';
import { resolveConfiguration } from '../../src/composition/config.js';
import { changeRevision } from '../../src/domain/review.js';
import { missionId } from '../../src/domain/mission.js';
import type { ClassifierCallMeasurement } from '../../src/application/ports/review-classification-telemetry.js';
import { fixtureMission } from '../../test/fixtures/mission-builders.js';
import { repeatReview } from '../../test/fixtures/repeat-review.js';
import { fakeReviewLoopPorts } from '../../test/helpers/review-loop-ports.js';

const output = process.argv[2];
if (output && path.resolve(output).startsWith(`${process.cwd()}${path.sep}`)) { throw new Error('Export must stay outside the repository'); }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-manual-panel-'));
const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
process.once('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM'] as const) { process.once(signal, () => { cleanup(); process.exit(130); }); }
const exports: ClassifierCallMeasurement[] = [];
try {
  for (const scenario of ['approval', 'return', 'conflict', 'failure', 'stale'] as const) {
    const worktree = path.join(root, scenario), home = path.join(worktree, 'home');
    fs.mkdirSync(home, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-b', 'main'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Disposable fixture');
    fs.writeFileSync(path.join(worktree, 'x.java'), 'return null;\n'); git('add', 'x.java'); git('commit', '-m', 'prior');
    const prior = git('rev-parse', 'HEAD');
    git('switch', '-c', 'mission/task-2658');
    fs.writeFileSync(path.join(worktree, 'x.java'), 'return output;\n'); git('add', 'x.java'); git('commit', '-m', 'repair');
    const candidate = git('rev-parse', 'HEAD');
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: path.join(home, 'parallix.db') });
    try {
      await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
      const store = new SqliteMissionStore(db), lifecycle = new MissionLifecycleService(store);
      const original = repeatReview();
      const review = { ...original, rounds: [
        { ...original.rounds[0], subject: { ...original.rounds[0].subject, revision: changeRevision(prior) },
          response: { ...original.rounds[0].response!, resultingRevision: changeRevision(candidate) } },
        { ...original.rounds[1], subject: { ...original.rounds[1].subject, revision: changeRevision(candidate) } },
      ] as const };
      await store.save(fixtureMission('task-2658', { status: 'review', review }), null);
      const state = new ReviewState('task-2658', { implementer: 'codex', reviewer: 'claude' });
      state.round = 2; state.phase = 'reviewing'; state.startedAt = review.rounds[1].startedAt;
      const timeline: string[] = [], published: string[] = [];
      const fake = fakeReviewLoopPorts({ slug: 'task-2658', state, worktree, provider: {}, missionStore: store, lifecycle,
        preReview: { rebase: async () => { timeline.push('rebase'); return { ok: true }; },
          runGate: async () => { timeline.push('gate'); return { ok: true }; },
          head: () => git('rev-parse', 'HEAD'), reviewBaseline: () => prior },
        agents: { launch: async launch => { timeline.push(launch.role); throw new Error('Disposable fixture reached delegated workflow'); } },
      });
      const telemetry = new SqliteReviewClassificationStore(db);
      const configuration = resolveConfiguration({ PARALLIX_HOME: home, JEV_CODE_PROVIDER: 'typesafe', TYPESAFE_API_KEY: 'disposable-fixture', TYPESAFE_DEFAULT_MODEL: 'jev-latest' });
      let calls = 0;
      const states: string[] = [];
      const decision = createDecisionPort(configuration.decision, async (_url, options) => {
        const index = calls++;
        timeline.push(`question-${index}`);
        const request = JSON.parse(String(options?.body));
        states.push(JSON.stringify(request.state));
        if (Object.keys(request.questions).length !== 1) { throw new Error('Multi-question request'); }
        if (scenario === 'failure' && index === 1) { return new Response('{}', { status: 503 }); }
        if (scenario === 'stale' && index === 1) { git('commit', '--allow-empty', '-m', 'candidate moved during panel'); }
        const selected = scenario === 'return' && index === 1 || scenario === 'conflict' && index === 2 ? 'does_not_address'
          : scenario === 'return' || index === 2 ? 'insufficient_evidence' : 'addresses';
        const probabilities = Object.fromEntries(['addresses', 'does_not_address', 'insufficient_evidence'].map(label => [label, label === selected ? 0.9 : 0.05]));
        return new Response(JSON.stringify({ model: 'typesafe/jev-1.13-20260917', answers: {
          resolution: { type: 'choice', choice: selected, probabilities, confidence: 0.01 },
        }, usage: { input_tokens: 500, output_tokens: 1, cost: 0.001 } }));
      });
      const ports = { ...fake.ports, classification: {
        mode: 'enabled' as const, decision, evidence: new GitReviewEvidence(worktree), telemetry: async () => telemetry,
        hash: (text: string) => createHash('sha256').update(text).digest('hex'), fingerprint: () => scenario,
        now: () => '2026-10-10T00:00:00Z', clock: () => performance.now(),
        publish: async (_source: unknown, route: string) => { published.push(route); timeline.push('publish'); return true; },
      } };
      const command = createReviewCommand(new ReviewCommandUseCase(createReviewWorkflowAdapter({
        inferSlugFn: () => 'task-2658', resolveWorktreeFn: () => worktree, missionStore: store,
        readReviewStateFn: async () => state, continueReviewClearsInterventionFn: async () => {},
        reviewLoopMechanisms: () => ports, log: () => {}, error: () => {},
      })));
      // Run the public CLI dispatcher and review parser; external agent/provider effects are disposable fixtures.
      await main(['review', 'task-2658', '--continue', '--max-attempts', '2'], {
        runtime: { ci: true, noTui: true }, cwdFn: () => worktree, loadAliasesFn: () => ({}), commandFns: { review: command },
        logFn: () => {}, errorFn: message => { throw new Error(message); }, exitFn: code => { throw new Error(`CLI exit ${code}`); },
      });
      const rows = await telemetry.calls('parallix');
      const loaded = await store.load(missionId('task-2658'));
      if (loaded.kind !== 'found') { throw new Error('Missing disposable mission'); }
      const expected = scenario === 'approval' ? 'clear' : scenario === 'return' ? 'implementer' : 'reviewer';
      if (rows.length !== 1 || rows[0].route !== expected || calls !== 3 || new Set(states).size !== 1
        || published.length !== (expected === 'reviewer' ? 0 : 1) || timeline.indexOf('gate') > timeline.indexOf('question-0')) {
        throw new Error(`Unexpected ${scenario} observations: ${JSON.stringify({ rows, calls, published, timeline })}`);
      }
      if (expected === 'reviewer' && loaded.mission.review!.rounds.at(-1)!.decision) { throw new Error('Fallback wrote a classifier decision'); }
      exports.push(...rows);
      console.log(JSON.stringify({ scenario, command: 'px review task-2658 --continue --max-attempts 2', calls,
        identicalState: new Set(states).size === 1, route: rows[0].route, reason: rows[0].reason, published,
        lane: loaded.mission.status, delegatedRoles: fake.launches.map(launch => launch.role), timeline,
        isolated: true, cleanedAfterRun: true }));
    } finally { await db.close(); }
  }
  if (output) { fs.writeFileSync(output, JSON.stringify(exports, null, 2) + '\n'); }
} finally { cleanup(); }
