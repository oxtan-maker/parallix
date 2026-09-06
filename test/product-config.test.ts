// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up



import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const resolveAgentAdapterModule = mockModule<typeof import('../src/adapters/config/product-config.js')>('../src/adapters/config/product-config.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { resolveAgentAdapter } = resolveAgentAdapterModule;
const { DEFAULT_CONFIG, commitWorkflowBaseline, detectLegacyRepoLayout, ensureStandaloneMissionBaseline, ensureStandaloneGitRepo, evaluateRepositoryReadiness, hasGitRepository, initializeGitRepository, isStandaloneWorkflowLayout, loadAdapterConfig, loadEffectiveConfig, loadWorkflowConfig, resolveAgentModel, resolveMaxConcurrentCustom, resolveReviewAdapter, resolveTaskStorage, validateWorkflowConfig } = resolveAgentAdapterModule;

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-product-config-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('detectLegacyRepoLayout identifies the in-repo workflow shape', () => {
  withTempDir(root => {
    fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'missions'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'verify-local.sh'), '#!/usr/bin/env bash\n');

    assert.equal(detectLegacyRepoLayout(root), true);
  });
});

test('isStandaloneWorkflowLayout identifies a drop-in workflow shape', () => {
  withTempDir(root => {
    fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
    fs.writeFileSync(path.join(root, 'workflow', 'index.js'), '// stub\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{}\n');

    assert.equal(isStandaloneWorkflowLayout(root), true);
  });
});

test('isStandaloneWorkflowLayout still recognizes installs when repo also has backlog docs and verify script', () => {
  withTempDir(root => {
    fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
    fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'missions'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'workflow', 'index.js'), '// stub\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{}\n');
    fs.writeFileSync(path.join(root, 'scripts', 'verify-local.sh'), '#!/usr/bin/env bash\n');

    assert.equal(isStandaloneWorkflowLayout(root), true);
  });
});

test('hasGitRepository checks for .git presence', () => {
  withTempDir(root => {
    assert.equal(hasGitRepository(root), false);
    fs.mkdirSync(path.join(root, '.git'));
    assert.equal(hasGitRepository(root), true);
  });
});

test('loadEffectiveConfig returns code-owned defaults when no override file exists', () => {
  withTempDir(root => {
    assert.deepEqual(loadEffectiveConfig(root), DEFAULT_CONFIG);
  });
});

test('loadEffectiveConfig merges a partial override over the defaults', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { verification: { command: './gate.sh' } },
    }, null, 2));

    const effective = loadEffectiveConfig(root);
    // overridden key wins
    assert.equal(effective.adapters.verification.command, './gate.sh');
    // sibling default within the same section is preserved by deep merge
    assert.equal(effective.adapters.verification.defaultArea, 'docs');
    // untouched sections keep their defaults
    assert.equal(effective.adapters.tasks.storage, 'backlog');
  });
});

test('loadEffectiveConfig has no post-integrate hook by default', () => {
  withTempDir(root => {
    const effective = loadEffectiveConfig(root);
    assert.deepEqual(effective.adapters.integrate, {});
  });
});

test('loadEffectiveConfig merges a repo-declared post-integrate hook command', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { integrate: { postIntegrateCommand: './scripts/refresh-px.sh' } },
    }, null, 2));

    const effective = loadEffectiveConfig(root);
    assert.equal(effective.adapters.integrate.postIntegrateCommand, './scripts/refresh-px.sh');
    // unrelated defaults are untouched by declaring the hook
    assert.equal(effective.adapters.verification.defaultArea, 'docs');
  });
});

test('validateWorkflowConfig accepts a partial override (missing sections filled by defaults)', () => {
  const issues = validateWorkflowConfig({
    product: { name: 'Example' },
    adapters: {
      tasks: {},
      missions: {},
    },
  });

  assert.deepEqual(issues, []);
});

test('validateWorkflowConfig rejects non-object top-level values', () => {
  assert.deepEqual(validateWorkflowConfig(null), ['top-level JSON object is required']);
});

