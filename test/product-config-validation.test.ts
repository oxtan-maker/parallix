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
  resolveGithubPublishConfig,
  resolveReviewAdapter,
  resolveReviewArtifactDir,
  isForgejoReviewEnabled,
  adapterChecklist,
  detectLegacyRepoLayout,
  isStandaloneWorkflowLayout,
  hasGitRepository,
  ensureStandaloneMissionBaseline,
  ensureStandaloneGitRepo,
} from '../src/adapters/config/product-config.js';

// Injected doubles for the git-boundary seams. Cast through `never` so the
// test stays free of a real spawnSync/git dependency.
const initDenied = () => ({ ok: false, message: 'git init denied' }) as never;
const initBoom = (): never => { throw new Error('should not init'); }
const statusFail = () => ({ status: 1, stdout: '', stderr: 'git boom' }) as never;
const conflicted = () => ({ status: 0, stdout: 'DD  conflicted-file\n' }) as never;

function withTempConfig(run: (rootDir: string, config: unknown) => void): void {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcfg-'));
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

test('resolveGithubPublishConfig applies defaults and reads configured values', () => {
  withTempConfig(rootDir => {
    const cfg = resolveGithubPublishConfig(rootDir);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.mainBranch, null);
    assert.equal(cfg.verificationRemote, 'origin');
    assert.equal(cfg.pollIntervalMs, 30000);
    assert.equal(cfg.maxPollAttempts, null);
  });
  withTempConfig(rootDir => {
    writeConfig(rootDir, {
      adapters: { githubPublish: { enabled: true, mainBranch: 'main', pollIntervalMs: 5000, maxPollAttempts: 3 } },
    });
    const cfg = resolveGithubPublishConfig(rootDir);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.mainBranch, 'main');
    assert.equal(cfg.pollIntervalMs, 5000);
    assert.equal(cfg.maxPollAttempts, 3);
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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcfg-fs-'));
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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcfg-base-'));
  try {
    const result = ensureStandaloneMissionBaseline(rootDir, {
      spawnSyncFn: initBoom,
    });
    assert.deepEqual(result, { changed: false, committed: false, skipped: true });
  } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
});

test('ensureStandaloneMissionBaseline reports a failed git status through the injected runner', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcfg-base-'));
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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcfg-base-'));
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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcfg-git-'));
  try {
    const result = ensureStandaloneGitRepo(rootDir, {
      hasGitRepositoryFn: () => true,
      initializeGitRepositoryFn: initBoom,
    });
    assert.deepEqual(result, { changed: false, initialized: false });
  } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
});

test('ensureStandaloneGitRepo reports a failed git init through the injected initializer', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcfg-git-'));
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
