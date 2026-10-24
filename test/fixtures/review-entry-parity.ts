// Entry-point parity: the CLI and the board enter review through the same
// application owner, so each scenario must leave identical durable results.
// Git, shell checks and SQLite are real; only the agent launcher is doubled.
import { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { missionVersion } from '../../src/application/domain-ports.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import type { Mission } from '../../src/domain/mission.js';
import { requestReviewIntervention } from '../../src/domain/review.js';
import { setLogger } from '../../src/application/presentation/cli-format.js';
import { run as runCli } from '../../src/composition/create-cli.js';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../src/adapters/agents/agents.js';
import { openRepairFixture, type RepairFixture } from '../lib/integration-repair-fixture.js';
import { enterReviewVia } from './review-repair-recovery.js';

export type ParityScenario = 'first-handoff' | 'interrupted-pending-review' | 'findings-resolution' | 'human-intervention' | 'already-approved';

export interface ParityOutcome {
  readonly code: number;
  readonly mission: Mission;
  readonly launches: readonly string[];
  readonly laneEvents: ReadonlyArray<{ from_status: string | null; to_status: string; trigger: string }>;
  readonly messages: string;
}

/** The durable starting state of a scenario; every entry starts from the same bytes. */
async function openState(scenario: ParityScenario, fixture: RepairFixture, store: SqliteMissionStore, original: Mission): Promise<void> {
  const save = async (mission: Mission) => { await store.save(mission, missionVersion(await fixture.version())); };
  const active = { ...original, status: 'active', rawStatus: 'active' } as Mission;
  if (scenario === 'first-handoff' || scenario === 'findings-resolution') {
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
  const fixture = await openRepairFixture({ slug: 'task-entry-parity', state: pending ? 'undecided-review' : 'approved-integration' });
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
  const lanesBefore = (await fixture.laneEvents()).length;
  const code = await enterReviewVia(entry, fixture, store, messages, invoke);
  const outcome = { code, mission: await fixture.load(), launches, laneEvents: (await fixture.laneEvents()).slice(lanesBefore), messages: messages.join('\n') };
  t.diagnostic(`${scenario}/${entry}: code=${code} status=${outcome.mission.status} rounds=${outcome.mission.review?.rounds.length} launches=${launches} lanes=${outcome.laneEvents.map(e => `${e.from_status}>${e.to_status}`)}\n${outcome.messages.slice(-1200)}`);
  return outcome;
}