test('validateWorkflowConfig rejects non-object product/adapters shapes', () => {
  assert.deepEqual(
    validateWorkflowConfig({ product: [], adapters: {} }),
    ['product must be an object'],
  );
  assert.deepEqual(
    validateWorkflowConfig({ adapters: [] }),
    ['adapters must be an object'],
  );
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { tasks: [] } }),
    ['adapters.tasks must be an object'],
  );
});

test('evaluateRepositoryReadiness distinguishes configured standalone repos', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Standalone' },
      adapters: {
        tasks: {},
        missions: {},
        verification: {},
        review: {},
        agents: {},
      },
    }, null, 2));

    const result = evaluateRepositoryReadiness(root);
    assert.equal(result.mode, 'configured');
    assert.equal(result.issues.length, 0);
  });
});

test('validateWorkflowConfig accepts a full override with all sections', () => {
  const issues = validateWorkflowConfig({
    product: { name: 'MyWorkflow' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog/' },
      missions: { baseDir: 'docs/missions' },
      verification: { command: './scripts/check.sh' },
      review: { provider: 'forgejo', repo: 'myorg/myrepo' },
      agents: {},
    },
  });

  assert.equal(issues.length, 0);
});

test('evaluateRepositoryReadiness returns invalid for a malformed override', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Broken' },
      adapters: [],
    }, null, 2));

    const result = evaluateRepositoryReadiness(root);
    assert.equal(result.mode, 'invalid');
    assert.ok(result.issues.length > 0);
  });
});

test('evaluateRepositoryReadiness reports default mode when no override file exists', () => {
  withTempDir(root => {
    const result = evaluateRepositoryReadiness(root);
    assert.equal(result.mode, 'default');
    assert.deepEqual(result.issues, []);
  });
});

test('initializeGitRepository creates a main branch repo', () => {
  withTempDir(root => {
    const result = initializeGitRepository(root);
    assert.equal(result.ok, true);
    assert.equal(hasGitRepository(root), true);
  });
});

