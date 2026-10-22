// Validation, resolution and Git orchestration with injected process boundaries.
// Real Git repository behavior stays in integration/config/product-config.test.ts.
import { resolveConfiguration } from '../../../../src/composition/config.js';
import * as pc from '../../../../src/adapters/config/product-config.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isPlainObject,
  deepMerge,
  defaultConfig,
  validateWorkflowConfig,
  resolveTaskProvider,
  resolveIntegrationMode,
  resolvePromptOverride,
  resolveReviewAdapter,
  resolveReviewArtifactDir,
  isForgejoReviewEnabled,
  adapterChecklist,
  detectLegacyRepoLayout,
  isStandaloneWorkflowLayout,
  hasGitRepository,
  ensureStandaloneMissionBaseline,
  ensureStandaloneGitRepo,
} from '../../../../src/adapters/config/product-config.js';

// Injected doubles for the git-boundary seams. Cast through `never` so the
// test stays free of a real spawnSync/git dependency.
const initDenied: NonNullable<NonNullable<Parameters<typeof ensureStandaloneGitRepo>[1]>["initializeGitRepositoryFn"]> = () => ({ ok: false, message: 'git init denied' });
const initBoom: NonNullable<NonNullable<Parameters<typeof ensureStandaloneMissionBaseline>[1]>["spawnSyncFn"]> = (): never => { throw new Error('should not init'); }
const statusFail: NonNullable<NonNullable<Parameters<typeof ensureStandaloneMissionBaseline>[1]>["spawnSyncFn"]> = () => ({ signal: null,  status: 1, stdout: '', stderr: 'git boom' });
const conflicted: NonNullable<NonNullable<Parameters<typeof ensureStandaloneMissionBaseline>[1]>["spawnSyncFn"]> = () => ({ stderr: '', signal: null,  status: 0, stdout: 'DD  conflicted-file\n' });

function withTempConfig(run: (rootDir: string, config: unknown) => void): void {
  const rootDir = registeredMkdtemp('pcfg-');
  const configPath = path.join(rootDir, 'workflow.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ adapters: {} }));
  try { run(rootDir, JSON.parse(fs.readFileSync(configPath, 'utf8'))); }
  finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
}

function writeConfig(rootDir: string, config: unknown): void {
  fs.writeFileSync(path.join(rootDir, 'workflow.config.json'), JSON.stringify(config));
}

test('isPlainObject distinguishes objects from primitives and arrays', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject('string'), false);
  assert.equal(isPlainObject(42), false);
});

test('deepMerge recurses into nested plain objects and otherwise overrides', () => {
  const merged = deepMerge({ a: { x: 1, y: 2 }, b: 1 }, { a: { y: 3, z: 4 }, b: 2 });
  assert.deepEqual(merged, { a: { x: 1, y: 3, z: 4 }, b: 2 });
  // A non-plain override does not recurse; it replaces.
  assert.deepEqual(deepMerge({ a: { x: 1 } }, { a: [1, 2] }), { a: [1, 2] });
});

test('defaultConfig returns a deep clone of the shipped defaults', () => {
  const first = defaultConfig();
  first.adapters.tasks.provider = 'mutated';
  assert.equal(defaultConfig().adapters.tasks.provider, 'backlog-md');
});

test('validateWorkflowConfig rejects a non-object top level', () => {
  assert.deepEqual(validateWorkflowConfig('nope'), ['top-level JSON object is required']);
});

test('validateWorkflowConfig flags an invalid integration.mode', () => {
  const issues = validateWorkflowConfig({ integration: { mode: 'destroy-all' } });
  assert.ok(issues.some(i => i.includes('integration.mode')));
});

test('validateWorkflowConfig flags a non-object integration section', () => {
  const issues = validateWorkflowConfig({ integration: 'nope' });
  assert.ok(issues.includes('integration must be an object'));
});

test('validateWorkflowConfig flags an invalid tasks.provider (SUPPORTED_TASK_PROVIDERS rejection)', () => {
  const issues = validateWorkflowConfig({ adapters: { tasks: { provider: 'not-supported' } } });
  assert.ok(issues.some(i => i.includes('tasks.provider')));
});

test('validateWorkflowConfig flags a non-object tasks section', () => {
  const issues = validateWorkflowConfig({ adapters: { tasks: 'nope' } });
  assert.ok(issues.some(i => i.includes('adapters.tasks must be an object')));
});

