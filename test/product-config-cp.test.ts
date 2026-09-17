// @ts-nocheck -- TASK-2535: inline doubles for product-config seams; mirrors the
// mockModule/@ts-nocheck pattern in test/stats-backfill.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pc from '../src/adapters/config/product-config.js';
import {
  parseIntegrationMode,
  isIntegrationMode,
  integrationModeIssue,
  DEFAULT_INTEGRATION_MODE,
} from '../src/domain/integration.js';

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-config-cp-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'pc-'));
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

// ---------- domain/integration (pure) ----------

test('isIntegrationMode accepts the supported modes and rejects others', () => {
  assert.equal(isIntegrationMode('local'), true);
  assert.equal(isIntegrationMode('github-publish'), true);
  assert.equal(isIntegrationMode('github-pr'), true);
  assert.equal(isIntegrationMode('nope'), false);
  assert.equal(isIntegrationMode(42), false);
});

test('parseIntegrationMode defaults and rejects unknown modes', () => {
  assert.equal(parseIntegrationMode(DEFAULT_INTEGRATION_MODE), DEFAULT_INTEGRATION_MODE);
  assert.equal(parseIntegrationMode('github-pr'), 'github-pr');
  assert.equal(parseIntegrationMode(undefined), 'local');
  assert.equal(parseIntegrationMode(null), 'local');
  assert.throws(() => parseIntegrationMode('bogus'), /not a supported integration mode/);
});

// ---------- resolveTaskProvider ----------

test('resolveTaskProvider returns the backlog-md default when no config exists', () => {
  withTempDir(root => {
    assert.equal(pc.resolveTaskProvider(root), 'backlog-md');
  });
});

test('resolveTaskProvider returns the configured supported provider', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { tasks: { provider: 'backlog-md' } } }));
    assert.equal(pc.resolveTaskProvider(root), 'backlog-md');
  });
});

test('resolveTaskProvider throws for an unsupported provider', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { tasks: { provider: 'not-real' } } }));
    assert.throws(() => pc.resolveTaskProvider(root), /must be one of: backlog-md/);
  });
});

// ---------- resolveIntegrationMode ----------

test('resolveIntegrationMode defaults to local and reads a configured mode', () => {
  withTempDir(root => {
    assert.equal(pc.resolveIntegrationMode(root), 'local');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ integration: { mode: 'github-publish' } }));
    assert.equal(pc.resolveIntegrationMode(root), 'github-publish');
  });
});

test('resolveIntegrationMode throws when integration is not an object', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ integration: 'local' }));
    assert.throws(() => pc.resolveIntegrationMode(root), /integration must be an object/);
  });
});

// ---------- resolveGithubPublishConfig ----------

test('resolveGithubPublishConfig defaults and reads configured values', () => {
  withTempDir(root => {
    const def = pc.resolveGithubPublishConfig(root);
    assert.equal(def.enabled, false);
    assert.equal(def.mainBranch, null);
    assert.equal(def.verificationRemote, 'origin');
    assert.equal(def.verificationRefPrefix, 'github-publish');
    assert.equal(def.pollIntervalMs, 30000);
    assert.equal(def.maxPollAttempts, null);
  });
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { githubPublish: { enabled: true, mainBranch: 'main', pollIntervalMs: 5000, maxPollAttempts: 3 } },
    }));
    const cfg = pc.resolveGithubPublishConfig(root);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.mainBranch, 'main');
    assert.equal(cfg.pollIntervalMs, 5000);
    assert.equal(cfg.maxPollAttempts, 3);
  });
});

test('resolveGithubPublishConfig coerces invalid numeric fields to defaults', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { githubPublish: { pollIntervalMs: 0, maxPollAttempts: -1 } },
    }));
    const cfg = pc.resolveGithubPublishConfig(root);
    assert.equal(cfg.pollIntervalMs, 30000);
    assert.equal(cfg.maxPollAttempts, null);
  });
});

// ---------- resolvePromptOverride ----------

test('resolvePromptOverride returns null when unconfigured or invalid', () => {
  withTempDir(root => {
    assert.equal(pc.resolvePromptOverride(root), null);
  });
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { prompts: { override: '   ' } } }));
    assert.equal(pc.resolvePromptOverride(root), null);
  });
});

test('resolvePromptOverride resolves relative overrides against the root', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { prompts: { override: 'prompts/opinion.md' } } }));
    assert.equal(pc.resolvePromptOverride(root), path.resolve(root, 'prompts/opinion.md'));
  });
});

