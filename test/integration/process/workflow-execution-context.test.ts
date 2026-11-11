// Board-admitted integration resolves its mission and receiving base checkouts
// from the mission identity, not from the checkout or working directory of the
// host that admitted it (TASK-2777). Real git repositories; no Forgejo, no agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as gitModule from '../../../src/adapters/git/git.js';
import { resolveMissionExecutionContext } from '../../../src/adapters/git/mission-execution-context.js';
import { findLandedSquashOnBaseBranch } from '../../../src/adapters/cli/commands/landed-squash.js';
import { conventionalBaseWorktreePath } from '../../../src/adapters/git/worktree.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { runWorkflowWorker, type composeWorkflowOperations } from '../../../src/composition/workflow-operations.js';
import { createBoardIntegrateService } from '../../../src/composition/application-services.js';
import { NO_EXECUTION_ACTIVITY } from '../../../src/application/recording/execution-activity-recorder.js';
import { setLogger } from '../../../src/application/presentation/cli-format.js';
import type { WorkflowOperationRecord as WorkflowOperation } from '../../../src/application/ports/workflow-operation.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

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
  const service = createBoardIntegrateService({ store } as never, NO_EXECUTION_ACTIVITY, fixture.configuration, fixture.primary);
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

test('a detached paused rebase retains its mission execution identity from a nested launch path (px-0042.02 F1/F13)', t => {
  const slug = 'task-97774-rebase';
  const fixture = repository(t, [slug]);
  const worktree = path.join(path.dirname(fixture.primary), 'arbitrary-mission-checkout');
  git(fixture.primary, 'worktree', 'move', fixture.worktrees[slug], worktree);
  fs.writeFileSync(path.join(worktree, 'conflict.txt'), 'mission\n');
  git(worktree, 'add', 'conflict.txt');
  git(worktree, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'mission');
  fs.writeFileSync(path.join(fixture.primary, 'conflict.txt'), 'main\n');
  git(fixture.primary, 'add', 'conflict.txt');
  git(fixture.primary, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'main');
  assert.throws(() => git(worktree, 'rebase', 'main'));
  assert.equal(git(worktree, 'branch', '--show-current'), '');
  const rootResolution = resolveMissionExecutionContext(slug, worktree, fixture.configuration);
  assert.equal(rootResolution.ok, true);
  if (rootResolution.ok) { assert.equal(rootResolution.context.missionWorktree, worktree); }
  const nested = path.join(worktree, 'nested', 'launch-directory');
  fs.mkdirSync(nested, { recursive: true });
  const nestedResolution = resolveMissionExecutionContext(slug, nested, fixture.configuration);
  assert.equal(nestedResolution.ok, true);
  if (nestedResolution.ok) { assert.equal(nestedResolution.context.missionWorktree, worktree); }
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
  const service = createBoardIntegrateService({ store } as never, NO_EXECUTION_ACTIVITY, fixture.configuration, fixture.primary);
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

test("base-started console execute, review preparation, review and retry resolve Mission context (TASK-2778)", async t => {
  const fixture = repository(t, ['task-97778']);
  const before = git(fixture.primary, 'status', '--porcelain');
  for (const command of ['active:execute', 'review:submit', 'review:submit', 'integrate:merge'] as const) {
    const result = await supervise('task-97778', fixture.primary, fixture.configuration, command,
      command === 'active:execute' ? undefined : {
        command: command === 'integrate:merge' ? 'integrate' : 'review', args: ['task-97778'], interactive: true,
      });
    assert.deepEqual(result.executed, [fixture.worktrees['task-97778']]);
  }
  assert.equal(git(fixture.primary, 'status', '--porcelain'), before);
  assert.equal(git(fixture.primary, 'branch', '--show-current').trim(), 'main');
});

test('a sibling mission cwd, a non-main receiving base and a linked worktree path with spaces resolve to one identity pair (TASK-2777)', async t => {
  const slug = 'task-97779';
  const fixture = repository(t, [slug]);
  // A linked worktree is where a mission checkout actually lives on a workstation:
  // an arbitrary path, spaces included, registered through a symlinked parent.
  const parent = path.dirname(fixture.primary);
  const linked = path.join(parent, 'linked parent', `${slug} wt`);
  const baseWorktree = path.join(parent, 'linked parent', 'base wt');
  git(fixture.primary, 'worktree', 'add', '-q', '-b', 'base/paid', baseWorktree);
  git(fixture.primary, 'worktree', 'move', fixture.worktrees[slug], linked);
  git(fixture.primary, 'config', `branch.mission/${slug}.parallixBase`, 'base/paid');
  fs.symlinkSync(path.join(parent, 'linked parent'), path.join(parent, 'link'));
  const expected = { missionId: slug, missionWorktree: linked, missionBranch: `mission/${slug}`, baseWorktree, baseBranch: 'base/paid' };
  // The host that admits the operation may stand anywhere in the repository.
  for (const root of [fixture.primary, linked, baseWorktree, path.join(parent, 'link', 'base wt')]) {
    const resolution = resolveMissionExecutionContext(slug, root, fixture.configuration);
    assert.equal(resolution.ok, true, resolution.ok ? '' : resolution.reason);
    if (resolution.ok) { assert.deepEqual(resolution.context, expected); }
  }
});

test('a removed mission checkout stays a failure until the landing on the receiving base proves the closeout (TASK-2777)', async t => {
  const slug = 'task-97780';
  const fixture = repository(t, [slug]);
  // Integration landed the squash on the receiving base and closeout removed the
  // checkout; the commit is the durable evidence, so recovery still resolves.
  git(fixture.primary, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', `Fixture landing\n\nTask: ${slug}\n`);
  fs.rmSync(fixture.worktrees[slug], { recursive: true, force: true });
  // Without the landing probe the same repository state is the ordinary missing
  // checkout failure; a removed checkout is never assumed to be a landing.
  const unproven = resolveMissionExecutionContext(slug, fixture.primary, fixture.configuration);
  assert.equal(unproven.ok, false);
  assert.match(unproven.reason!, /mission worktree .* for mission\/task-97780 is missing/);
  const recovered = resolveMissionExecutionContext(slug, fixture.primary, fixture.configuration,
    args => gitModule.git(args), (base, landedSlug) => findLandedSquashOnBaseBranch(base, landedSlug));
  assert.equal(recovered.ok, true, recovered.ok ? '' : recovered.reason);
  if (recovered.ok) {
    assert.deepEqual(recovered.context, { missionId: slug, missionWorktree: null, missionBranch: `mission/${slug}`, baseWorktree: fixture.primary, baseBranch: 'main' });
  }
  // A supervisor settles the operation with the closeout command instead of
  // running the executor in the receiving base checkout.
  const result = await supervise(slug, fixture.primary, fixture.configuration);
  assert.equal(result.code, 1);
  assert.deepEqual(result.executed, []);
  assert.match(result.operation().reason!, new RegExp(`Mission ${slug}: its landing is proven on main, but no mission checkout remains\\. Run px integrate ${slug} --recover-landed to finish closeout\\.$`));
});

test('a root from an unrelated repository fails instead of resolving through the configured primary checkout (TASK-2777)', async t => {
  const slug = 'task-97782';
  // Repository A owns the mission checkout and the configured primary identity.
  const fixture = repository(t, [slug]);
  const otherParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'px-unrelated-repo-')));
  t.after(() => fs.rmSync(otherParent, { recursive: true, force: true }));
  const other = path.join(otherParent, 'repo');
  fs.mkdirSync(other);
  git(other, 'init', '-q', '-b', 'main');
  git(other, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'base');
  // Repository B is a different repository that never held this Mission, so the
  // PRIMARY_WORKTREE override must not carry the resolution across the boundary.
  const resolution = resolveMissionExecutionContext(slug, other, fixture.configuration);
  assert.equal(resolution.ok, false);
  assert.match(resolution.reason!, new RegExp(`Mission ${slug}: no worktree is checked out on mission/${slug} in the repository at ${escapeRegExp(other)}`));
  assert.ok(!resolution.reason!.includes(fixture.primary), `resolution reached outside the root repository: ${resolution.reason}`);
});