test('validateWorkflowConfig flags invalid githubPublish fields', () => {
  const issues = validateWorkflowConfig({
    adapters: {
      githubPublish: {
        enabled: 'yes',
        pollIntervalMs: -5,
        maxPollAttempts: 1.5,
      },
    },
  });
  assert.ok(issues.some(i => i.includes('githubPublish.enabled')));
  assert.ok(issues.some(i => i.includes('pollIntervalMs')));
  assert.ok(issues.some(i => i.includes('maxPollAttempts')));
});

test('validateWorkflowConfig accepts a null maxPollAttempts and rejects an unknown review provider', () => {
  const issues = validateWorkflowConfig({
    adapters: {
      review: { provider: 'sentry' },
      githubPublish: { maxPollAttempts: null },
    },
  });
  assert.ok(issues.some(i => i.includes('review.provider')));
});

test('validateWorkflowConfig accepts a completed-mission retention window and rejects invalid values (TASK-2645)', () => {
  assert.deepEqual(validateWorkflowConfig({ adapters: { web: { completedMissionRetentionDays: 14 } } }), []);
  for (const value of [-1, 1.5, 'seven']) {
    assert.ok(validateWorkflowConfig({ adapters: { web: { completedMissionRetentionDays: value } } })
      .some(issue => issue.includes('completedMissionRetentionDays')));
  }
});

test('validateWorkflowConfig flags invalid agents fields across every validator', () => {
  const issues = validateWorkflowConfig({
    adapters: {
      agents: {
        maxConcurrentCustom: 0,
        models: { claude: 42 },
        runners: { custom: {}, sentry: {} },
        subagents: { parallel: 2 },
      },
    },
  });
  assert.ok(issues.some(i => i.includes('maxConcurrentCustom')));
  assert.ok(issues.some(i => i.includes('agents.models.claude')));
  assert.ok(issues.some(i => i.includes('runners may only contain')));
  assert.ok(issues.some(i => i.includes('subagents may only contain')));
});

test('validateWorkflowConfig flags a negative subagents.maxParallel', () => {
  const issues = validateWorkflowConfig({
    adapters: { agents: { subagents: { maxParallel: -1 } } },
  });
  assert.ok(issues.some(i => i.includes('subagents.maxParallel')));
});
test('validateWorkflowConfig accepts a null subagents.maxParallel', () => {
  const issues = validateWorkflowConfig({
    adapters: { agents: { subagents: { maxParallel: null } } },
  });
  assert.ok(!issues.some(i => i.includes('subagents.maxParallel')));
});

test('validateWorkflowConfig passes a schema-valid config with extra storage keys', () => {
  const issues = validateWorkflowConfig({
    adapters: { tasks: { provider: 'backlog-md', storage: { main: 'tasks', archive: 'archive' } } },
  });
  assert.deepEqual(issues, []);
});

test('resolveTaskProvider returns the default when no provider is configured and rejects an unknown one', () => {
  withTempConfig(rootDir => {
    assert.equal(resolveTaskProvider(rootDir), 'backlog-md');
  });
  withTempConfig(rootDir => {
    writeConfig(rootDir, { adapters: { tasks: { provider: 'nope' } } });
    assert.throws(() => resolveTaskProvider(rootDir), /backlog-md/);
  });
});

test('resolveIntegrationMode defaults to local and throws on an unknown mode', () => {
  withTempConfig(rootDir => {
    assert.equal(resolveIntegrationMode(rootDir), 'local');
  });
  withTempConfig(rootDir => {
    writeConfig(rootDir, { integration: { mode: 'nuke' } });
    assert.throws(() => resolveIntegrationMode(rootDir), /integration.mode/);
  });
  withTempConfig(rootDir => {
    writeConfig(rootDir, { integration: 'nope' });
    assert.throws(() => resolveIntegrationMode(rootDir), /integration must be an object/);
  });
});

