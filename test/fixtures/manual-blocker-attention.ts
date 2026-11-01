import { ExecutionActivityRecorder } from '../../src/application/recording/execution-activity-recorder.js';
import { SqliteExecutionActivityStore } from '../../src/adapters/sqlite/execution-activity-store.js';
import { resolveCanonicalRepositoryId } from '../../src/adapters/git/repository-identity.js';
// Public-interface observation only; run with npx tsx after npm run build.
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { workflowBoard } from './workflow-board.js';
import { fixtureMission } from './mission-builders.js';
import { agentFamily } from '../../src/domain/agents.js';
import { missionId } from '../../src/domain/mission.js';
import { applyReviewerCommand, startReview, changeRevision, ConfiguredReviewerEligibility } from '../../src/domain/review.js';
import { SqliteOperationalHistoryRepository } from '../../src/adapters/sqlite/operational-history-repository.js';
import type { WebBoardSnapshot } from '../../src/interfaces/web/transport.js';

const fixture = await workflowBoard(4, { inProcess: true });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const [blockedIntegration, blockedActive, ordinary, retryable] = fixture.slugs;
  const history = new SqliteOperationalHistoryRepository(fixture.database);
  const recorder = new ExecutionActivityRecorder(new SqliteExecutionActivityStore(fixture.database, resolveCanonicalRepositoryId(fixture.root)));
  for (const slug of fixture.slugs) {
    const loaded = await fixture.store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') { throw new Error('Missing disposable Mission'); }
    const active = slug === blockedActive;
    // Held refined until supervision is done so lead never launches real work for it.
    if (slug === retryable) {
      await fixture.store.save(fixtureMission(slug, { repositoryId: loaded.mission.repositoryId, status: 'refined', assignee: agentFamily('codex') }), loaded.version);
      continue;
    }
    const revision = execFileSync('git', ['-C', fixture.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const reviewer = agentFamily('claude');
    const review = active ? null : applyReviewerCommand(startReview({
      change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
      revision: changeRevision(revision),
    }, reviewer, agentFamily('codex'), new Date().toISOString(),
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' })),
    { type: 'approve', revision: changeRevision(revision), decidedAt: new Date().toISOString(), comment: null, source: { kind: 'local' } });
    const mission = fixtureMission(slug, { repositoryId: loaded.mission.repositoryId,
      status: active ? 'active' : 'integration', assignee: agentFamily('codex'), review,
      checkpoints: active ? [{ missionId: missionId(slug), name: 'CP-1', goalCheck: [],
        nextActionText: 'Await operator design decision',
        repair: { incidentId: 'isolated-design-decision', command: 'npm test', authorizedGates: [],
          authorizedCriteria: [], attempt: 0, evidenceRecorded: false, verified: false,
          blocker: { command: 'npm test', diagnostic: 'Required operator design decision',
            authorityReason: 'Operator owns the contract', proposedCorrection: 'Operator must decide the design' } } }] : [],
    });
    await fixture.store.save(mission, loaded.version);
  }
  // Retain the approval but move its branch to a different landed change.
  const worktree = path.join(fixture.root, 'worktrees', blockedIntegration);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(worktree, 'changed-payload'), 'changed after approval\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', worktree, ...args], { stdio: 'pipe' });
  git('add', 'changed-payload');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'changed authority subject');
  await recorder.blocked({ missionId: missionId(blockedIntegration), operationId: 'isolated-human-stop',
    phase: 'integrate', summary: 'Review authority stop' },
  'Review authority is stale; operator must decide approval stand-down');
  const beforeHistory = JSON.stringify(await history.findAll());
  const beforeMissions = await Promise.all(fixture.slugs.map(slug => fixture.store.load(missionId(slug))));
  const observed = await fixture.observation.board();
  const integrationCard = observed.stages.flatMap(stage => stage.cards).find(card => card.id === blockedIntegration);
  assert.equal(integrationCard?.approvalCoverage?.kind, 'stale');
  assert.equal(observed.stages.flatMap(stage => stage.cards).find(card => card.id === ordinary)?.approvalCoverage?.kind, 'covers');
  assert.equal(integrationCard?.commands.find(command => command.command === 'active')?.enabled, false);
  assert.equal(integrationCard?.commands.find(command => command.command === 'integrate')?.enabled, true);
  const activeCard = observed.stages.flatMap(stage => stage.cards).find(card => card.id === blockedActive);
  assert.equal(activeCard?.commands.find(command => command.command === 'active')?.enabled, false, 'contract stop preserves explicit operator resume rather than automatic dispatch');
  const host = await fixture.start();
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--disable-extensions'] });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  await page.goto(host.origin);
  const rail = page.locator('[aria-labelledby="attention-heading"]');
  await rail.getByText('lead investigation', { exact: true }).first().waitFor();
  const snapshot = await (await page.request.get(host.origin + '/api/board')).json() as WebBoardSnapshot;
  for (const slug of [blockedIntegration, blockedActive]) {
    const item = snapshot.attentionQueue.find(item => item.missionId === slug);
    assert.equal(item?.action?.kind, 'manual');
    assert.equal(item?.action?.state, 'ineligible');
    const entry = rail.locator(`[data-board-card="${slug}"]`);
    assert.match(await entry.innerText(), /px lead .* --once/);
    assert.equal(await entry.locator('button').count(), 0);
    assert.doesNotMatch(await entry.innerText(), /\$ px (active|review|integrate)/, 'manual guidance must not render an executable command');
    console.log('BOARD', slug, JSON.stringify({ reason: item?.reason, action: item?.action }));
  }
  assert.equal(snapshot.attentionQueue.find(item => item.missionId === ordinary)?.action?.kind, 'integrate:merge');
  assert.match(await rail.locator(`[data-board-card="${ordinary}"]`).innerText(), new RegExp(`px integrate ${ordinary}`));
  console.log('BOARD', ordinary, 'px integrate handoff retained');
  const cli = path.resolve('build/px.mjs');
  for (const extra of [['--dry-run']]) {
    const output = execFileSync(process.execPath, [cli, 'lead', '--once', ...extra], {
      cwd: fixture.root, encoding: 'utf8', timeout: 30_000,
      env: { ...fixture.configuration.forwardedEnvironment, HOME: fixture.root,
        PARALLIX_HOME: fixture.root, PRIMARY_WORKTREE: fixture.root, PARALLIX_NO_TUI: '1' },
    });
    assert.match(output, /Review authority is stale/);
    assert.match(output, /Required operator design decision/);
    assert.match(output, /px lead .* --once/);
    assert.match(output, new RegExp(`px integrate ${ordinary}`));
    for (const slug of [blockedIntegration, blockedActive]) {
      assert.doesNotMatch(output, new RegExp(`board offers px (active|review|integrate) ${slug}`));
    }
    console.log('LEAD', extra.join(' ') || 'supervision', output.trim());
  }
  assert.equal(JSON.stringify(await history.findAll()), beforeHistory);
  assert.deepEqual(await Promise.all(fixture.slugs.map(slug => fixture.store.load(missionId(slug)))), beforeMissions);
  // Exercise the public CLI with real composition/store and only the agent
  // process boundary controlled. Never consult a model or open operator state.
  const controlledLead = `
    import assert from 'node:assert/strict';
    import { setWorkflowLaunchPort, setCommandPathProbe, setLauncherHealthProbe } from ${JSON.stringify(pathToFileURL(path.resolve('src/adapters/agents/agents.ts')).href)};
    import { run } from ${JSON.stringify(pathToFileURL(path.resolve('src/composition/create-cli.ts')).href)};
    setCommandPathProbe(() => '/controlled-provider');
    setLauncherHealthProbe(() => ({ ok: true }));
    // Controlled decision transport: bounded operator judgment admits recovery
    // for the investigation without contacting a model provider.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (!String(input).endsWith('/v1/systemone')) { return realFetch(input, init); }
      const { questions, state } = JSON.parse(String(init?.body));
      const choose = (id, selected) => {
        const labels = Object.keys(questions[id].criteria);
        assert.ok(labels.includes(selected), id + ' offers ' + selected);
        return { type: 'choice', choice: selected, confidence: 0.9,
          probabilities: Object.fromEntries(labels.map(label => [label, label === selected ? 1 : 0])) };
      };
      // Lane policy (TASK-2798) decides what judgment may offer; integration cannot continue.
      const action = state.allowedActions.includes('continue') ? 'continue' : 'escalate';
      console.log('CONTROLLED-JUDGMENT', state.missionId, action);
      return new Response(JSON.stringify({ model: 'controlled-fixture', answers: {
        action: choose('action', action), controls: choose('controls', 'standard') } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    setWorkflowLaunchPort(options => {
      assert.match(options.prompt, /No lifecycle command was dispatched/);
      assert.match(options.prompt, /must not acknowledge or clear an operator stop/);
      assert.equal(Boolean(options.resume), false);
      console.log('CONTROLLED-RECOVERY', options.slug);
      return { result: { status: 0, stdout: 'Decision: operator must choose the contract. Evidence: recorded authority stop. Options: retain or explicitly revise the contract. Recommended next step: inspect the recorded stop and decide.' } };
    });
    process.exitCode = await run(['lead', '--once', '--budget', '1'], {
      baseCwd: process.cwd(), environment: { ...process.env, TYPESAFE_API_KEY: 'controlled-fixture', JEV_CODE_PROVIDER: 'typesafe', TYPESAFE_BASE_URL: 'https://api.typesafe.ai' },
    });
  `;
  const supervised = spawnSync(process.execPath, ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href, '--input-type=module', '-e', controlledLead], {
    cwd: fixture.root, encoding: 'utf8', timeout: 30_000,
    env: { ...fixture.configuration.forwardedEnvironment, HOME: fixture.root,
      PARALLIX_HOME: fixture.root, PRIMARY_WORKTREE: fixture.root, PARALLIX_NO_TUI: '1' },
  });
  // Resolve tsx from this checkout, not the disposable repository.
  if (supervised.error) { throw supervised.error; }
  // An escalated item is an operator stop, so lead exits non-zero by design.
  assert.equal(supervised.status, 1, supervised.stdout + supervised.stderr);
  assert.equal((supervised.stdout.match(/CONTROLLED-JUDGMENT/g) ?? []).length, 2, supervised.stdout + supervised.stderr);
  assert.match(supervised.stdout, new RegExp(`CONTROLLED-JUDGMENT ${blockedIntegration} escalate`));
  assert.match(supervised.stdout, new RegExp(`CONTROLLED-JUDGMENT ${blockedActive} continue`));
  assert.deepEqual(supervised.stdout.match(/CONTROLLED-RECOVERY \S+/g), [`CONTROLLED-RECOVERY ${blockedActive}`], supervised.stdout + supervised.stderr);
  assert.match(supervised.stdout, new RegExp(`escalated +${blockedIntegration} +${blockedIntegration} needs an operator decision in lane integration: blocking: Review authority is stale`));
  assert.match(supervised.stdout, new RegExp(`No lifecycle command or recovery ran\\. Next: decide the recorded blocker, then rerun px lead ${blockedIntegration} --once`));
  assert.doesNotMatch(supervised.stdout, /Started px (active|review|integrate)/);
  assert.deepEqual(await Promise.all(fixture.slugs.map(slug => fixture.store.load(missionId(slug)))), beforeMissions);
  const afterInvestigation = await fixture.observation.board();
  for (const slug of [blockedIntegration, blockedActive]) {
    assert.equal(afterInvestigation.attentionQueue.find(item => item.missionId === slug)?.action?.kind, 'manual',
      'read-only investigation must not erase a durable blocker');
  }
  console.log('LEAD controlled supervision', supervised.stdout.trim());
  // Control: an ordinary blocked active run keeps its executable retry (dry-run only).
  const held = await fixture.store.load(missionId(retryable));
  if (held.kind !== 'found' || held.mission.status !== 'refined') { throw new Error('Missing disposable refined Mission'); }
  await fixture.store.save({ ...held.mission, status: 'active' }, held.version);
  await recorder.blocked({ missionId: missionId(retryable), operationId: 'isolated-agent-failure',
    phase: 'execute', summary: 'Agent run failed' }, 'agent exited with status 1');
  const retrySnapshot = await (await page.request.get(host.origin + '/api/board')).json() as WebBoardSnapshot;
  const retryItem = retrySnapshot.attentionQueue.find(item => item.missionId === retryable);
  assert.equal(retryItem?.action?.kind, 'active:execute');
  assert.equal(retryItem?.action?.display, `px active ${retryable}`);
  console.log('BOARD', retryable, JSON.stringify({ reason: retryItem?.reason, action: retryItem?.action }));
  const retryLead = execFileSync(process.execPath, [cli, 'lead', '--once', '--dry-run'], {
    cwd: fixture.root, encoding: 'utf8', timeout: 30_000,
    env: { ...fixture.configuration.forwardedEnvironment, HOME: fixture.root,
      PARALLIX_HOME: fixture.root, PRIMARY_WORKTREE: fixture.root, PARALLIX_NO_TUI: '1' },
  });
  assert.match(retryLead, new RegExp(`${retryable} .*agent exited with status 1; board offers px active ${retryable}`));
  console.log('LEAD --dry-run control', retryLead.trim().split('\n').find(line => line.includes(retryable)));
  console.log('PASS: browser board, public lead dry-run and controlled public-CLI supervision agree; both blockers reach bounded judgment without lifecycle dispatch, the active blocker gets one recovery and the integration blocker escalates, unresolved blockers remain visible, approval and Mission versions unchanged; no real operator state opened.');
} finally {
  await browser?.close();
  await fixture.close();
}