test('a recorded non-main base is checked out beside its own repository only once the mission identity is established (TASK-2777)', async t => {
  const slug = 'task-97783';
  const fixture = repository(t, [slug]);
  // The configured primary checkout belongs to another repository: the base
  // worktree ADR 0045 auto-creates must still land beside this repository.
  const otherParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'px-unrelated-repo-')));
  t.after(() => fs.rmSync(otherParent, { recursive: true, force: true }));
  const other = path.join(otherParent, 'repo');
  fs.mkdirSync(other);
  git(other, 'init', '-q', '-b', 'main');
  const configuration = resolveConfiguration({ PRIMARY_WORKTREE: other, PATH: process.env.PATH, HOME: otherParent });
  git(fixture.primary, 'branch', 'base/paid');
  git(fixture.primary, 'config', `branch.mission/${slug}.parallixBase`, 'base/paid');
  const probe = (base: string, landedSlug: string) => findLandedSquashOnBaseBranch(base, landedSlug);
  const worktrees = () => git(fixture.primary, 'worktree', 'list', '--porcelain');
  // Temporarily hide the registered checkout: an unproven removal is a failure,
  // and probing the base branch adds no checkout. Restoring the same checkout
  // then exercises the live path without paying for an unrelated second mission.
  const hiddenWorktree = `${fixture.worktrees[slug]}-hidden`;
  fs.renameSync(fixture.worktrees[slug], hiddenWorktree);
  const start = worktrees();
  const unproven = resolveMissionExecutionContext(slug, fixture.primary, configuration, args => gitModule.git(args), probe);
  assert.equal(unproven.ok, false);
  assert.match(unproven.reason!, new RegExp(`Mission ${slug}: mission worktree .* for mission/${slug} is missing`));
  assert.equal(worktrees(), start, 'an unproven removal must not add a checkout');
  fs.renameSync(hiddenWorktree, fixture.worktrees[slug]);
  // A live mission whose recorded base exists but is not checked out gets it at the conventional path.
  const expectedBase = conventionalBaseWorktreePath('base/paid', fixture.primary);
  const live = resolveMissionExecutionContext(slug, fixture.primary, configuration);
  assert.equal(live.ok, true, live.ok ? '' : live.reason);
  if (live.ok) { assert.deepEqual(live.context, { missionId: slug, missionWorktree: fixture.worktrees[slug], missionBranch: `mission/${slug}`, baseWorktree: expectedBase, baseBranch: 'base/paid' }); }
  assert.equal(git(expectedBase, 'branch', '--show-current'), 'base/paid');
  const created = worktrees();
  assert.equal(resolveMissionExecutionContext(slug, fixture.primary, configuration).ok, true);
  assert.equal(worktrees(), created, 'a second resolution reuses the base checkout');
  assert.doesNotMatch(git(other, 'worktree', 'list', '--porcelain'), /base-base-paid/);
  // Once the landing on the base is proven, a removed base checkout is recreated for the closeout.
  git(expectedBase, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', `Fixture landing\n\nTask: ${slug}\n`);
  git(fixture.primary, 'worktree', 'remove', expectedBase);
  fs.rmSync(fixture.worktrees[slug], { recursive: true, force: true });
  const proven = resolveMissionExecutionContext(slug, fixture.primary, configuration, args => gitModule.git(args), probe);
  assert.equal(proven.ok, true, proven.ok ? '' : proven.reason);
  if (proven.ok) { assert.deepEqual(proven.context, { missionId: slug, missionWorktree: null, missionBranch: `mission/${slug}`, baseWorktree: expectedBase, baseBranch: 'base/paid' }); }
});