test('initializeGitRepository falls back to git init then symbolic-ref when init -b main is unsupported', () => {
  withTempDir(root => {
    const calls = [];
    const result = initializeGitRepository(root, {
      spawnSyncFn(command, args) {
        calls.push(args.join(' '));
        if (args[0] === 'init' && args[1] === '-b') {
          return { status: 1, stderr: 'unsupported' };
        }
        if (args[0] === 'init') {
          return { status: 0, stdout: 'initialized' };
        }
        if (args[0] === 'symbolic-ref') {
          return { status: 0 };
        }
        return { status: 1 };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'init-fallback');
    assert.deepEqual(calls, ['init -b main', 'init', 'symbolic-ref HEAD refs/heads/main']);
  });
});

test('initializeGitRepository returns a failure payload when git init fallback fails', () => {
  withTempDir(root => {
    const result = initializeGitRepository(root, {
      spawnSyncFn(_command, args) {
        if (args[0] === 'init' && args[1] === '-b') {
          return { status: 1, stderr: 'unsupported' };
        }
        return { status: 1, stderr: 'fatal init error' };
      }
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /fatal init error/);
  });
});

test('ensureStandaloneGitRepo initializes missing git repo for standalone layout and commits baseline', () => {
  withTempDir(root => {
    const calls = [];
    const result = ensureStandaloneGitRepo(root, {
      isStandaloneWorkflowLayoutFn: () => true,
      hasGitRepositoryFn: () => false,
      initializeGitRepositoryFn: () => {
        calls.push('init');
        return { ok: true, branch: 'main', mode: 'init-main' };
      },
      commitWorkflowBaselineFn: () => {
        calls.push('commit');
        return { ok: true, committed: true, files: ['workflow', 'workflow.config.json'] };
      },
    });

    assert.deepEqual(calls, ['init', 'commit']);
    assert.equal(result.initialized, true);
    assert.equal(result.branch, 'main');
    assert.deepEqual(result.baselineCommit.files, ['workflow', 'workflow.config.json']);
  });
});

test('ensureStandaloneGitRepo through real git produces a baseline commit that tracks the exported repo snapshot', () => {
  withTempDir(root => {
    fs.mkdirSync(path.join(root, 'workflow'));
    fs.writeFileSync(path.join(root, 'workflow', 'index.js'), '// stub\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{}\n');
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo"}\n');

    const result = ensureStandaloneGitRepo(root);
    assert.equal(result.initialized, true, JSON.stringify(result));
    assert.ok(result.baselineCommit && result.baselineCommit.committed, JSON.stringify(result));

    const tracked = spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' });
    assert.equal(tracked.status, 0);
    const trackedFiles = tracked.stdout.trim().split('\n').sort();
    assert.deepEqual(trackedFiles, ['package.json', 'workflow.config.json', 'workflow/index.js']);
  });
});

test('commitWorkflowBaseline returns no-workflow-files when nothing to commit', () => {
  withTempDir(root => {
    spawnSync('git', ['init', '-b', 'main'], { cwd: root });
    const result = commitWorkflowBaseline(root);
    assert.equal(result.ok, true);
    assert.equal(result.committed, false);
    assert.equal(result.reason, 'no-workflow-files');
  });
});

test('ensureStandaloneGitRepo skips initialization when repo is not standalone or already has git', () => {
  withTempDir(root => {
    assert.deepEqual(ensureStandaloneGitRepo(root, {
      isStandaloneWorkflowLayoutFn: () => false,
      hasGitRepositoryFn: () => false,
    }), { changed: false, initialized: false });

    assert.deepEqual(ensureStandaloneGitRepo(root, {
      isStandaloneWorkflowLayoutFn: () => true,
      hasGitRepositoryFn: () => true,
    }), { changed: false, initialized: false });
  });
});

test('ensureStandaloneGitRepo returns failed payload when initialization fails', () => {
  withTempDir(root => {
    const result = ensureStandaloneGitRepo(root, {
      isStandaloneWorkflowLayoutFn: () => true,
      hasGitRepositoryFn: () => false,
      initializeGitRepositoryFn: () => ({ ok: false, message: 'boom' }),
    });

    assert.equal(result.failed, true);
    assert.equal(result.message, 'boom');
  });
});

test('ensureStandaloneMissionBaseline auto-commits standalone repo changes before draft', () => {
  withTempDir(root => {
    fs.mkdirSync(path.join(root, 'workflow'));
    fs.writeFileSync(path.join(root, 'workflow', 'index.js'), '// stub\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{}\n');
    ensureStandaloneGitRepo(root);

    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo"}\n');

    const result = ensureStandaloneMissionBaseline(root);
    assert.equal(result.committed, true, JSON.stringify(result));

    const tracked = spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' });
    assert.equal(tracked.status, 0);
    assert.ok(tracked.stdout.split('\n').includes('package.json'));
  });
});

test('ensureStandaloneMissionBaseline skips legacy repos and clean standalone repos', () => {
  withTempDir(root => {
    assert.deepEqual(ensureStandaloneMissionBaseline(root), { changed: false, committed: false, skipped: true });

    fs.mkdirSync(path.join(root, 'workflow'));
    fs.writeFileSync(path.join(root, 'workflow', 'index.js'), '// stub\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{}\n');
    ensureStandaloneGitRepo(root);

    const result = ensureStandaloneMissionBaseline(root);
    assert.equal(result.committed, false);
    assert.equal(result.skipped, false);
  });
});

test('resolveTaskStorage uses configured storage directories when present', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Standalone' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: { tasksDir: 'tracker/open', completedDir: 'tracker/done' } },
        missions: {},
        verification: {},
        review: {},
        agents: {},
      },
    }, null, 2));

    const result = resolveTaskStorage(root);
    assert.equal(result.tasksDir, path.join(root, 'tracker', 'open'));
    assert.equal(result.completedDir, path.join(root, 'tracker', 'done'));
  });
});

test('loadAdapterConfig returns empty object when config is missing or malformed', () => {
  withTempDir(root => {
    assert.deepEqual(loadAdapterConfig(root), {});
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ product: { name: 'x' }, adapters: [] }));
    assert.deepEqual(loadAdapterConfig(root), {});
  });
});