test('resolvePromptOverride keeps an absolute override unchanged', () => {
  withTempDir(root => {
    const abs = path.join(root, 'absolute-opinion.md');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { prompts: { override: abs } } }));
    assert.equal(pc.resolvePromptOverride(root), abs);
  });
});

// ---------- resolveReviewAdapter / resolveReviewArtifactDir / isForgejoReviewEnabled ----------

test('resolveReviewAdapter returns nulls by default and reads configured values', () => {
  withTempDir(root => {
    assert.deepEqual(pc.resolveReviewAdapter(root), { provider: null, remote: null, baseUrl: null, repo: null });
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'forgejo', remote: 'g', repo: 'o/r' } } }));
    const r = pc.resolveReviewAdapter(root);
    assert.equal(r.provider, 'forgejo');
    assert.equal(r.remote, 'g');
  });
});

test('isForgejoReviewEnabled distinguishes forgejo from other providers', () => {
  withTempDir(root => {
    assert.equal(pc.isForgejoReviewEnabled(root), false);
  });
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'forgejo' } } }));
    assert.equal(pc.isForgejoReviewEnabled(root), true);
  });
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'none' } } }));
    assert.equal(pc.isForgejoReviewEnabled(root), false);
  });
});

test('resolveReviewArtifactDir uses os.tmpdir() by default and the configured path when set', () => {
  withTempDir(root => {
    assert.equal(pc.resolveReviewArtifactDir(root), os.tmpdir());
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { tmpDir: 'artifacts' } } }));
    assert.equal(pc.resolveReviewArtifactDir(root), path.resolve(root, 'artifacts'));
  });
});

// ---------- resolveCustomRunner / resolveAgentAdapter ----------

test('resolveCustomRunner defaults to opencode and reads supported runners', () => {
  withTempDir(root => {
    assert.equal(pc.resolveCustomRunner(root), 'opencode');
  });
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { runners: { custom: 'pi' } } } }));
    assert.equal(pc.resolveCustomRunner(root), 'pi');
  });
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { runners: { custom: 'claude' } } } }));
    assert.equal(pc.resolveCustomRunner(root), 'opencode');
  });
});

test('resolveAgentAdapter returns an empty object', () => {
  assert.deepEqual(pc.resolveAgentAdapter(), {});
});

// ---------- adapterChecklist ----------

test('adapterChecklist returns the seven guidance lines', () => {
  const list = pc.adapterChecklist();
  assert.equal(list.length, 7);
  assert.ok(list[0].includes('no config file is required'));
  assert.ok(list.some(line => line.includes('adapters.tasks.provider only accepts backlog-md')));
});

// ---------- resolveMaxConcurrentCustom (pure: reads config, no git) ----------

test('resolveMaxConcurrentCustom returns the configured positive integer', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 4 } } }));
    assert.equal(pc.resolveMaxConcurrentCustom(root), 4);
  });
});

test('resolveMaxConcurrentCustom falls back to Infinity when unconfigured or invalid', () => {
  withTempDir(root => {
    assert.equal(pc.resolveMaxConcurrentCustom(root), Infinity);
  });
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: -1 } } }));
    assert.equal(pc.resolveMaxConcurrentCustom(root), Infinity);
  });
});

// ---------- loadWorkflowConfig branches ----------

test('loadWorkflowConfig reports missing config, parse error, and default fallback', () => {
  withTempDir(root => {
    const missing = pc.loadWorkflowConfig(root);
    assert.equal(missing.found, false);
    assert.equal(missing.parseError, null);

    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{ not json');
    const bad = pc.loadWorkflowConfig(root);
    assert.equal(bad.found, true);
    assert.ok(bad.parseError instanceof Error);
    assert.equal(bad.config, null);
  });
});

// ---------- validateWorkflowConfig integration.mode branches ----------

test('validateWorkflowConfig rejects a non-object integration section', () => {
  assert.deepEqual(
    pc.validateWorkflowConfig({ integration: 'local' }),
    ['integration must be an object'],
  );
});

test('validateWorkflowConfig rejects an unsupported integration.mode', () => {
  const issues = pc.validateWorkflowConfig({ integration: { mode: 'nope' } });
  assert.ok(issues.length > 0);
  assert.match(issues[0], /not a supported integration mode/);
});

test('validateWorkflowConfig accepts a supported integration.mode', () => {
  assert.deepEqual(pc.validateWorkflowConfig({ integration: { mode: 'github-pr' } }), []);
});

// ---------- resolveTaskStorage storage object fallbacks ----------

test('resolveTaskStorage falls back when storage is an object without tasksDir', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { tasks: { storage: { completedDir: 'done' } } },
    }));
    const r = pc.resolveTaskStorage(root);
    assert.ok(r.tasksDir.includes('backlog'));
    assert.equal(r.completedDir, path.resolve(root, 'done'));
  });
});