test('a terminal integrate run with an unresolved context runs nothing, mutates nothing and releases its claim (TASK-2777)', async t => {
  const slug = 'task-97781';
  const fixture = repository(t, [slug]);
  fs.rmSync(fixture.worktrees[slug], { recursive: true, force: true });
  const before = { status: git(fixture.primary, 'status', '--porcelain'), worktrees: git(fixture.primary, 'worktree', 'list', '--porcelain'), branch: git(fixture.primary, 'branch', '--show-current') };
  const { createIntegratePorts } = await import('../../../src/adapters/cli/commands/integrate.js');
  const { runIntegrateEntry } = await import('../../../src/application/integrate-entry.js');
  const ports = createIntegratePorts(fixture.configuration);
  ports.process.cwd = () => fixture.primary;
  let stepsRun = 0;
  const steps = { runIntegration: async () => { stepsRun++; return 0 as const; }, restoreTemporaryStash: () => 0 as const };
  const lines: string[] = [];
  const previous = setLogger({ log: (message: unknown) => { lines.push(String(message)); }, error: (message: unknown) => { lines.push(String(message)); } });
  t.after(() => { setLogger(previous); });
  const result = await runIntegrateEntry([slug], { configuration: fixture.configuration, exitFn: () => {} }, ports, steps);
  assert.deepEqual(result, { exitCode: 1 });
  assert.equal(stepsRun, 0);
  assert.match(lines.join('\n'), new RegExp(`Mission ${slug}: mission worktree .* is missing`));
  // The claim taken for the run is released on the failed resolution, so the operator can retry immediately.
  const release = await createIntegratePorts(fixture.configuration).process.claimIntegration(slug);
  assert.ok(release);
  release();
  assert.deepEqual({ status: git(fixture.primary, 'status', '--porcelain'), worktrees: git(fixture.primary, 'worktree', 'list', '--porcelain'), branch: git(fixture.primary, 'branch', '--show-current') }, before);
});

