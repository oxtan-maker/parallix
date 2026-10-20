// Board-admitted integration resolves its mission and receiving base checkouts
// from the mission identity, not from the checkout or working directory of the
// host that admitted it (TASK-2777). Real git repositories; no Forgejo, no agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveMissionExecutionContext } from '../../../src/adapters/git/mission-execution-context.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { runWorkflowWorker, type composeWorkflowOperations } from '../../../src/composition/workflow-operations.js';
import { createBoardIntegrateService } from '../../../src/composition/application-services.js';
import { NO_CURRENT_WORK_PORT } from '../../../src/application/recording/current-work-recorder.js';
import { setLogger } from '../../../src/application/presentation/cli-format.js';
import type { WorkflowOperationRecord as WorkflowOperation } from '../../../src/application/ports/workflow-operation.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A primary checkout on main (the web host's root) plus one worktree per mission. */
function repository(t: test.TestContext, slugs: readonly string[]) {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'px-execution-context-')));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const primary = path.join(parent, 'repo');
  fs.mkdirSync(primary);
  git(primary, 'init', '-q', '-b', 'main');
  git(primary, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'base');
  const worktrees = Object.fromEntries(slugs.map(slug => {
    const worktree = path.join(parent, `repo-${slug}`);
    git(primary, 'worktree', 'add', '-q', '-b', `mission/${slug}`, worktree);
    return [slug, worktree];
  }));
  const configuration = resolveConfiguration({ PRIMARY_WORKTREE: primary, PATH: process.env.PATH, HOME: parent });
  return { primary, worktrees, configuration };
}

/** Supervise one board-admitted operation; the injected host records where the executor would run. */
async function supervise(slug: string, root: string, configuration: ReturnType<typeof resolveConfiguration>, command: WorkflowOperation['command'] = 'integrate:merge', invocation?: WorkflowOperation['invocation']) {
  let operation = { id: `operation-${slug}`, missionId: slug, repositoryId: 'repo', command, invocation, phase: 'accepted', owner: null, generation: 0 } as unknown as WorkflowOperation;
  const service = {
    operation: async () => operation,
    reserveLaunch: async () => true,
    recover: async () => {},
    startupFailed: async (_id: string, reason: string) => { if (operation.phase === 'accepted') { operation = { ...operation, phase: 'blocked', reason }; } },
  };
  const compose = async () => ({ service, close: async () => {} }) as unknown as Awaited<ReturnType<typeof composeWorkflowOperations>>;
  const output: string[] = [];
  const executed: string[] = [];
  const code = await runWorkflowWorker(operation.id, root, configuration, false, async () => { throw new Error('Supervisor builds no graph'); }, {
    compose, worktree: () => null,
    capture: (() => ({ correlateOperation: () => {}, write: (_stream: string, chunk: Buffer) => { output.push(String(chunk)); }, finish: () => {} })) as never,
    host: async (_cli, _operation, checkout) => { executed.push(checkout); return { exitCode: 0, signal: null }; },
  });
  return { code, executed, operation: () => operation, output: output.join('') };
}

test('a host rooted on main executes board integration in the mission worktree without changing its cwd (TASK-2777)', async t => {
  const fixture = repository(t, ['task-97771']);
  const cwd = process.cwd();
  const result = await supervise('task-97771', fixture.primary, fixture.configuration);
  assert.deepEqual(result.executed, [fixture.worktrees['task-97771']]);
  assert.equal(process.cwd(), cwd);
});

test('board integration preflight reads the resolved mission branch, not the host checkout branch (TASK-2777)', async t => {
  const fixture = repository(t, ['task-97772']);
  const lines: string[] = [];
  const previous = setLogger({ log: (message: unknown) => { lines.push(String(message)); }, error: (message: unknown) => { lines.push(String(message)); } });
  t.after(() => { setLogger(previous); });
  // No recorded brief and no mission document: preflight reports that blocker,
  // so the run stops at preflight and never reaches gates or landing.
  const store = { load: async () => ({ kind: 'found', version: 1, mission: { id: 'task-97772', status: 'integration', labels: ['ai_sdlc'], brief: null, review: null, checkpoints: [] } }) };
  const cwd = process.cwd();
  const service = createBoardIntegrateService({ store } as never, NO_CURRENT_WORK_PORT, fixture.configuration, fixture.primary);
  await assert.rejects(service.execute(['task-97772', '--dry-run']), /exited with code 1/);
  const output = lines.join('\n');
  assert.match(output, /Integration preflight failed/);
  assert.match(output, /Mission doc: .* not found/);
  assert.doesNotMatch(output, /Mission branch: current branch/);
  assert.doesNotMatch(output, /Backlog context: does not resolve/);
  assert.equal(process.cwd(), cwd);
});

test('a removed mission worktree settles the operation with a reason naming the mission and fact before any executor (TASK-2777)', async t => {
  const fixture = repository(t, ['task-97773']);
  fs.rmSync(fixture.worktrees['task-97773'], { recursive: true, force: true });
  const result = await supervise('task-97773', fixture.primary, fixture.configuration);
  assert.equal(result.code, 1);
  assert.deepEqual(result.executed, []);
  assert.equal(result.operation().phase, 'blocked');
  assert.match(result.operation().reason!, /^Mission task-97773: mission worktree .*repo-task-97773 for mission\/task-97773 is missing/);
  assert.match(result.output, /Mission task-97773: mission worktree/);
});