test('resolvePromptOverride resolves relative and absolute overrides and null when unconfigured', () => {
  withTempConfig(rootDir => {
    assert.equal(resolvePromptOverride(rootDir), null);
  });
  withTempConfig(rootDir => {
    const abs = path.join(rootDir, 'prompts', 'custom.md');
    writeConfig(rootDir, { adapters: { prompts: { override: abs } } });
    assert.equal(resolvePromptOverride(rootDir), abs);
  });
  withTempConfig(rootDir => {
    writeConfig(rootDir, { adapters: { prompts: { override: '../shared/custom.md' } } });
    const resolved = resolvePromptOverride(rootDir);
    assert.equal(resolved, path.resolve(rootDir, '../shared/custom.md'));
  });
});

test('resolveReviewAdapter, resolveReviewArtifactDir and isForgejoReviewEnabled read the review section', () => {
  withTempConfig(rootDir => {
    assert.equal(resolveReviewAdapter(rootDir).provider, null);
    assert.equal(isForgejoReviewEnabled(rootDir), false);
    assert.equal(resolveReviewArtifactDir(rootDir), os.tmpdir());
  });
  withTempConfig(rootDir => {
    writeConfig(rootDir, { adapters: { review: { provider: 'forgejo', remote: 'review', tmpDir: './artifacts' } } });
    const review = resolveReviewAdapter(rootDir);
    assert.equal(review.provider, 'forgejo');
    assert.equal(isForgejoReviewEnabled(rootDir), true);
    assert.equal(resolveReviewArtifactDir(rootDir), path.resolve(rootDir, './artifacts'));
  });
});

test('adapterChecklist exposes the shipped adapter guidance', () => {
  const list = adapterChecklist();
  assert.ok(list.some(item => item.includes('backlog-md')));
  assert.ok(list.some(item => item.includes('adapters.review')));
});

test('detectLegacyRepoLayout, isStandaloneWorkflowLayout and hasGitRepository reflect the filesystem', () => {
  const rootDir = registeredMkdtemp('pcfg-fs-');
  try {
    assert.equal(hasGitRepository(rootDir), false);
    assert.equal(isStandaloneWorkflowLayout(rootDir), false);
    assert.equal(detectLegacyRepoLayout(rootDir), false);
    fs.mkdirSync(path.join(rootDir, 'workflow'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'workflow', 'index.js'), '// entry');
    fs.writeFileSync(path.join(rootDir, 'workflow.config.json'), '{}');
    assert.equal(isStandaloneWorkflowLayout(rootDir), true);
    fs.mkdirSync(path.join(rootDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'scripts', 'verify-local.sh'), '#!/usr/bin/env bash');
    fs.mkdirSync(path.join(rootDir, 'backlog'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'docs', 'missions'), { recursive: true });
    assert.equal(detectLegacyRepoLayout(rootDir), true);
    fs.mkdirSync(path.join(rootDir, '.git'), { recursive: true });
    assert.equal(hasGitRepository(rootDir), true);
  } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
});

test('ensureStandaloneMissionBaseline short-circuits outside a standalone layout', () => {
  const rootDir = registeredMkdtemp('pcfg-base-');
  try {
    const result = ensureStandaloneMissionBaseline(rootDir, {
      spawnSyncFn: initBoom,
    });
    assert.deepEqual(result, { changed: false, committed: false, skipped: true });
  } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
});

test('ensureStandaloneMissionBaseline reports a failed git status through the injected runner', () => {
  const rootDir = registeredMkdtemp('pcfg-base-');
  try {
    fs.mkdirSync(path.join(rootDir, 'workflow'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'workflow', 'index.js'), '// entry');
    fs.writeFileSync(path.join(rootDir, 'workflow.config.json'), '{}');
    fs.mkdirSync(path.join(rootDir, '.git'), { recursive: true });
    const result = ensureStandaloneMissionBaseline(rootDir, {
      spawnSyncFn: statusFail,
    });
    assert.equal(result.failed, true);
    assert.match(result.message || '', /git boom/);
  } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
});

test('ensureStandaloneMissionBaseline detects conflicted files blocking the baseline', () => {
  const rootDir = registeredMkdtemp('pcfg-base-');
  try {
    fs.mkdirSync(path.join(rootDir, 'workflow'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'workflow', 'index.js'), '// entry');
    fs.writeFileSync(path.join(rootDir, 'workflow.config.json'), '{}');
    fs.mkdirSync(path.join(rootDir, '.git'), { recursive: true });
    const result = ensureStandaloneMissionBaseline(rootDir, {
      spawnSyncFn: conflicted,
    });
    assert.equal(result.changed, true);
    assert.equal(result.failed, true);
    assert.match(result.message || '', /conflicted files/);
  } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
});