test('a terminal integrate run that loses the exclusive claim adds no base worktree (TASK-2777)', async t => {
  const slug = 'task-97785';
  const fixture = repository(t, [slug]);
  git(fixture.primary, 'branch', 'base/paid');
  git(fixture.primary, 'config', `branch.mission/${slug}.parallixBase`, 'base/paid');
  const { createIntegratePorts } = await import('../../../src/adapters/cli/commands/integrate.js');
  const { runIntegrateEntry } = await import('../../../src/application/integrate-entry.js');
  const ports = createIntegratePorts(fixture.configuration);
  ports.process.cwd = () => fixture.primary;
  const held = await createIntegratePorts(fixture.configuration).process.claimIntegration(slug);
  assert.ok(held);
  t.after(() => { void held(); });
  const worktrees = () => git(fixture.primary, 'worktree', 'list', '--porcelain');
  const before = worktrees();
  let stepsRun = 0;
  const steps = { runIntegration: async () => { stepsRun++; return 0 as const; }, restoreTemporaryStash: () => 0 as const };
  const lines: string[] = [];
  const previous = setLogger({ log: (message: unknown) => { lines.push(String(message)); }, error: (message: unknown) => { lines.push(String(message)); } });
  t.after(() => { setLogger(previous); });
  const result = await runIntegrateEntry([slug], { configuration: fixture.configuration, exitFn: () => {} }, ports, steps);
  assert.deepEqual(result, { exitCode: 1 });
  assert.equal(stepsRun, 0);
  assert.match(lines.join('\n'), /already running in another process/);
  assert.equal(worktrees(), before, 'the losing run must not add the recorded base checkout');
});

test('a primary checkout on another branch is never labelled the receiving base worktree (TASK-2777)', async t => {
  const [landedSlug, liveSlug] = ['task-97786', 'task-97787'];
  const fixture = repository(t, [landedSlug, liveSlug]);
  const probe = (base: string, slug: string) => findLandedSquashOnBaseBranch(base, slug);
  git(fixture.primary, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', `Fixture landing\n\nTask: ${landedSlug}\n`);
  fs.rmSync(fixture.worktrees[landedSlug], { recursive: true, force: true });
  git(fixture.primary, 'checkout', '-q', '-b', 'scratch');
  const worktrees = () => git(fixture.primary, 'worktree', 'list', '--porcelain');
  const before = worktrees();
  for (const [slug, proof] of [[landedSlug, probe], [liveSlug, undefined]] as const) {
    const resolved = resolveMissionExecutionContext(slug, fixture.primary, fixture.configuration, args => gitModule.git(args), proof);
    assert.equal(resolved.ok, false, `${slug} must not resolve against a primary checkout on scratch`);
    if (!resolved.ok) { assert.match(resolved.reason, /receiving base main is not checked out: the repository checkout .* is on scratch/); }
  }
  assert.equal(worktrees(), before);
});

test('board admission and its supervisor add no base worktree before the shared integration claim is won (TASK-2777)', async t => {
  const slug = 'task-97788';
  const fixture = repository(t, [slug]);
  git(fixture.primary, 'branch', 'base/paid');
  git(fixture.primary, 'config', `branch.mission/${slug}.parallixBase`, 'base/paid');
  const worktrees = () => git(fixture.primary, 'worktree', 'list', '--porcelain');
  const before = worktrees();
  // The supervisor hosts the executor in the mission checkout and only observes.
  const supervised = await supervise(slug, fixture.primary, fixture.configuration);
  assert.deepEqual(supervised.executed, [fixture.worktrees[slug]]);
  assert.equal(worktrees(), before, 'the supervisor must not add the recorded base checkout');
  // A terminal integrate already holds the claim: the board run loses it before any Git mutation.
  const { createIntegratePorts } = await import('../../../src/adapters/cli/commands/integrate.js');
  const held = await createIntegratePorts(fixture.configuration).process.claimIntegration(slug);
  assert.ok(held);
  t.after(() => { void held(); });
  const lines: string[] = [];
  const previous = setLogger({ log: (message: unknown) => { lines.push(String(message)); }, error: (message: unknown) => { lines.push(String(message)); } });
  t.after(() => { setLogger(previous); });
  const store = { load: async () => ({ kind: 'found', version: 1, mission: { id: slug, status: 'integration', labels: ['ai_sdlc'], brief: null, review: null, checkpoints: [] } }) };
  const service = createBoardIntegrateService({ store } as never, NO_EXECUTION_ACTIVITY, fixture.configuration, fixture.primary);
  await assert.rejects(service.execute([slug, '--dry-run']), /exited with code 1/);
  assert.match(lines.join('\n'), new RegExp(`Integration of ${slug} is already running in another process`));
  assert.equal(worktrees(), before, 'the losing board run must not add the recorded base checkout');
});