test('resolveTaskStorage supports string storage paths and invalid storage types', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Standalone' },
      adapters: {
        tasks: { storage: 'tracker/tasks' },
        missions: {},
        verification: {},
        review: {},
        agents: {},
      },
    }, null, 2));
    let result = resolveTaskStorage(root);
    assert.equal(result.tasksDir, path.join(root, 'tracker', 'tasks'));
    assert.equal(result.completedDir, path.join(root, 'tracker', 'completed'));

    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Standalone' },
      adapters: {
        tasks: { storage: 42 },
        missions: {},
        verification: {},
        review: {},
        agents: {},
      },
    }, null, 2));
    result = resolveTaskStorage(root);
    assert.equal(result.tasksDir, path.join(root, 'backlog', 'tasks'));
    assert.equal(result.completedDir, path.join(root, 'backlog', 'completed'));
  });
});

test('resolveAgentAdapter returns empty object (command env prefix removed)', () => {
  assert.deepEqual(resolveAgentAdapter('/tmp'), {});
});

test('resolveMaxConcurrentCustom defaults to Infinity and reads a positive configured limit', () => {
  withTempDir(root => {
    assert.equal(resolveMaxConcurrentCustom(root), Infinity);
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { agents: { maxConcurrentCustom: 3 } }
    }), 'utf8');
    assert.equal(resolveMaxConcurrentCustom(root), 3);
  });
});

test('validateWorkflowConfig rejects invalid maxConcurrentCustom values', () => {
  for (const value of [0, -1, 1.5, '2']) {
    assert.deepEqual(
      validateWorkflowConfig({ adapters: { agents: { maxConcurrentCustom: value } } }),
      ['adapters.agents.maxConcurrentCustom must be a positive integer']
    );
  }
});

test('validateWorkflowConfig accepts forgejo, none, and null review providers', () => {
  for (const provider of ['forgejo', 'none', null]) {
    assert.deepEqual(
      validateWorkflowConfig({ adapters: { review: { provider } } }),
      []
    );
  }
});

test('validateWorkflowConfig rejects an unsupported review provider enum value', () => {
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { review: { provider: 'unsupported' } } }),
    ['adapters.review.provider must be one of "forgejo", "none", or null']
  );
});

test('validateWorkflowConfig rejects a non-string, non-null review provider type', () => {
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { review: { provider: 1 } } }),
    ['adapters.review.provider must be one of "forgejo", "none", or null']
  );
});

test('validateWorkflowConfig accepts a string or object tasks.storage', () => {
  assert.deepEqual(validateWorkflowConfig({ adapters: { tasks: { storage: 'backlog' } } }), []);
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { tasks: { storage: { tasksDir: 'a', completedDir: 'b' } } } }),
    []
  );
});

test('validateWorkflowConfig accepts a tasks.storage object with schema-open extra keys', () => {
  // The schema declares the storage object with additionalProperties:true, so a
  // schema-valid config with an extra string-valued key stays valid (task-2455.03 F1).
  assert.deepEqual(
    validateWorkflowConfig({
      adapters: { tasks: { storage: { tasksDir: 'a', completedDir: 'b', draftsDir: 'c' } } },
    }),
    []
  );
});

test('validateWorkflowConfig rejects a non-string, non-object tasks.storage', () => {
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { tasks: { storage: 42 } } }),
    ['adapters.tasks.storage must be a string or an object of string values']
  );
});

test('validateWorkflowConfig rejects a tasks.storage object with a non-string value', () => {
  assert.deepEqual(
    validateWorkflowConfig({
      adapters: { tasks: { storage: { tasksDir: 'a', completedDir: 5 } } },
    }),
    ['adapters.tasks.storage must be a string or an object of string values']
  );
});

test('validateWorkflowConfig rejects a non-string tasks.provider', () => {
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { tasks: { provider: 5 } } }),
    ['adapters.tasks.provider must be a string']
  );
});

test('validateWorkflowConfig rejects a non-string mission field', () => {
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { missions: { branchPrefix: 7 } } }),
    ['adapters.missions.branchPrefix must be a string']
  );
});

test('validateWorkflowConfig rejects a non-string review field', () => {
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { review: { remote: 7 } } }),
    ['adapters.review.remote must be a string']
  );
});

test('validateWorkflowConfig accepts string-valued agent models and rejects non-string values', () => {
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { agents: { models: { codex: 'gpt-5.4-mini' } } } }),
    []
  );
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { agents: { models: { codex: { name: 'x' } } } } }),
    ['adapters.agents.models.codex must be a string']
  );
});