test('ensureStandaloneGitRepo short-circuits when a git repository already exists', () => {
  const rootDir = registeredMkdtemp('pcfg-git-');
  try {
    const result = ensureStandaloneGitRepo(rootDir, {
      hasGitRepositoryFn: () => true,
      initializeGitRepositoryFn: () => { throw new Error('should not init'); },
    });
    assert.deepEqual(result, { changed: false, initialized: false });
  } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
});

test('ensureStandaloneGitRepo reports a failed git init through the injected initializer', () => {
  const rootDir = registeredMkdtemp('pcfg-git-');
  try {
    const result = ensureStandaloneGitRepo(rootDir, {
      isStandaloneWorkflowLayoutFn: () => true,
      hasGitRepositoryFn: () => false,
      initializeGitRepositoryFn: initDenied,
    });
    assert.equal(result.failed, true);
    assert.match(result.message || '', /git init denied/);
  } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
});

function withTempDir(fn: (_arg0: string) => void) {
  const dir = registeredMkdtemp('product-config-');
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function tempDir(prefix: string) {
  return registeredMkdtemp(prefix || 'pc-');
}
function cleanup(dir: fs.PathLike) { fs.rmSync(dir, { recursive: true, force: true }); }

// ---------- resolveTaskProvider ----------

test('resolveTaskProvider returns the backlog-md default when no config exists', () => {
  withTempDir((root) => {
    assert.equal(pc.resolveTaskProvider(root), 'backlog-md');
  });
});

test('resolveTaskProvider returns the configured supported provider', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { tasks: { provider: 'backlog-md' } } }));
    assert.equal(pc.resolveTaskProvider(root), 'backlog-md');
  });
});

test('resolveTaskProvider throws for an unsupported provider', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { tasks: { provider: 'not-real' } } }));
    assert.throws(() => pc.resolveTaskProvider(root), /must be one of: backlog-md/);
  });
});

// ---------- resolveIntegrationMode ----------

test('resolveIntegrationMode defaults to local and reads a configured mode', () => {
  withTempDir((root) => {
    assert.equal(pc.resolveIntegrationMode(root), 'local');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ integration: { mode: 'github-publish' } }));
    assert.equal(pc.resolveIntegrationMode(root), 'github-publish');
  });
});

test('resolveIntegrationMode throws when integration is not an object', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ integration: 'local' }));
    assert.throws(() => pc.resolveIntegrationMode(root), /integration must be an object/);
  });
});

// ---------- resolveGithubPublishConfig ----------

test('resolveGithubPublishConfig defaults and reads configured values', () => {
  withTempDir((root) => {
    const def = pc.resolveGithubPublishConfig(root);
    assert.equal(def.enabled, false);
    assert.equal(def.mainBranch, null);
    assert.equal(def.verificationRemote, 'origin');
    assert.equal(def.verificationRefPrefix, 'github-publish');
    assert.equal(def.pollIntervalMs, 30000);
    assert.equal(def.maxPollAttempts, null);
  });
  withTempDir((root) => {
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
  withTempDir((root) => {
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
  withTempDir((root) => {
    assert.equal(pc.resolvePromptOverride(root), null);
  });
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { prompts: { override: '   ' } } }));
    assert.equal(pc.resolvePromptOverride(root), null);
  });
});

test('resolvePromptOverride resolves relative overrides against the root', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { prompts: { override: 'prompts/opinion.md' } } }));
    assert.equal(pc.resolvePromptOverride(root), path.resolve(root, 'prompts/opinion.md'));
  });
});

test('resolvePromptOverride keeps an absolute override unchanged', () => {
  withTempDir((root) => {
    const abs = path.join(root, 'absolute-opinion.md');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { prompts: { override: abs } } }));
    assert.equal(pc.resolvePromptOverride(root), abs);
  });
});

// ---------- resolveReviewAdapter / resolveReviewArtifactDir / isForgejoReviewEnabled ----------