test('a mission worktree on the wrong branch settles the operation before any executor (TASK-2777)', async t => {
  const fixture = repository(t, ['task-97774']);
  git(fixture.worktrees['task-97774'], 'checkout', '-q', '-b', 'scratch');
  const result = await supervise('task-97774', fixture.primary, fixture.configuration);
  assert.equal(result.code, 1);
  assert.deepEqual(result.executed, []);
  assert.match(result.operation().reason!, /^Mission task-97774: mission worktree .*repo-task-97774 is on scratch, expected mission\/task-97774\.$/);
});

test('an unresolvable receiving base settles the operation before any executor (TASK-2777)', async t => {
  const fixture = repository(t, ['task-97775']);
  git(fixture.primary, 'config', 'branch.mission/task-97775.parallixBase', 'feature/absent');
  const result = await supervise('task-97775', fixture.primary, fixture.configuration);
  assert.equal(result.code, 1);
  assert.deepEqual(result.executed, []);
  assert.match(result.operation().reason!, /^Mission task-97775: receiving base worktree for feature\/absent cannot be resolved: .*does not exist locally/);
});

test('concurrent board integrations each execute in their own mission worktree (TASK-2777)', async t => {
  const fixture = repository(t, ['task-97776', 'task-97777']);
  const bases = ['task-97776', 'task-97777'].map(slug => {
    const baseWorktree = `${fixture.primary}-base-${slug}`;
    const baseBranch = `base/${slug}`;
    git(fixture.primary, 'worktree', 'add', '-q', '-b', baseBranch, baseWorktree);
    git(fixture.primary, 'config', `branch.mission/${slug}.parallixBase`, baseBranch);
    return { slug, baseWorktree, baseBranch };
  });
  const cwd = process.cwd();
  const [first, second] = await Promise.all(bases.map(async ({ slug, baseWorktree, baseBranch }) => {
    const resolution = resolveMissionExecutionContext(slug, fixture.primary, fixture.configuration);
    assert.equal(resolution.ok, true);
    if (resolution.ok) {
      assert.deepEqual(resolution.context, { missionId: slug, missionWorktree: fixture.worktrees[slug],
        missionBranch: `mission/${slug}`, baseWorktree, baseBranch });
    }
    return supervise(slug, fixture.primary, fixture.configuration);
  }));
  assert.deepEqual(first.executed, [fixture.worktrees['task-97776']]);
  assert.deepEqual(second.executed, [fixture.worktrees['task-97777']]);
  assert.equal(process.cwd(), cwd);
});

test('board integration with a resolved context keeps every preflight safeguard and the integration claim (TASK-2777)', async t => {
  const slug = 'task-97778';
  const fixture = repository(t, [slug]);
  const worktree = fixture.worktrees[slug];
  fs.mkdirSync(path.join(worktree, 'backlog/tasks'), { recursive: true });
  fs.writeFileSync(path.join(worktree, `backlog/tasks/${slug} - Fixture.md`), `---\nid: ${slug.toUpperCase()}\ntitle: Fixture\nstatus: review\n---\n`);
  fs.writeFileSync(path.join(worktree, 'payload.txt'), 'mission\n');
  git(worktree, 'add', '.');
  git(worktree, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'payload');
  // The receiving base holds an overlapping untracked payload and an unfinished rebase.
  fs.writeFileSync(path.join(fixture.primary, 'payload.txt'), 'local\n');
  fs.mkdirSync(path.join(fixture.primary, '.git/rebase-merge'));
  const lines: string[] = [];
  const previous = setLogger({ log: (message: unknown) => { lines.push(String(message)); }, error: (message: unknown) => { lines.push(String(message)); } });
  t.after(() => { setLogger(previous); });
  const store = { load: async () => ({ kind: 'found', version: 1, mission: { id: slug, status: 'review', labels: ['ai_sdlc'], brief: { goal: 'g' }, review: null, checkpoints: [] } }) };
  const service = createBoardIntegrateService({ store } as never, NO_CURRENT_WORK_PORT, fixture.configuration, fixture.primary);
  await assert.rejects(service.execute([slug, '--dry-run']), /exited with code 1/);
  const output = lines.join('\n');
  assert.doesNotMatch(output, /Mission branch: current branch/);
  assert.match(output, /Mission status: expected approved, or review with an approved Forgejo PR; found review/);
  assert.match(output, /Integration checkout rebase: rebase in progress/);
  assert.match(output, /overlapping paths detected/);
  assert.match(output, /Integration preflight failed/);
  // A competing integration claim still refuses before any context is read.
  const { createIntegratePorts } = await import('../../../src/adapters/cli/commands/integrate.js');
  const release = await createIntegratePorts(fixture.configuration).process.claimIntegration(slug);
  assert.ok(release);
  t.after(() => release());
  lines.length = 0;
  await assert.rejects(service.execute([slug, '--dry-run']), /exited with code 1/);
  assert.match(lines.join('\n'), new RegExp(`Integration of ${slug} is already running in another process`));
});

test('base-started console execute, handoff, review and retry resolve Mission context (TASK-2778)', async t => {
  const fixture = repository(t, ['task-97778']);
  const before = git(fixture.primary, 'status', '--porcelain');
  for (const command of ['active:execute', 'handoff:record', 'review:submit', 'integrate:merge'] as const) {
    const result = await supervise('task-97778', fixture.primary, fixture.configuration, command,
      command === 'active:execute' ? undefined : {
        command: command === 'integrate:merge' ? 'integrate' : 'review', args: ['task-97778'], interactive: true,
      });
    assert.deepEqual(result.executed, [fixture.worktrees['task-97778']]);
  }
  assert.equal(git(fixture.primary, 'status', '--porcelain'), before);
  assert.equal(git(fixture.primary, 'branch', '--show-current').trim(), 'main');
});