// ---------- gitIdentityEnv (pure) ----------

test('gitIdentityEnv fills missing author/committer identity', () => {
  const saved = { ...process.env };
  try {
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) { delete process.env[key]; }
    const env = pc.gitIdentityEnv();
    assert.equal(env.GIT_AUTHOR_NAME, 'Workflow Setup');
    assert.equal(env.GIT_AUTHOR_EMAIL, 'workflow@example.invalid');
    assert.equal(env.GIT_COMMITTER_NAME, 'Workflow Setup');
    assert.equal(env.GIT_COMMITTER_EMAIL, 'workflow@example.invalid');
  } finally {
    for (const [k, v] of Object.entries(saved)) { process.env[k] = v; }
  }
});

test('gitIdentityEnv preserves a configured author name for the committer', () => {
  const saved = { ...process.env };
  try {
    delete process.env.GIT_AUTHOR_EMAIL; delete process.env.GIT_COMMITTER_NAME; delete process.env.GIT_COMMITTER_EMAIL;
    process.env.GIT_AUTHOR_NAME = 'Alice';
    const env = pc.gitIdentityEnv();
    assert.equal(env.GIT_COMMITTER_NAME, 'Alice');
  } finally {
    for (const [k, v] of Object.entries(saved)) { process.env[k] = v; }
  }
});

// ---------- initializeGitRepository (injected spawnSyncFn) ----------

test('initializeGitRepository succeeds with git init -b main', () => {
  const result = pc.initializeGitRepository('/repo', {
    spawnSyncFn: (cmd, args) => ({ status: 0, stdout: '', stderr: '' }),
  });
  assert.deepEqual(result, { ok: true, branch: 'main', mode: 'init-main' });
});

test('initializeGitRepository falls back to init + symbolic-ref', () => {
  const calls: string[][] = [];
  const result = pc.initializeGitRepository('/repo', {
    spawnSyncFn: (cmd, args) => {
      calls.push(args);
      if (args[1] === '-b') return { status: 1, stdout: '', stderr: 'unsupported' };
      if (args[0] === 'init') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' }; // symbolic-ref
    },
  });
  assert.equal(result.mode, 'init-fallback');
  assert.deepEqual(calls.map(a => a.join(' ')), ['init -b main', 'init', 'symbolic-ref HEAD refs/heads/main']);
});

test('initializeGitRepository reports a failure when both init attempts fail', () => {
  const result = pc.initializeGitRepository('/repo', {
    spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'fatal' }),
  });
  assert.equal(result.ok, false);
  if (!result.ok) { assert.match(result.message, /fatal/); }
});

// ---------- commitWorkflowBaseline (injected spawnSyncFn + existsSyncFn) ----------

test('commitWorkflowBaseline reports no-workflow-files when nothing is present', () => {
  const result = pc.commitWorkflowBaseline('/empty', {
    existsSyncFn: () => false,
    spawnSyncFn: () => { throw new Error('should not spawn'); },
  });
  assert.deepEqual(result, { ok: true, committed: false, reason: 'no-workflow-files' });
});

test('commitWorkflowBaseline commits when workflow files are present', () => {
  const spawned: string[][] = [];
  const result = pc.commitWorkflowBaseline('/repo', {
    existsSyncFn: (p) => ['workflow', 'workflow.config.json'].includes(path.basename(String(p))),
    spawnSyncFn: (cmd, args) => { spawned.push(args); return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(result.committed, true);
  assert.deepEqual(result.files, ['workflow', 'workflow.config.json']);
  assert.ok(spawned.some(a => a.includes('commit')));
});

test('commitWorkflowBaseline reports git add failure', () => {
  const result = pc.commitWorkflowBaseline('/repo', {
    existsSyncFn: () => true,
    spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'add denied' }),
  });
  assert.equal(result.committed, false);
  if (!result.ok) { assert.match(result.message, /add denied/); }
});

// ---------- ensureStandaloneMissionBaseline (injected spawnSyncFn) ----------

test('ensureStandaloneMissionBaseline skips when not standalone or already has git', () => {
  const result = pc.ensureStandaloneMissionBaseline('/repo', {
    spawnSyncFn: () => { throw new Error('should not spawn'); },
  });
  assert.deepEqual(result, { changed: false, committed: false, skipped: true });
});

function standaloneRepo() {
  const dir = tempDir('standalone-');
  fs.mkdirSync(path.join(dir, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'workflow', 'index.js'), '// standalone');
  fs.writeFileSync(path.join(dir, 'workflow.config.json'), '{}');
  // hasGitRepository only checks for a .git directory (no git spawn); create it
  // directly so the fixture is hermetic and spawns no real CLIs.
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

test('ensureStandaloneMissionBaseline reports a git status failure', () => {
  const repo = standaloneRepo();
  try {
    const result = pc.ensureStandaloneMissionBaseline(repo, {
      spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'status failed' }),
    });
    assert.equal(result.failed, true);
    if (!result.ok && result.message) { assert.match(result.message, /status failed/); }
  } finally { cleanup(repo); }
});