test('resolveReviewAdapter returns nulls by default and reads configured values', () => {
  withTempDir((root) => {
    assert.deepEqual(pc.resolveReviewAdapter(root), { provider: null, remote: null, baseUrl: null, repo: null });
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'forgejo', remote: 'g', repo: 'o/r' } } }));
    const r = pc.resolveReviewAdapter(root);
    assert.equal(r.provider, 'forgejo');
    assert.equal(r.remote, 'g');
  });
});

test('isForgejoReviewEnabled distinguishes forgejo from other providers', () => {
  withTempDir((root) => {
    assert.equal(pc.isForgejoReviewEnabled(root), false);
  });
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'forgejo' } } }));
    assert.equal(pc.isForgejoReviewEnabled(root), true);
  });
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { provider: 'none' } } }));
    assert.equal(pc.isForgejoReviewEnabled(root), false);
  });
});

test('resolveReviewArtifactDir uses os.tmpdir() by default and the configured path when set', () => {
  withTempDir((root) => {
    assert.equal(pc.resolveReviewArtifactDir(root), os.tmpdir());
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { review: { tmpDir: 'artifacts' } } }));
    assert.equal(pc.resolveReviewArtifactDir(root), path.resolve(root, 'artifacts'));
  });
});

// ---------- resolveCustomRunner / resolveAgentAdapter ----------

test('resolveCustomRunner defaults to opencode and reads supported runners', () => {
  withTempDir((root) => {
    assert.equal(pc.resolveCustomRunner(root), 'opencode');
  });
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { runners: { custom: 'pi' } } } }));
    assert.equal(pc.resolveCustomRunner(root), 'pi');
  });
  withTempDir((root) => {
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
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 4 } } }));
    assert.equal(pc.resolveMaxConcurrentCustom(root), 4);
  });
});

test('resolveMaxConcurrentCustom falls back to Infinity when unconfigured or invalid', () => {
  withTempDir((root) => {
    assert.equal(pc.resolveMaxConcurrentCustom(root), Infinity);
  });
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: -1 } } }));
    assert.equal(pc.resolveMaxConcurrentCustom(root), Infinity);
  });
});

// ---------- loadWorkflowConfig branches ----------

