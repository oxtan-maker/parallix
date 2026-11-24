// Entry-point parity: the CLI and the board enter review through the same
// application owner, so each scenario must leave identical durable results.
// Git, shell checks and SQLite are real; only the agent launcher is doubled.
import { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { missionVersion } from '../../src/application/domain-ports.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { readIntegrationGateRun } from '../../src/adapters/verification/integration-verification-proof.js';
import { resolveConfiguration } from '../../src/composition/config.js';
import type { Mission } from '../../src/domain/mission.js';
import { requestReviewIntervention } from '../../src/domain/review.js';
import { HUMAN_REVIEW_WITHDRAWAL_EVENT, REVIEW_START_DECISION_EVENT } from '../../src/application/verification-policy/review-start-decision.js';
import { setLogger } from '../../src/application/presentation/cli-format.js';
import { run as runCli } from '../../src/composition/create-cli.js';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../src/adapters/agents/agents.js';
import { openRepairFixture, type RepairFixture } from '../lib/integration-repair-fixture.js';
import { enterReviewVia } from './review-repair-recovery.js';

export type ParityScenario = "first-review preparation" | 'interrupted-pending-review' | 'findings-resolution' | 'human-intervention' | 'already-approved';

export interface ParityOutcome {
  readonly code: number;
  readonly mission: Mission;
  readonly launches: readonly string[];
  readonly laneEvents: ReadonlyArray<{ from_status: string | null; to_status: string; trigger: string }>;
  readonly messages: string;
  /** Status of the integration gate-run evidence left in the checkout; null when none was written. */
  readonly gateRunStatus: string | null;
}

export interface ConcurrentPolicyOutcome extends ParityOutcome {
  readonly startsBeforeVerdict: readonly string[];
  readonly withdrawals: number;
  readonly jointRepairPrompt: string | null;
}

/** The durable starting state of a scenario; every entry starts from the same bytes. */
async function openState(scenario: ParityScenario, fixture: RepairFixture, store: SqliteMissionStore, original: Mission): Promise<void> {
  const save = async (mission: Mission) => { await store.save(mission, missionVersion(await fixture.version())); };
  const active = { ...original, status: 'active', rawStatus: 'active' } as Mission;
  if (scenario === "first-review preparation" || scenario === 'findings-resolution') {
    await save({ ...active, closedAt: null, review: null } as Mission);
  } else if (scenario === 'interrupted-pending-review') {
    await save(active);
  } else if (scenario === 'already-approved') {
    await save({ ...original, status: 'review', rawStatus: 'review', closedAt: null } as Mission);
  } else if (scenario === 'human-intervention') {
    await save({ ...active, review: requestReviewIntervention(original.review!, { requestedAt: '2026-10-01T13:00:00Z', requestedBy: 'workflow', reason: 'REPAIR_EXHAUSTED' }) } as Mission);
  }
}

export async function parityCase(scenario: ParityScenario, entry: 'cli' | 'board', t: TestContext): Promise<ParityOutcome> {
  const pending = scenario === 'interrupted-pending-review' || scenario === 'human-intervention';
  const fixture = await openRepairFixture({ slug: 'task-entry-parity', state: pending ? 'undecided-review' : 'approved-integration',
    // An already-approved candidate is offered its tests action on entry (TASK-2872.02); a passing gate keeps that case about the approval.
    ...(scenario === 'already-approved' ? { gateCommand: 'true' } : {}) });
  const priorConfinement = process.env.PARALLIX_NO_BUBBLEWRAP;
  process.env.PARALLIX_NO_BUBBLEWRAP = '1';
  const messages: string[] = [];
  const previousLogger = setLogger({ log: text => { messages.push(String(text)); }, error: text => { messages.push(String(text)); } });
  t.after(async () => {
    setLogger(previousLogger);
    setWorkflowLaunchPort(null); setCommandPathProbe(null); setLauncherHealthProbe(null);
    if (priorConfinement === undefined) { delete process.env.PARALLIX_NO_BUBBLEWRAP; } else { process.env.PARALLIX_NO_BUBBLEWRAP = priorConfinement; }
    await fixture.close();
  });
  const store = new SqliteMissionStore(fixture.database);
  await openState(scenario, fixture, store, await fixture.load());
  const launches: string[] = [];
  setCommandPathProbe(() => '/fixture-agent');
  setLauncherHealthProbe(() => ({ ok: true as const }));
  // Agent children are automatic invocations: they hold no operator authority.
  const invoke = (args: string[]) => runCli(args, { operatorInvocation: false, baseCwd: fixture.worktree, log: text => { messages.push(text); return text; }, error: text => { messages.push(text); return text; } });
  let reviewLaunches = 0;
  setWorkflowLaunchPort(({ prompt, worktree }: { prompt: string; worktree?: string }) => ({
    invocation: { command: 'fixture-agent', args: [], options: { cwd: worktree } },
    resultPromise: (async () => {
      const round = (await fixture.load()).review!.rounds.at(-1)!;
      if (/^Mode: review\./m.test(prompt)) {
        launches.push('review');
        reviewLaunches += 1;
        const verdict = scenario === 'findings-resolution' && reviewLaunches === 1
          ? ['request-changes', '--finding', 'F1', '--summary', 'Needs a fix']
          : ['approve'];
        assert.equal(await invoke(['verdict', verdict[0], '--slug', fixture.slug, '--actor', round.reviewer, ...verdict.slice(1), '--comment', 'fixture verdict']), 0, messages.join('\n'));
      } else {
        launches.push('implement');
        fs.writeFileSync(path.join(fixture.worktree, 'fix.txt'), 'fixed\n');
        fixture.git(fixture.worktree, ['add', 'fix.txt']);
        fixture.git(fixture.worktree, ['commit', '-m', 'fix F1']);
        assert.equal(await invoke(['resolve', '--slug', fixture.slug, '--actor', round.implementer, '--finding', 'F1', '--fixed', 'fixed in fix.txt']), 0, messages.join('\n'));
      }
      return { status: 0, stdout: '', stderr: '' };
    })(),
  }));
  const approvalBefore = (await fixture.load()).review?.rounds[0].decision;
  const lanesBefore = (await fixture.laneEvents()).length;
  const code = await enterReviewVia(entry, fixture, store, messages, invoke);
  const outcome = { code, mission: await fixture.load(), launches, laneEvents: (await fixture.laneEvents()).slice(lanesBefore),
    messages: messages.join('\n'),
    gateRunStatus: readIntegrationGateRun(fixture.worktree, resolveConfiguration(process.env))?.status ?? null };
  if (scenario === 'already-approved') {
    assert.deepEqual(outcome.mission.review!.rounds[0].decision, approvalBefore, 'restart preserves the original judgment and its provenance');
  }
  t.diagnostic(`${scenario}/${entry}: code=${code} status=${outcome.mission.status} rounds=${outcome.mission.review?.rounds.length} launches=${launches} lanes=${outcome.laneEvents.map(e => `${e.from_status}>${e.to_status}`)}\n${outcome.messages.slice(-1200)}`);
  return outcome;
}

/** Public CLI rehearsal with real Git, SQLite and shell gates; only the agent process is deterministic. */
export async function concurrentPolicyCase(t: TestContext, dualFailure = false): Promise<ConcurrentPolicyOutcome> {
  const artifact = fs.readFileSync(path.resolve('config/verification-policy/time-policy.json'), 'utf8');
  const gate = `mkdir -p .workflow; touch .workflow/tests-started; i=0; while test ! -f .workflow/agent-started; do i=$((i+1)); test "$i" -lt 500 || exit 9; sleep 0.01; done; ${dualFailure ? 'test -f fix.txt' : 'touch .workflow/tests-passed'}`;
  const fixture = await openRepairFixture({ slug: 'task-concurrent-policy', state: 'undecided-review', gateCommand: gate,
    verificationPolicy: { artifact: 'config/time-policy.json', content: artifact } });
  if (dualFailure) {
    const configPath = path.join(fixture.worktree, 'workflow.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(configPath, JSON.stringify({ ...config, reviewActionLimit: 5 }, null, 2));
    fixture.git(fixture.worktree, ['add', 'workflow.config.json']);
    fixture.git(fixture.worktree, ['commit', '-m', 'configure review action boundary']);
  }
  const priorConfinement = process.env.PARALLIX_NO_BUBBLEWRAP;
  process.env.PARALLIX_NO_BUBBLEWRAP = '1';
  const messages: string[] = [];
  const previousLogger = setLogger({ log: text => { messages.push(String(text)); }, error: text => { messages.push(String(text)); } });
  t.after(async () => {
    setLogger(previousLogger); setWorkflowLaunchPort(null); setCommandPathProbe(null); setLauncherHealthProbe(null);
    if (priorConfinement === undefined) delete process.env.PARALLIX_NO_BUBBLEWRAP; else process.env.PARALLIX_NO_BUBBLEWRAP = priorConfinement;
    await fixture.close();
  });
  setCommandPathProbe(() => '/fixture-agent'); setLauncherHealthProbe(() => ({ ok: true as const }));
  const invoke = (args: string[]) => runCli(args, { operatorInvocation: false, baseCwd: fixture.worktree,
    log: text => { messages.push(text); return text; }, error: text => { messages.push(text); return text; } });
  let startsBeforeVerdict: string[] = [];
  let reviewerLaunches = 0;
  let jointRepairPrompt: string | null = null;
  const launches: string[] = [];
  setWorkflowLaunchPort(({ prompt, worktree }: { prompt: string; worktree?: string }) => ({
    invocation: { command: 'fixture-agent', args: [], options: { cwd: worktree } },
    resultPromise: (async () => {
      if (/^Mode: act-on-review\./m.test(prompt)) {
        launches.push('implement');
        jointRepairPrompt = prompt;
        fs.writeFileSync(path.join(fixture.worktree, 'fix.txt'), 'fixed together\n');
        fixture.git(fixture.worktree, ['add', 'fix.txt']);
        fixture.git(fixture.worktree, ['commit', '-m', 'fix joined verification findings']);
        const round = (await fixture.load()).review!.rounds.at(-1)!;
        assert.equal(await invoke(['resolve', '--slug', fixture.slug, '--actor', round.implementer,
          '--finding', 'A1', '--fixed', 'joint repair prompt carried the gate and agent findings']), 0, messages.join('\n'));
        return { status: 0, stdout: '', stderr: '' };
      }
      reviewerLaunches += 1;
      launches.push('review');
      assert.match(prompt, /^Mode: review\./m);
      for (let count = 0; count < 500 && !fs.existsSync(path.join(fixture.worktree, '.workflow', 'tests-started')); count++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(fs.existsSync(path.join(fixture.worktree, '.workflow', 'tests-started')), true, 'integration tests started before agent verdict');
      fs.mkdirSync(path.join(fixture.worktree, '.workflow'), { recursive: true });
      fs.writeFileSync(path.join(fixture.worktree, '.workflow', 'agent-started'), 'started\n');
      for (let count = 0; count < 500; count++) {
        const rows = await fixture.database.query<{ event_data: string }>(
          'SELECT event_data FROM operational_history WHERE event_type = ? ORDER BY id', [REVIEW_START_DECISION_EVENT]);
        startsBeforeVerdict = rows.map(row => (JSON.parse(row.event_data) as { actualAction: string }).actualAction);
        if (['human', 'tests', 'agent'].every(action => startsBeforeVerdict.includes(action))) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const round = (await fixture.load()).review!.rounds.at(-1)!;
      const verdict = dualFailure && reviewerLaunches === 1
        ? ['request-changes', '--finding', 'A1', '--summary', 'agent finding']
        : ['approve'];
      assert.equal(await invoke(['verdict', verdict[0], '--slug', fixture.slug, '--actor', round.reviewer,
        ...verdict.slice(1), '--comment', dualFailure && reviewerLaunches === 1 ? 'fixture red' : 'fixture pass']), 0);
      return { status: 0, stdout: '', stderr: '' };
    })(),
  }));
  const lanesBefore = (await fixture.laneEvents()).length;
  const code = await enterReviewVia('cli', fixture, new SqliteMissionStore(fixture.database), messages, invoke);
  const startsAfterFirstRun = await fixture.database.query<{ event_data: string }>(
    'SELECT event_data FROM operational_history WHERE event_type = ? ORDER BY id', [REVIEW_START_DECISION_EVENT]);
  const withdrawalsAfterFirstRun = await fixture.database.query(
    'SELECT event_data FROM operational_history WHERE event_type = ? ORDER BY id', [HUMAN_REVIEW_WITHDRAWAL_EVENT]);
  const launchCountAfterFirstRun = launches.length;
  const implementerLaunchesAfterFirstRun = launches.filter(launch => launch === 'implement').length;
  const restartCode = dualFailure ? null : await invoke(['review', fixture.slug]);
  const startsAfterRestart = await fixture.database.query<{ event_data: string }>(
    'SELECT event_data FROM operational_history WHERE event_type = ? ORDER BY id', [REVIEW_START_DECISION_EVENT]);
  const withdrawalRows = await fixture.database.query(
    'SELECT event_data FROM operational_history WHERE event_type = ? ORDER BY id', [HUMAN_REVIEW_WITHDRAWAL_EVENT]);
  if (dualFailure) {
    assert.equal(withdrawalsAfterFirstRun.length, 1, 'the red round writes one withdrawal before restart');
    assert.equal(withdrawalRows.length, 1, 'the red round records one withdrawal');
    assert.equal(implementerLaunchesAfterFirstRun, 1, 'the dual failure launches one joint implementer');
  } else {
    assert.deepEqual(startsAfterRestart.map(row => row.event_data), startsAfterFirstRun.map(row => row.event_data),
      'restart appends no human, tests, or agent request for the settled round key');
    assert.equal(launches.length, launchCountAfterFirstRun, 'restart launches no duplicate reviewer or joint implementer');
    assert.equal(reviewerLaunches, 1, 'restart launches no duplicate reviewer');
  }
  const outcome = { code, mission: await fixture.load(), launches, laneEvents: (await fixture.laneEvents()).slice(lanesBefore),
    messages: messages.join('\n'), gateRunStatus: readIntegrationGateRun(fixture.worktree, resolveConfiguration(process.env))?.status ?? null,
    startsBeforeVerdict, withdrawals: withdrawalRows.length, jointRepairPrompt };
  t.diagnostic(`concurrent policy: code=${code} starts=${startsBeforeVerdict.join(',')} gate=${outcome.gateRunStatus} withdrawals=${outcome.withdrawals} launches=${launches.join(',')}`);
  if (!dualFailure) {
    assert.equal(restartCode, 0, `restart preserves the settled result\n${outcome.messages.slice(-4000)}`);
  }
  return outcome;
}
