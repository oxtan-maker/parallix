/** Disposable production-workflow study support. No tests register on import. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { resolveCanonicalRepositoryId } from '../src/adapters/git/repository-identity.js';
import { fixtureMission } from '../test/fixtures/mission-builders.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';

export const studySourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const studyCli = ['--import', path.join(studySourceRoot, 'node_modules/tsx/dist/loader.mjs'), path.join(studySourceRoot, 'src/entry/px.ts')];
export function studyGit(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) { throw new Error(`Fixture Git failed: ${args.join(' ')}: ${r.stderr}`); }
  return r.stdout.trim();
}
export async function openLeadWorkflowFixture(registerRoot?: (_root: string) => unknown) {
  // Same low-level owners as integration-repair-fixture; independent schema and
  // no node:test hooks, global cwd changes or real operator caches.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-workflow-study-'));
  const repo = path.join(root, 'repo'); const slug = 'task-study-repair';
  const worktree = path.join(root, `repo-${slug}`); const home = path.join(root, 'operator');
  const bin = path.join(root, 'bin'); const database = new SqliteDatabaseAdapter();
  try {
    registerRoot?.(root);
    for (const dir of [repo, home, bin, path.join(root, 'home'), path.join(repo, 'config'), path.join(repo, 'scripts'), path.join(repo, 'backlog/tasks')]) { fs.mkdirSync(dir, { recursive: true }); }
    // Even an unexpected preflight regression cannot reach a real coding runner.
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\necho "Offline fixture refuses unexpected coding launch" >&2\nexit 1\n');
    fs.chmodSync(path.join(bin, 'codex'), 0o755);
    const gate = './scripts/verify.sh';
    fs.writeFileSync(path.join(repo, 'scripts/verify.sh'), '#!/bin/sh\nprintf "gate\\n" >> .workflow/gate-observations\ntest "$(cat target.txt)" = "repaired target"\n');
    fs.chmodSync(path.join(repo, 'scripts/verify.sh'), 0o755);
    fs.writeFileSync(path.join(repo, 'target.txt'), 'broken target\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), '.workflow/\n');
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'Only repair target.txt and reattach the existing Mission branch. Preserve the locked gate and review history. Use public px commands.\n');
    fs.writeFileSync(path.join(repo, 'config/state-map.json'), JSON.stringify({ ready: 'refined', approved: 'ready-for-integration' }));
    fs.copyFileSync(path.join(studySourceRoot, 'config/agents.json'), path.join(repo, 'config/agents.json'));
    fs.writeFileSync(path.join(home, 'agents.local.json'), JSON.stringify({ blocklist: Object.fromEntries(['claude', 'qwen', 'vibe', 'custom'].map(f => [f, { blocked: true }])) }));
    fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({ adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      missions: { branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      review: { provider: 'none' }, verification: { command: gate, defaultArea: 'all' },
      agents: { models: { codex: 'offline-scripted-boundary' } },
    } }));
    fs.writeFileSync(path.join(repo, `backlog/tasks/${slug} - Study.md`), `---\nid: ${slug.toUpperCase()}\ntitle: Study\nstatus: active\nassignee: [codex]\nlabels: []\n---\n`);
    studyGit(repo, 'init', '-qb', 'main'); studyGit(repo, 'config', 'user.name', 'Study'); studyGit(repo, 'config', 'user.email', 'study@example.invalid');
    studyGit(repo, 'add', '.'); studyGit(repo, 'commit', '-qm', 'immutable study fixture');
    studyGit(repo, 'worktree', 'add', '-qb', `mission/${slug}`, worktree);
    fs.mkdirSync(path.join(worktree, '.workflow'), { recursive: true });
    const gateHash = studyGit(worktree, 'hash-object', 'scripts/verify.sh');
    const baseHead = studyGit(repo, 'rev-parse', 'HEAD');
    await database.open({ path: path.join(home, 'parallix.db') });
    await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(database);
    const mission = fixtureMission(slug, { repositoryId: resolveCanonicalRepositoryId(repo), assignee: agentFamily('codex'),
      brief: { goal: 'Repair target.txt and restore the supported workflow', why: 'Disposable recovery comparison', scope: 'target.txt and worktree attachment', outOfScope: ['gates', 'approval', 'integration'] },
      successCriteria: ['Target is repaired'], completedSuccessCriteria: [0], declaredGates: [gate],
      checkpoints: [{ missionId: missionId(slug), name: 'CP-1', rawFilename: 'CP-1.md', firstLine: 'CP-1', goalCheck: [{ criterion: 'Target is repaired', evidence: 'target.txt' }], nextActionText: 'Run exact gate and independent review' }],
    });
    await store.save(mission, null);
    // Keep all retained content and branch identity; only attachment is broken.
    studyGit(worktree, 'checkout', '--detach');
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: path.join(root, 'home'), PARALLIX_HOME: home, PRIMARY_WORKTREE: repo,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`, PARALLIX_TERMINAL_STATE_DIR: path.join(root, 'terminal'), PARALLIX_CUSTOM_ADMISSION_HOME: path.join(root, 'admission'),
      CODEX_HOME: path.join(root, 'codex'), PARALLIX_NO_BUBBLEWRAP: '1' };
    // This offline fixture cannot spend credentials or inherit worker authority.
    for (const key of Object.keys(env)) { if (/API_KEY|TOKEN|SECRET|PARALLIX_WORKFLOW_|PARALLIX_CLI_COMMAND/.test(key)) { delete env[key]; } }
    const load = async () => { const r = await store.load(missionId(slug)); if (r.kind !== 'found') { throw new Error('Study Mission lost'); } return r.mission; };
    const before = await load();
    return { root, repo, worktree, slug, env, bin, database, load, before, baseHead, gateHash,
      invoke: (...args: string[]) => spawnSync(process.execPath, [...studyCli, ...args], { cwd: repo, env, encoding: 'utf8', timeout: 15000 }),
      async observe() {
        const mission = await load();
        const gateRun = spawnSync('sh', ['scripts/verify.sh'], { cwd: worktree, env, encoding: 'utf8', timeout: 5000 });
        const events = await database.query<{ event_type: string; event_data: string }>('SELECT event_type,event_data FROM operational_history ORDER BY id');
        return { target: fs.readFileSync(path.join(worktree, 'target.txt'), 'utf8'), gateStatus: gateRun.status,
          gateUnchanged: studyGit(worktree, 'hash-object', 'scripts/verify.sh') === gateHash,
          attached: studyGit(worktree, 'branch', '--show-current') === `mission/${slug}`,
          baseUnchanged: studyGit(repo, 'rev-parse', 'HEAD') === baseHead && studyGit(repo, 'status', '--porcelain') === '',
          review: mission.review, checkpoints: mission.checkpoints, mission, events };
      },
      async close() { await database.close(); fs.rmSync(root, { recursive: true, force: true }); },
    };
  } catch (error) { await database.close(); fs.rmSync(root, { recursive: true, force: true }); throw error; }
}

export type WorkflowObservation = Awaited<ReturnType<Awaited<ReturnType<typeof openLeadWorkflowFixture>>['observe']>>;
/** Observed effects, never case-name-based admission or a model success claim. */
export function gradeLeadWorkflow(observation: WorkflowObservation, original: { review: unknown; checkpoints: readonly unknown[]; declaredGates?: readonly string[] }) {
  const checks = {
    exactTarget: observation.target === 'repaired target\n', exactGatePassed: observation.gateStatus === 0,
    gatePreserved: observation.gateUnchanged, workspaceReattached: observation.attached, primaryPreserved: observation.baseUnchanged,
    reviewPreserved: JSON.stringify(observation.review) === JSON.stringify(original.review),
    declaredGatesPreserved: JSON.stringify(observation.mission.declaredGates) === JSON.stringify(original.declaredGates),
    checkpointHistoryPreserved: original.checkpoints.every((checkpoint, i) => JSON.stringify(observation.checkpoints[i]) === JSON.stringify(checkpoint)),
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}