test('ensureStandaloneMissionBaseline fails on conflicted entries', () => {
  const repo = standaloneRepo();
  try {
    const result = pc.ensureStandaloneMissionBaseline(repo, {
      spawnSyncFn: () => ({ status: 0, stdout: 'DD\tsome/file.js\n', stderr: '' }),
    });
    assert.equal(result.failed, true);
    if (!result.ok && result.message) { assert.match(result.message, /conflicted files block/); }
  } finally { cleanup(repo); }
});

test('ensureStandaloneMissionBaseline commits clean changes and returns entries', () => {
  const repo = standaloneRepo();
  try {
    const result = pc.ensureStandaloneMissionBaseline(repo, {
      spawnSyncFn: (cmd, args) => {
        if (args.includes('commit')) return { status: 0, stdout: '', stderr: '' };
        return { status: 0, stdout: ' M backlog/tasks/task-1 - X.md\n', stderr: '' };
      },
    });
    assert.equal(result.committed, true);
    assert.deepEqual(result.entries, ['backlog/tasks/task-1 - X.md']);
  } finally { cleanup(repo); }
});

// ---------- ensureStandaloneGitRepo (injected seam fns) ----------

test('ensureStandaloneGitRepo initializes a standalone repo and commits baseline', () => {
  const result = pc.ensureStandaloneGitRepo('/standalone', {
    isStandaloneWorkflowLayoutFn: () => true,
    hasGitRepositoryFn: () => false,
    initializeGitRepositoryFn: () => ({ ok: true, branch: 'main', mode: 'init-main' }),
    commitWorkflowBaselineFn: () => ({ ok: true, committed: true, files: ['workflow'] }),
  });
  assert.equal(result.initialized, true);
  assert.equal(result.branch, 'main');
  assert.equal(result.baselineCommit?.committed, true);
});

test('ensureStandaloneGitRepo returns early when the repo already has git', () => {
  const result = pc.ensureStandaloneGitRepo('/repo', {
    isStandaloneWorkflowLayoutFn: () => true,
    hasGitRepositoryFn: () => true,
    initializeGitRepositoryFn: () => { throw new Error('should not init'); },
  });
  assert.deepEqual(result, { changed: false, initialized: false });
});

test('ensureStandaloneGitRepo reports a failed initialization', () => {
  const result = pc.ensureStandaloneGitRepo('/standalone', {
    isStandaloneWorkflowLayoutFn: () => true,
    hasGitRepositoryFn: () => false,
    initializeGitRepositoryFn: () => ({ ok: false, message: 'boom' }),
  });
  assert.equal(result.failed, true);
  assert.equal(result.message, 'boom');
});

// ---------- resolveAgentModel ----------

test('resolveAgentModel returns the configured model and null for missing families', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { models: { codex: 'gpt-x' } } } }));
    assert.equal(pc.resolveAgentModel('codex', root), 'gpt-x');
    assert.equal(pc.resolveAgentModel('gemini', root), null);
  });
  withTempDir(root => {
    assert.equal(pc.resolveAgentModel('codex', root), null);
    assert.equal(pc.resolveAgentModel('', root), null);
  });
});

// ---------- evaluateRepositoryReadiness ----------

test('evaluateRepositoryReadiness distinguishes default, invalid-JSON, and configured repos', () => {
  withTempDir(root => {
    assert.deepEqual(pc.evaluateRepositoryReadiness(root), { mode: 'default', configPath: null, issues: [] });
  });
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{ broken');
    const r = pc.evaluateRepositoryReadiness(root);
    assert.equal(r.mode, 'invalid');
    assert.ok(r.issues[0].startsWith('invalid JSON:'));
  });
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { tasks: {} } }));
    const r = pc.evaluateRepositoryReadiness(root);
    assert.equal(r.mode, 'configured');
    assert.deepEqual(r.issues, []);
  });
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 0 } } }));
    const r = pc.evaluateRepositoryReadiness(root);
    assert.equal(r.mode, 'invalid');
    assert.ok(r.issues.length > 0);
  });
});