test('loadWorkflowConfig reports missing config, parse error, and default fallback', () => {
  withTempDir((root) => {
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
  withTempDir((root) => {
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
  const environment = { ...process.env };
  {
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) { delete environment[key]; }
    const env = pc.gitIdentityEnv(resolveConfiguration(environment));
    assert.equal(env.GIT_AUTHOR_NAME, 'Workflow Setup');
    assert.equal(env.GIT_AUTHOR_EMAIL, 'workflow@example.invalid');
    assert.equal(env.GIT_COMMITTER_NAME, 'Workflow Setup');
    assert.equal(env.GIT_COMMITTER_EMAIL, 'workflow@example.invalid');
  }
});

test('gitIdentityEnv preserves a configured author name for the committer', () => {
  const environment = { ...process.env };
  {
    delete environment.GIT_AUTHOR_EMAIL; delete environment.GIT_COMMITTER_NAME; delete environment.GIT_COMMITTER_EMAIL;
    environment.GIT_AUTHOR_NAME = 'Alice';
    const env = pc.gitIdentityEnv(resolveConfiguration(environment));
    assert.equal(env.GIT_COMMITTER_NAME, 'Alice');
  }
});

// ---------- initializeGitRepository (injected spawnSyncFn) ----------

test('initializeGitRepository succeeds with git init -b main', () => {
  const result = pc.initializeGitRepository('/repo', {
    spawnSyncFn: (cmd, args) => ({ signal: null,  status: 0, stdout: '', stderr: '' }),
  });
  assert.deepEqual(result, { ok: true, branch: 'main', mode: 'init-main' });
});

test('initializeGitRepository falls back to init + symbolic-ref', () => {
  const calls: (readonly string[])[] = [];
  const result = pc.initializeGitRepository('/repo', {
    spawnSyncFn: (cmd, args) => {
      calls.push(args);
      if (args[1] === '-b') return { signal: null,  status: 1, stdout: '', stderr: 'unsupported' };
      if (args[0] === 'init') return { signal: null,  status: 0, stdout: '', stderr: '' };
      return { signal: null,  status: 0, stdout: '', stderr: '' }; // symbolic-ref
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'init-fallback');
  assert.deepEqual(calls.map(a => a.join(' ')), ['init -b main', 'init', 'symbolic-ref HEAD refs/heads/main']);
});

test('initializeGitRepository reports a failure when both init attempts fail', () => {
  const result = pc.initializeGitRepository('/repo', {
    spawnSyncFn: () => ({ signal: null,  status: 1, stdout: '', stderr: 'fatal' }),
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
  const spawned: (readonly string[])[] = [];
  const result = pc.commitWorkflowBaseline('/repo', {
    existsSyncFn: (p) => ['workflow', 'workflow.config.json'].includes(path.basename(String(p))),
    spawnSyncFn: (cmd, args) => { spawned.push(args); return { signal: null,  status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(result.committed, true);
  assert.deepEqual(result.files, ['workflow', 'workflow.config.json']);
  assert.ok(spawned.some(a => a.includes('commit')));
});

test('commitWorkflowBaseline reports git add failure', () => {
  const result = pc.commitWorkflowBaseline('/repo', {
    existsSyncFn: () => true,
    spawnSyncFn: () => ({ signal: null,  status: 1, stdout: '', stderr: 'add denied' }),
  });
  assert.equal(result.committed, false);
  if (!result.ok) { assert.ok(result.message); assert.match(result.message, /add denied/); }
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
      spawnSyncFn: () => ({ signal: null,  status: 1, stdout: '', stderr: 'status failed' }),
    });
    assert.equal(result.failed, true);
    if (result.failed && result.message) { assert.match(result.message, /status failed/); }
  } finally { cleanup(repo); }
});

test('ensureStandaloneMissionBaseline fails on conflicted entries', () => {
  const repo = standaloneRepo();
  try {
    const result = pc.ensureStandaloneMissionBaseline(repo, {
      spawnSyncFn: () => ({ signal: null,  status: 0, stdout: 'DD\tsome/file.js\n', stderr: '' }),
    });
    assert.equal(result.failed, true);
    if (result.failed && result.message) { assert.match(result.message, /conflicted files block/); }
  } finally { cleanup(repo); }
});

test('ensureStandaloneMissionBaseline commits clean changes and returns entries', () => {
  const repo = standaloneRepo();
  try {
    const result = pc.ensureStandaloneMissionBaseline(repo, {
      spawnSyncFn: (cmd, args) => {
        if (args.includes('commit')) return { signal: null,  status: 0, stdout: '', stderr: '' };
        return { signal: null,  status: 0, stdout: ' M backlog/tasks/task-1 - X.md\n', stderr: '' };
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
    initializeGitRepositoryFn: () => ({ ok: true as const, branch: 'main', mode: 'init-main' }),
    commitWorkflowBaselineFn: () => ({ ok: true as const, committed: true, files: ['workflow'] }),
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
    initializeGitRepositoryFn: () => ({ ok: false as const, message: 'boom' }),
  });
  assert.equal(result.failed, true);
  assert.equal(result.message, 'boom');
});

// ---------- resolveAgentModel ----------

test('resolveAgentModel returns the configured model and null for missing families', () => {
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { models: { codex: 'gpt-x' } } } }));
    assert.equal(pc.resolveAgentModel('codex', root), 'gpt-x');
    assert.equal(pc.resolveAgentModel('gemini', root), null);
  });
  withTempDir((root) => {
    assert.equal(pc.resolveAgentModel('codex', root), null);
    assert.equal(pc.resolveAgentModel('', root), null);
  });
});

// ---------- evaluateRepositoryReadiness ----------

test('evaluateRepositoryReadiness distinguishes default, invalid-JSON, and configured repos', () => {
  withTempDir((root) => {
    assert.deepEqual(pc.evaluateRepositoryReadiness(root), { mode: 'default', configPath: null, issues: [] });
  });
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{ broken');
    const r = pc.evaluateRepositoryReadiness(root);
    assert.equal(r.mode, 'invalid');
    assert.ok(r.issues[0].startsWith('invalid JSON:'));
  });
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { tasks: {} } }));
    const r = pc.evaluateRepositoryReadiness(root);
    assert.equal(r.mode, 'configured');
    assert.deepEqual(r.issues, []);
  });
  withTempDir((root) => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 0 } } }));
    const r = pc.evaluateRepositoryReadiness(root);
    assert.equal(r.mode, 'invalid');
    assert.ok(r.issues.length > 0);
  });
});