test('validateWorkflowConfig enforces the closed, enum-restricted runners.custom', () => {
  assert.deepEqual(validateWorkflowConfig({ adapters: { agents: { runners: {} } } }), []);
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { agents: { runners: { custom: 'opencode' } } } }),
    []
  );
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { agents: { runners: { custom: 'pi' } } } }),
    []
  );
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { agents: { runners: { custom: 'claude' } } } }),
    ['adapters.agents.runners.custom must be one of "opencode", "pi"']
  );
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { agents: { runners: { claude: 'x' } } } }),
    ['adapters.agents.runners may only contain "custom"']
  );
});

test('validateWorkflowConfig enforces the closed, nullable non-negative subagents.maxParallel', () => {
  assert.deepEqual(validateWorkflowConfig({ adapters: { agents: { subagents: {} } } }), []);
  assert.deepEqual(validateWorkflowConfig({ adapters: { agents: { subagents: { maxParallel: 0 } } } }), []);
  assert.deepEqual(validateWorkflowConfig({ adapters: { agents: { subagents: { maxParallel: null } } } }), []);
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { agents: { subagents: { maxParallel: -1 } } } }),
    ['adapters.agents.subagents.maxParallel must be a non-negative integer or null']
  );
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { agents: { subagents: { maxParallel: 1.5 } } } }),
    ['adapters.agents.subagents.maxParallel must be a non-negative integer or null']
  );
  assert.deepEqual(
    validateWorkflowConfig({ adapters: { agents: { subagents: { limit: 2 } } } }),
    ['adapters.agents.subagents may only contain "maxParallel"']
  );
});

test('validateWorkflowConfig preserves allowed unknown properties', () => {
  assert.deepEqual(
    validateWorkflowConfig({ unknownTop: true, adapters: { tasks: { anything: 1 } } }),
    []
  );
});

// ---------- resolveAgentModel ----------

function withConfigDir(config, fn) {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify(config), 'utf8');
    fn(root);
  });
}

test('resolveAgentModel returns the configured model for a listed family', () => {
  withConfigDir(
    { adapters: { agents: { models: { codex: 'gpt-5.4-mini', claude: 'sonnet-4-20250514' } } } },
    root => {
      assert.equal(resolveAgentModel('codex', root), 'gpt-5.4-mini');
      assert.equal(resolveAgentModel('claude', root), 'sonnet-4-20250514');
    }
  );
});

test('resolveAgentModel returns null for a family not in models', () => {
  withConfigDir(
    { adapters: { agents: { models: { codex: 'gpt-5.4-mini' } } } },
    root => {
      assert.equal(resolveAgentModel('gemini', root), null);
    }
  );
});

test('resolveAgentModel returns null when adapters.agents.models is absent', () => {
  withConfigDir({ adapters: { agents: {} } }, root => {
    assert.equal(resolveAgentModel('codex', root), null);
  });
});

test('resolveAgentModel returns null when no config file exists (defaults)', () => {
  withTempDir(root => {
    assert.equal(resolveAgentModel('codex', root), null);
  });
});

test('resolveAgentModel returns null for empty-string or missing agent family', () => {
  withConfigDir(
    { adapters: { agents: { models: { codex: 'gpt-5.4-mini' } } } },
    root => {
      assert.equal(resolveAgentModel('', root), null);
      assert.equal(resolveAgentModel(undefined, root), null);
    }
  );
});

test('resolveAgentModel returns the configured model for the custom family (task-2337)', () => {
  withConfigDir(
    { adapters: { agents: { models: { custom: 'qwen3.6-27b-q8', codex: 'gpt-5.6-terra' } } } },
    root => {
      assert.equal(resolveAgentModel('custom', root), 'qwen3.6-27b-q8');
    }
  );
});

test('resolveAgentModel returns null for custom when adapters.agents.models.custom is absent (task-2337)', () => {
  withConfigDir(
    { adapters: { agents: { models: { codex: 'gpt-5.6-terra' } } } },
    root => {
      assert.equal(resolveAgentModel('custom', root), null);
    }
  );
});
