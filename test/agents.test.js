const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NO_COLOR = '1';
const fs = require('fs');
const path = require('path');
const os = require('os');

if (process.env.PARALLIX_HOME) {
  fs.mkdirSync(process.env.PARALLIX_HOME, { recursive: true });
  const isolatedBlocklist = path.join(process.env.PARALLIX_HOME, 'agents.local.json');
  if (!fs.existsSync(isolatedBlocklist)) {
    fs.writeFileSync(isolatedBlocklist, '{"blocklist":{}}\n');
  }
}

const {
  selectAgent,
  eligibleAgentsForStep,
  readAgentConfig,
  startAgent,
  startDraftAgent,
  assertAgentSupported,
  workflowLauncherStatus,
  isAgentBlocked,
  setCommandPathProbe
} = require('../lib/agents/agents');

const { buildClaudeInvocation, resolveClaudeCommand, extractClaudeSessionId } = require('../lib/agents/claude');
const { buildCodexDraftInvocation, resolveCodexCommand, extractCodexSessionId } = require('../lib/agents/codex');
const { buildMistralInvocation, resolveMistralCommand, extractMistralSessionId } = require('../lib/agents/mistral');
const { buildOpencodeInvocation, resolveOpencodeCommand, extractOpencodeSessionId, __setJsonFormatSupportForTest } = require('../lib/agents/opencode');


function formatBlockUntil(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}`;
}

const sharedLauncherBin = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-test-launchers-'));
for (const name of ['codex', 'claude', 'opencode', 'vibe']) {
  const launcherPath = path.join(sharedLauncherBin, name);
  fs.writeFileSync(launcherPath, `#!${process.execPath}\nprocess.exit(0);\n`);
  fs.chmodSync(launcherPath, 0o755);
}
process.env.PATH = `${sharedLauncherBin}${path.delimiter}${process.env.PATH}`;
setCommandPathProbe(name => fs.existsSync(path.join(sharedLauncherBin, name)));

function withPathLaunchers(entries, run) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-test-path-'));
  const binDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const [name, body] of Object.entries(entries)) {
    const file = path.join(binDir, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`);
    fs.chmodSync(file, 0o755);
  }

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
  const cleanup = () => {
    process.env.PATH = previousPath;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  };
  try {
    const result = run();
    if (result && typeof result.then === 'function') {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (err) {
    cleanup();
    throw err;
  }
}

function withCommandPathProbe(available, run) {
  const availableSet = new Set(available);
  setCommandPathProbe(name => availableSet.has(name));
  const restore = () => {
    setCommandPathProbe(name => fs.existsSync(path.join(sharedLauncherBin, name)));
  };
  try {
    const result = run();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

// ---------- isAgentBlocked ----------

test('isAgentBlocked returns false when no blocklist', () => {
  assert.equal(isAgentBlocked('gemini', {}), false);
  assert.equal(isAgentBlocked('gemini', null), false);
});

test('isAgentBlocked handles permanent blocks', () => {
  const config = {
    blocklist: {
      gemini: true,
      claude: { blocked: true },
      codex: false,
      mistral: false
    }
  };
  assert.equal(isAgentBlocked('gemini', config), true);
  assert.equal(isAgentBlocked('claude', config), true);
  assert.equal(isAgentBlocked('codex', config), false);
  assert.equal(isAgentBlocked('mistral', config), false);
  assert.equal(isAgentBlocked('unknown', config), false);
});

test('isAgentBlocked handles timed blocks', () => {
  const future = formatBlockUntil(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const past = formatBlockUntil(new Date(Date.now() - 2 * 60 * 60 * 1000));
  const config = {
    blocklist: {
      gemini: { until: future },
      claude: { until: past }
    }
  };
  assert.equal(isAgentBlocked('gemini', config), true);
  assert.equal(isAgentBlocked('claude', config), false);
});

test('isAgentBlocked ignores invalid date-plus-hour timestamps', () => {
  const config = {
    blocklist: {
      gemini: { until: '2026-05-01T12:00:00Z' },
      claude: { until: '2026-05-01 99' }
    }
  };
  assert.equal(isAgentBlocked('gemini', config), false);
  assert.equal(isAgentBlocked('claude', config), false);
});

test('isAgentBlocked degrades safely on malformed blocklist entries', () => {
  const config = {
    blocklist: {
      gemini: null,
      claude: 'not-an-object',
      codex: 123,
      mistral: []
    }
  };
  assert.equal(isAgentBlocked('gemini', config), false);
  assert.equal(isAgentBlocked('claude', config), false);
  assert.equal(isAgentBlocked('codex', config), false);
  assert.equal(isAgentBlocked('mistral', config), false);
});

// ---------- readAgentConfig ----------

function withTempAgentConfigTree(run) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-config-test-'));
  const projectRoot = path.join(tmpRoot, 'project');
  const configDir = path.join(projectRoot, 'workflow', 'config');
  const mainWorktreePath = path.join(tmpRoot, 'main');
  const configPath = path.join(configDir, 'agents.json');

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(mainWorktreePath, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ steps: { draft: { eligible: ['codex', 'gemini'] } } }));

  try {
    run({
      configPath,
      projectRoot,
      configDir,
      mainWorktreePath,
      targetPath: path.join(tmpRoot, 'parallix', 'agents.local.json')
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

test('readAgentConfig migrates blocklist from workflow/config/agents.local.json', () => {
  withTempAgentConfigTree(({ configPath, configDir, mainWorktreePath, targetPath }) => {
    const localPath = path.join(configDir, 'agents.local.json');
    fs.writeFileSync(localPath, JSON.stringify({ blocklist: { gemini: true } }));

    const config = readAgentConfig(configPath, { mergeLocal: true, mainWorktreePath, targetPath });
    assert.ok(config);
    assert.ok(config.blocklist);
    assert.equal(config.blocklist.gemini, true);
  });
});

test('readAgentConfig migrates blocklist from project root agents.local.json', () => {
  withTempAgentConfigTree(({ configPath, projectRoot, mainWorktreePath, targetPath }) => {
    const rootPath = path.join(projectRoot, 'agents.local.json');
    fs.writeFileSync(rootPath, JSON.stringify({ blocklist: { claude: true } }));

    const config = readAgentConfig(configPath, { mergeLocal: true, mainWorktreePath, targetPath });
    assert.ok(config);
    assert.ok(config.blocklist);
    assert.equal(config.blocklist.claude, true);
  });
});

test('readAgentConfig migrates blocklist from multiple legacy locations', () => {
  withTempAgentConfigTree(({ configPath, projectRoot, configDir, mainWorktreePath, targetPath }) => {
    const rootPath = path.join(projectRoot, 'agents.local.json');
    const legacyPath = path.join(configDir, 'agents.local.json');

    fs.writeFileSync(rootPath, JSON.stringify({ blocklist: { claude: true } }));
    fs.writeFileSync(legacyPath, JSON.stringify({ blocklist: { gemini: true } }));

    const config = readAgentConfig(configPath, { mergeLocal: true, mainWorktreePath, targetPath });
    assert.ok(config);
    assert.ok(config.blocklist);
    assert.equal(config.blocklist.claude, true);
    assert.equal(config.blocklist.gemini, true);
  });
});

// task-1302 (standalone extraction): this test asserts the WrGroceries monorepo
// .gitignore semantics for the embedded `workflow/config/` runtime tree, computed
// against `../..` (the monorepo root). In the standalone parallix repo `../..` is the
// parent code directory, not a git repo, so the assertion does not apply — skip when
// the monorepo host (a .git at `../..`) is not present; it still runs in the monorepo.
const MONOREPO_HOST_PRESENT = fs.existsSync(path.join(__dirname, '..', '..', '.git'));
test('all three agents.local.json blocklist locations are gitignored operator-local state (task-1246)', {
  skip: MONOREPO_HOST_PRESENT ? false : 'monorepo-host gitignore assertion; ../.. is not a git repo in standalone parallix (task-1302)'
}, () => {
  // The agent blocklist is operator-local in every supported location, including the
  // one physically under the runtime tree (workflow/config/). Physical location does
  // not change classification: each is per-operator, gitignored, never committed —
  // distinct from the committed runtime asset workflow/config/agents.json.
  const { execFileSync } = require('node:child_process');
  const repoRoot = path.resolve(__dirname, '..', '..');
  const locations = [
    path.join('workflow', 'config', 'agents.local.json'),
    'agents.local.json', // repo-root
    path.join('some-main-worktree', 'agents.local.json'), // main-worktree (basename pattern)
  ];

  for (const rel of locations) {
    let ignored = true;
    try {
      // git check-ignore exits 0 (and echoes the path) when the path is ignored.
      execFileSync('git', ['check-ignore', '-q', rel], { cwd: repoRoot });
    } catch (err) {
      ignored = err.status === 0;
    }
    assert.equal(ignored, true, `${rel} must be gitignored (operator-local blocklist)`);
  }

  // The committed runtime asset (agent eligibility) is NOT ignored — it is tool-owned.
  let agentsJsonIgnored = false;
  try {
    execFileSync('git', ['check-ignore', '-q', path.join('workflow', 'config', 'agents.json')], { cwd: repoRoot });
    agentsJsonIgnored = true;
  } catch (err) {
    agentsJsonIgnored = err.status === 0;
  }
  assert.equal(agentsJsonIgnored, false, 'workflow/config/agents.json is committed tool-owned state, not operator-local');
});

test('readAgentConfig migrates blocklist from main worktree path', () => {
  withTempAgentConfigTree(({ configPath, mainWorktreePath, targetPath }) => {
    const mainLocalPath = path.join(mainWorktreePath, 'agents.local.json');
    fs.writeFileSync(mainLocalPath, JSON.stringify({ blocklist: { codex: true } }));

    const config = readAgentConfig(configPath, { mergeLocal: true, mainWorktreePath, targetPath });
    assert.ok(config);
    assert.ok(config.blocklist);
    assert.equal(config.blocklist.codex, true);
  });
});

test('readAgentConfig reports legacy conflicts and applies precedence in lookup order', () => {
  withTempAgentConfigTree(({ configPath, projectRoot, configDir, mainWorktreePath, targetPath }) => {
    const legacyPath = path.join(configDir, 'agents.local.json');
    const rootPath = path.join(projectRoot, 'agents.local.json');
    const mainLocalPath = path.join(mainWorktreePath, 'agents.local.json');

    fs.writeFileSync(legacyPath, JSON.stringify({ blocklist: { gemini: true } }));
    fs.writeFileSync(rootPath, JSON.stringify({ blocklist: { gemini: false } }));
    fs.writeFileSync(mainLocalPath, JSON.stringify({ blocklist: { gemini: { blocked: true } } }));

    const warnings = [];
    const config = readAgentConfig(configPath, {
      mergeLocal: true,
      mainWorktreePath,
      targetPath,
      warn: message => warnings.push(message)
    });
    assert.deepEqual(config.blocklist.gemini, { blocked: true });
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /Agent blocklist conflict for "gemini"/);
  });
});

test('readAgentConfig reports and skips malformed workflow/config/agents.local.json during migration', () => {
  withTempAgentConfigTree(({ configPath, configDir, mainWorktreePath, targetPath }) => {
    const localPath = path.join(configDir, 'agents.local.json');
    fs.writeFileSync(localPath, '{ "blocklist": { "gemini": true, } }\n');

    const warnings = [];
    const config = readAgentConfig(configPath, {
      mergeLocal: true, mainWorktreePath, targetPath, warn: message => warnings.push(message)
    });
    assert.deepEqual(config.blocklist, {});
    assert.match(warnings[0], /Skipping malformed legacy agent blocklist/);
  });
});

test('readAgentConfig reports and skips malformed project-root agents.local.json during migration', () => {
  withTempAgentConfigTree(({ configPath, projectRoot, mainWorktreePath, targetPath }) => {
    const rootPath = path.join(projectRoot, 'agents.local.json');
    fs.writeFileSync(rootPath, '{ "blocklist": { "claude": { "until": "2026-05-01 12" }, } }\n');

    const warnings = [];
    readAgentConfig(configPath, {
      mergeLocal: true, mainWorktreePath, targetPath, warn: message => warnings.push(message)
    });
    assert.match(warnings[0], /Skipping malformed legacy agent blocklist/);
  });
});

test('readAgentConfig reports and skips malformed main-worktree agents.local.json during migration', () => {
  withTempAgentConfigTree(({ configPath, mainWorktreePath, targetPath }) => {
    const mainLocalPath = path.join(mainWorktreePath, 'agents.local.json');
    fs.writeFileSync(mainLocalPath, '{ "blocklist": { "codex": true, } }\n');

    const warnings = [];
    readAgentConfig(configPath, {
      mergeLocal: true, mainWorktreePath, targetPath, warn: message => warnings.push(message)
    });
    assert.match(warnings[0], /Skipping malformed legacy agent blocklist/);
  });
});

test('readAgentConfig warns when main-worktree lookup cannot inspect git worktrees', () => {
  withTempAgentConfigTree(({ configPath, targetPath }) => {
    const warnings = [];

    const config = readAgentConfig(configPath, {
      mergeLocal: true,
      targetPath,
      warn: message => warnings.push(message)
    });

    assert.ok(config);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /main-worktree agents\.local\.json/);
  });
});

test('readAgentConfig can merge local blocklists when caller passes the default path explicitly', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-explicit-default-'));
  try {
    const targetPath = path.join(tmpRoot, 'agents.local.json');
    fs.writeFileSync(targetPath, JSON.stringify({ blocklist: { custom: true } }));
    const explicitPath = path.join(__dirname, '..', 'config', 'agents.json');
    const config = readAgentConfig(explicitPath, { mainWorktreePath: null, targetPath });
    assert.ok(config);
    assert.ok(config.blocklist);
    assert.equal(config.blocklist.custom, true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------- eligibleAgentsForStep ----------

test('eligibleAgentsForStep returns config list for a known step', () => {
  const config = {
    steps: {
      draft: { eligible: ['codex', 'gemini'], selection: 'random' }
    }
  };
  assert.deepEqual(eligibleAgentsForStep('draft', { config }), ['codex', 'gemini']);
});

test('eligibleAgentsForStep filters out blocked agents', () => {
  const config = {
    steps: {
      draft: { eligible: ['gemini', 'claude', 'codex'] }
    },
    blocklist: {
      claude: true
    }
  };
  assert.deepEqual(eligibleAgentsForStep('draft', { config }), ['gemini', 'codex']);
});

test('eligibleAgentsForStep honors migrated local blocklists', () => {
  withTempAgentConfigTree(({ configPath, configDir, mainWorktreePath, targetPath }) => {
    const localPath = path.join(configDir, 'agents.local.json');
    fs.writeFileSync(localPath, JSON.stringify({ blocklist: { gemini: true } }));

    assert.deepEqual(
      eligibleAgentsForStep('draft', { configPath, mergeLocal: true, mainWorktreePath, targetPath }),
      ['codex']
    );
  });
});

test('eligibleAgentsForStep falls back to all supported agents when config is absent', () => {
  const eligible = eligibleAgentsForStep('draft', { config: null });
  assert.ok(eligible.includes('codex'));
  assert.ok(eligible.includes('claude'));
  assert.ok(eligible.includes('mistral'));
});

test('eligibleAgentsForStep falls back when step is not in config', () => {
  const config = { steps: {} };
  const eligible = eligibleAgentsForStep('active', { config });
  assert.ok(Array.isArray(eligible));
  assert.ok(eligible.length > 0);
});

// ---------- selectAgent ----------

test('selectAgent respects WORKFLOW_AGENT env override', () => {
  const previous = process.env.WORKFLOW_AGENT;
  process.env.WORKFLOW_AGENT = 'codex';
  try {
    const agent = selectAgent('draft', { config: {} });
    assert.equal(agent, 'codex');
  } finally {
    if (previous === undefined) delete process.env.WORKFLOW_AGENT;
    else process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent bypasses WORKFLOW_AGENT override when it is in the exclude set', () => {
  // Regression: a pinned WORKFLOW_AGENT must not loop forever after a limit hit.
  // Once the override agent is in the exclude set (already tried), selectAgent should
  // fall through to the regular eligible pool minus exclusions.
  const previous = process.env.WORKFLOW_AGENT;
  process.env.WORKFLOW_AGENT = 'claude';
  try {
    const config = {
      steps: {
        review: { eligible: ['claude', 'codex'], selection: 'random' }
      }
    };
    // First call: no exclude → returns the pinned override.
    assert.equal(selectAgent('review', { config }), 'claude');
    // Second call: claude in exclude (post-limit-hit) → must NOT return claude.
    const next = selectAgent('review', { config, exclude: new Set(['claude']) });
    assert.equal(next, 'codex');
  } finally {
    if (previous === undefined) delete process.env.WORKFLOW_AGENT;
    else process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent ignores WORKFLOW_AGENT override when the pinned agent is not in the eligible-and-unblocked pool', () => {
  // Regression: selectAgent must not return a pinned WORKFLOW_AGENT that is
  // hard-blocked in agents.local.json or excluded by step eligibility.
  // workflow/docs/agents.md states that WORKFLOW_AGENT is honored alongside
  // the eligibility config and existing blocklist; an override that lives
  // outside the eligible pool falls through to normal selection rather than
  // burning a retry on a blocked agent.
  const previous = process.env.WORKFLOW_AGENT;
  process.env.WORKFLOW_AGENT = 'claude';
  try {
    // Step eligibility excludes claude, so the override is not in the pool.
    const config = {
      steps: {
        review: { eligible: ['codex'], selection: 'random' }
      }
    };
    const agent = selectAgent('review', { config });
    assert.equal(agent, 'codex', 'override outside the eligible pool must fall through to normal selection');

    // Override is eligible but blocked → still must fall through.
    const blockedConfig = {
      steps: {
        review: { eligible: ['claude', 'codex'], selection: 'random' }
      },
      blocklist: { claude: { until: '2099-12-31 23' } }
    };
    const fallback = selectAgent('review', { config: blockedConfig });
    assert.equal(fallback, 'codex', 'override that is hard-blocked must fall through');
  } finally {
    if (previous === undefined) delete process.env.WORKFLOW_AGENT;
    else process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent throws when WORKFLOW_AGENT override is excluded and pool is empty', () => {
  // If the override is excluded and no other agents are eligible, fail loudly
  // rather than silently re-picking the override or looping.
  const previous = process.env.WORKFLOW_AGENT;
  process.env.WORKFLOW_AGENT = 'claude';
  try {
    const config = {
      steps: {
        review: { eligible: ['claude'], selection: 'random' }
      }
    };
    assert.throws(
      () => selectAgent('review', { config, exclude: new Set(['claude']) }),
      /exhausted/i
    );
  } finally {
    if (previous === undefined) delete process.env.WORKFLOW_AGENT;
    else process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent picks from eligible list when no env override', () => {
  const previous = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  try {
    const config = {
      steps: {
        draft: { eligible: ['codex'], selection: 'random' }
      }
    };
    const agent = selectAgent('draft', { config });
    assert.equal(agent, 'codex');
  } finally {
    if (previous !== undefined) process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent excludes a draft agent blocked by workflow/config/agents.local.json', () => {
  const previous = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  try {
    withTempAgentConfigTree(({ configPath, configDir, mainWorktreePath, targetPath }) => {
      const localPath = path.join(configDir, 'agents.local.json');
      fs.writeFileSync(localPath, JSON.stringify({ blocklist: { gemini: true } }));

      const agent = selectAgent('draft', { configPath, mergeLocal: true, mainWorktreePath, targetPath });
      assert.equal(agent, 'codex');
    });
  } finally {
    if (previous !== undefined) process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent fails fast when effective agent config is malformed', () => {
  const previous = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  try {
    withTempAgentConfigTree(({ configPath, mainWorktreePath, targetPath }) => {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, '{ "blocklist": { "gemini": { "until": "2026-04-25 16" }, } }\n');

      assert.throws(
        () => selectAgent('draft', { configPath, mergeLocal: true, mainWorktreePath, targetPath }),
        /Fix or remove the malformed file before running workflow commands/
      );
    });
  } finally {
    if (previous !== undefined) process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent throws when eligible list is empty', () => {
  const previous = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  try {
    const config = {
      steps: {
        draft: { eligible: [], selection: 'random' }
      }
    };
    assert.throws(() => selectAgent('draft', { config }), /No agents are eligible/);
  } finally {
    if (previous !== undefined) process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent throws with a clear message when all eligible agents are unsupported', () => {
  const previous = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  try {
    withCommandPathProbe([], () => {
      const config = {
        steps: {
          draft: { eligible: ['codex', 'gemini'], selection: 'random' }
        }
      };
      assert.throws(
        () => selectAgent('draft', { config }),
        /No eligible agents have a working launcher/
      );
    });
  } finally {
    if (previous !== undefined) process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent random result is always within the eligible-and-supported set', () => {
  const previous = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  try {
    // Only claude is available.
    withCommandPathProbe(['claude'], () => {
      const config = {
        steps: {
          draft: { eligible: ['codex', 'claude'], selection: 'random' }
        }
      };
      for (let i = 0; i < 10; i++) {
        const agent = selectAgent('draft', { config });
        assert.equal(agent, 'claude', `Expected only claude (codex blocked), got: ${agent}`);
      }
    });
  } finally {
    if (previous !== undefined) process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent weighted result always stays within the available set', () => {
  const previous = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  try {
    const config = {
      steps: {
        active: {
          eligible: ['codex', 'claude', 'gemini'],
          selection: 'weighted',
          weights: { codex: 30, claude: 10, gemini: 60 }
        }
      }
    };
    for (let i = 0; i < 30; i++) {
      const agent = selectAgent('active', { config });
      assert.ok(
        ['codex', 'claude', 'gemini'].includes(agent),
        `Weighted result out of eligible set: ${agent}`
      );
    }
  } finally {
    if (previous !== undefined) process.env.WORKFLOW_AGENT = previous;
  }
});

test('workflowLauncherStatus rejects a launcher that exists but fails its health probe', () => {
  withPathLaunchers({
    codex: 'process.exit(process.argv.includes("--help") ? 1 : 0);'
  }, () => {
    const status = workflowLauncherStatus('codex');
    assert.equal(status.supported, false);
    assert.equal(status.health, 'probe-failed');
    // We don't assert on the exact reason (exit 1 vs EACCES) to remain platform-agnostic
  });
});

test('selectAgent bypasses a broken launcher even when the binary exists', () => {
  const previous = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  try {
    withPathLaunchers({
      codex: 'process.exit(process.argv.includes("--help") ? 1 : 0);'
    }, () => {
      const config = {
        steps: {
          review: { eligible: ['codex', 'claude'], selection: 'random' }
        }
      };
      const agent = selectAgent('review', { config });
      assert.equal(agent, 'claude');
    });
  } finally {
    if (previous === undefined) delete process.env.WORKFLOW_AGENT;
    else process.env.WORKFLOW_AGENT = previous;
  }
});

// ---------- assertAgentSupported (unknown agent) ----------

test('assertAgentSupported throws loudly for an unknown agent name', () => {
  assert.throws(
    () => assertAgentSupported('unknown-agent'),
    /Unknown agent: "unknown-agent"/
  );
});

// ---------- Claude launcher ----------

test('buildClaudeInvocation uses --dangerously-skip-permissions -p in the worktree', () => {
  const invocation = buildClaudeInvocation({
    prompt: 'Execute the mission.',
    worktree: '/tmp/mission-task-088'
  });

  assert.deepEqual(invocation.args, [
    '--dangerously-skip-permissions',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '-p',
    'Execute the mission.'
  ]);
  assert.equal(invocation.options.cwd, '/tmp/mission-task-088');
  assert.equal(invocation.options.stdio, 'inherit');
});

test('buildClaudeInvocation inserts --continue before -p when resume is true', () => {
  const invocation = buildClaudeInvocation({
    prompt: 'Continue the mission.',
    worktree: '/tmp/mission-task-1025',
    resume: true
  });

  assert.deepEqual(invocation.args, [
    '--dangerously-skip-permissions',
    '--continue',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '-p',
    'Continue the mission.'
  ]);
});

test('buildClaudeInvocation uses --resume <id> when resume is true and sessionId is provided', () => {
  const invocation = buildClaudeInvocation({
    prompt: 'Resume the mission.',
    worktree: '/tmp/mission-task-1025',
    resume: true,
    sessionId: 'abc-123-def'
  });

  assert.deepEqual(invocation.args, [
    '--dangerously-skip-permissions',
    '--resume',
    'abc-123-def',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '-p',
    'Resume the mission.'
  ]);
});

test('buildClaudeInvocation ignores sessionId when resume is false (cross-family isolation)', () => {
  const invocation = buildClaudeInvocation({
    prompt: 'Fresh launch.',
    worktree: '/tmp/mission-task-1025',
    resume: false,
    sessionId: 'stale-foreign-id'
  });

  assert.deepEqual(invocation.args, [
    '--dangerously-skip-permissions',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '-p',
    'Fresh launch.'
  ]);
});

test('resolveClaudeCommand returns bare claude', () => {
  assert.equal(resolveClaudeCommand(), 'claude');
});

test('startAgent calls onLaunch callback immediately after process launch', async () => {
  const launches = [];
  const result = await startAgent('review', {
    prompt: 'test',
    selectAgentFn: () => 'claude',
    onLaunch: async (opts) => {
      launches.push(opts);
    }
  });

  assert.equal(launches.length, 1);
  assert.equal(launches[0].agent, 'claude');
  assert.equal(launches[0].invocation.command, 'claude');
  assert.equal(result.result.status, 0);
});

test('startAgent logs no-output diagnostics with agent, step, and child pid', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-no-output-'));
  try {
    const binDir = path.join(tmpRoot, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const launcherPath = path.join(binDir, 'opencode');
    fs.writeFileSync(launcherPath, `#!${process.execPath}
if (process.argv.includes('--help')) process.exit(0);
setTimeout(() => process.exit(0), 75);
`);
    fs.chmodSync(launcherPath, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
    try {
      const log = [];
      const result = await startAgent('active', {
        agent: 'custom',
        prompt: 'Execute.',
        worktree: tmpRoot,
        log: msg => log.push(msg),
        isAgentBlockedFn: () => false,
        noOutputWatchdog: {
          initialDelayMs: 20,
          intervalMs: 20
        }
      });

      assert.equal(result.agent, 'custom');
      assert.equal(result.result.status, 0);
      const diagnostic = log.find(message => /No output yet from custom.*for step "active"/.test(message));
      assert.ok(diagnostic, `expected no-output diagnostic in logs: ${log.join(' | ')}`);
      assert.match(diagnostic, /pid \d+/);
      assert.match(diagnostic, /stdout\/stderr have not produced visible output/);
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------- Mistral launcher ----------

test('buildMistralInvocation uses --prompt --trust --output text in the worktree', () => {
  const invocation = buildMistralInvocation({
    prompt: 'Execute the mission.',
    worktree: '/tmp/mission-task-1117'
  });

  assert.ok(invocation.args.includes('--prompt'));
  assert.ok(invocation.args.includes('Execute the mission.'));
  assert.ok(invocation.args.includes('--trust'));
  assert.ok(invocation.args.includes('--output'));
  assert.ok(invocation.args.includes('text'));
  assert.equal(invocation.options.cwd, '/tmp/mission-task-1117');
  assert.equal(invocation.options.stdio, 'inherit');
});

test('resolveMistralCommand returns bare vibe', () => {
  assert.equal(resolveMistralCommand(), 'vibe');
});

test('extractMistralSessionId returns null (vibe has no stdout resume hint)', () => {
  assert.equal(extractMistralSessionId(null), null);
  assert.equal(extractMistralSessionId(''), null);
  assert.equal(extractMistralSessionId('Session completed successfully'), null);
  assert.equal(extractMistralSessionId('vibe session abc123'), null);
});

// ---------- startAgent FORGEJO_USER propagation ----------
test('startAgent injects FORGEJO_USER into subprocess env', async () => {
  const result = await startAgent('review', {
    prompt: 'Execute the mission.',
    worktree: '/tmp/mission-task-095',
    agent: 'codex',
    config: {},
    isAgentBlockedFn: () => false
  });

  assert.equal(result.agent, 'codex');
  assert.ok(result.invocation);
  assert.ok(result.invocation.options);
  assert.equal(result.invocation.options.env.FORGEJO_USER, 'codex');
});

test('startDraftAgent injects FORGEJO_USER into subprocess env', async () => {
  const result = await startDraftAgent({
    prompt: 'Execute the mission.',
    worktree: '/tmp/mission-task-095',
    agent: 'claude',
    isAgentBlockedFn: () => false
  });

  assert.equal(result.agent, 'claude');
  assert.ok(result.invocation);
  assert.ok(result.invocation.options);
  assert.equal(result.invocation.options.env.FORGEJO_USER, 'claude');
});

test('startAgent merges caller-supplied env with FORGEJO_USER', async () => {
  const result = await startAgent('review', {
    prompt: 'Execute the mission.',
    worktree: '/tmp/mission-task-095',
    agent: 'codex',
    env: { SOME_CUSTOM_VAR: 'custom-value' },
    config: {},
    isAgentBlockedFn: () => false
  });

  assert.equal(result.agent, 'codex');
  assert.ok(result.invocation);
  assert.ok(result.invocation.options);
  assert.equal(result.invocation.options.env.FORGEJO_USER, 'codex');
  assert.equal(result.invocation.options.env.SOME_CUSTOM_VAR, 'custom-value');
  assert.ok(result.invocation.options.env.HOME);
});

test('startAgent harness identity wins over caller-supplied FORGEJO_USER', async () => {
  // Regression: merge order must be { ...env, FORGEJO_USER: agent } so a
  // conflicting caller-supplied FORGEJO_USER cannot override the harness selection.
  const result = await startAgent('review', {
    prompt: 'Execute the mission.',
    worktree: '/tmp/mission-task-095',
    agent: 'codex',
    env: { FORGEJO_USER: 'wrong-identity' },
    config: {},
    isAgentBlockedFn: () => false
  });

  assert.equal(result.invocation.options.env.FORGEJO_USER, 'codex');
});

test('startAgent supports a function for prompt and calls it with chosen agent', async () => {
  const result = await startAgent('review', {
    prompt: (chosen) => `You are ${chosen}.`,
    worktree: '/tmp/mission-task-1051',
    agent: 'codex',
    config: {},
    isAgentBlockedFn: () => false
  });

  assert.equal(result.agent, 'codex');
  assert.ok(result.invocation);
  assert.equal(result.invocation.args.includes('You are codex.'), true);
});

test('startAgent reroutes when the selected agent has no launcher (missing binary)', async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-reroute-missing-'));
  try {
    const log = [];
    const result = await withCommandPathProbe(['claude'], () => startAgent('draft', {
      prompt: 'Execute',
      worktree,
      selectAgentFn: (step, opts) => {
        if (!opts.exclude.has('codex')) return 'codex';
        return 'claude';
      },
      isAgentBlockedFn: () => false,
      log: msg => log.push(msg)
    }));

    assert.equal(result.agent, 'claude');
    assert.ok(log.some(m => m.includes('Agent "codex" launcher is not available')));
    assert.ok(log.some(m => m.includes('Selected agent for step "draft": claude (attempt 2)')));
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('startAgent reroutes when the selected agent fails its health probe', async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-reroute-probe-'));
  try {
    const result = await withPathLaunchers({
      codex: 'process.exit(process.argv.includes("--help") ? 1 : 0);'
    }, async () => {
      const log = [];
      const launchResult = await startAgent('draft', {
        prompt: 'Execute',
        worktree,
        selectAgentFn: (step, opts) => {
          if (!opts.exclude.has('codex')) return 'codex';
          return 'claude';
        },
        isAgentBlockedFn: () => false,
        log: msg => log.push(msg)
      });

      assert.ok(log.some(m => m.includes('Agent "codex" launcher is not available')));
      assert.ok(log.some(m => m.includes('probe-failed')));
      return launchResult;
    });
    assert.equal(result.agent, 'claude');
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('startAgent fails loudly when an unknown agent is requested', async () => {
  try {
    await startAgent('draft', {
      agent: 'unknown-agent-typo',
      isAgentBlockedFn: () => false
    });
    assert.fail('Should have thrown an error for unknown agent');
  } catch (err) {
    assert.equal(err.code, 'UNKNOWN_AGENT');
    assert.ok(err.message.includes('Unknown agent: "unknown-agent-typo"'));
  }
});

test('startDraftAgent harness identity wins over caller-supplied FORGEJO_USER', async () => {
  const result = await startDraftAgent({
    prompt: 'Execute the mission.',
    worktree: '/tmp/mission-task-095',
    agent: 'claude',
    isAgentBlockedFn: () => false,
    env: { FORGEJO_USER: 'wrong-identity' }
  });

  assert.equal(result.invocation.options.env.FORGEJO_USER, 'claude');
});

// ---------- Codex launcher ----------

test('buildCodexDraftInvocation uses exec --sandbox danger-full-access in the worktree with CI env', () => {
  const invocation = buildCodexDraftInvocation({
    prompt: 'Execute the mission.',
    worktree: '/tmp/mission-task-088',
    interactive: false
  });

  assert.deepEqual(invocation.args, [
    'exec',
    '--sandbox',
    'danger-full-access',
    '--cd',
    '/tmp/mission-task-088',
    'Execute the mission.'
  ]);
  assert.equal(invocation.options.cwd, '/tmp/mission-task-088');
  assert.equal(invocation.options.stdio, 'inherit');
});

test('resolveCodexCommand returns bare codex', () => {
  assert.equal(resolveCodexCommand(), 'codex');
});

// ---------- Opencode (custom) launcher ----------

test('buildOpencodeInvocation omits --continue when resume is false', () => {
  __setJsonFormatSupportForTest(true);
  const invocation = buildOpencodeInvocation({
    prompt: 'Execute the mission.',
    worktree: '/tmp/visualBoard-task-1010'
  });

  assert.deepEqual(invocation.args, [
    'run',
    '--pure',
    '--dangerously-skip-permissions',
    '--format',
    'json',
    'Execute the mission.'
  ]);
  assert.equal(invocation.options.cwd, '/tmp/visualBoard-task-1010');
  assert.equal(invocation.options.stdio, 'inherit');
});

test('buildOpencodeInvocation uses --continue when resume is true and no sessionId', () => {
  __setJsonFormatSupportForTest(true);
  const invocation = buildOpencodeInvocation({
    prompt: 'Continue the mission.',
    worktree: '/tmp/visualBoard-task-1010',
    resume: true
  });

  assert.deepEqual(invocation.args, [
    'run',
    '--pure',
    '--dangerously-skip-permissions',
    '--format',
    'json',
    '--continue',
    'Continue the mission.'
  ]);
});

test('buildOpencodeInvocation uses -s <sessionId> when resume is true and sessionId is provided', () => {
  __setJsonFormatSupportForTest(true);
  const invocation = buildOpencodeInvocation({
    prompt: 'Resume the mission.',
    worktree: '/tmp/visualBoard-task-1010',
    resume: true,
    sessionId: 'ses_abc123'
  });

  assert.deepEqual(invocation.args, [
    'run',
    '--pure',
    '--dangerously-skip-permissions',
    '--format',
    'json',
    '-s',
    'ses_abc123',
    'Resume the mission.'
  ]);
});

test('buildOpencodeInvocation ignores sessionId when resume is false (cross-family isolation)', () => {
  __setJsonFormatSupportForTest(true);
  const invocation = buildOpencodeInvocation({
    prompt: 'Fresh launch.',
    worktree: '/tmp/visualBoard-task-1010',
    resume: false,
    sessionId: 'ses_stale456'
  });

  assert.deepEqual(invocation.args, [
    'run',
    '--pure',
    '--dangerously-skip-permissions',
    '--format',
    'json',
    'Fresh launch.'
  ]);
});

test('resolveOpencodeCommand returns bare opencode', () => {
  assert.equal(resolveOpencodeCommand(), 'opencode');
});



// ---------- session-reuse threading ----------

test('startAgent passes resume:false to claude on the first launch and writes a marker', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'startagent-resume-'));
  try {
    let writes = 0;
    const fakeSessions = {
      shouldResume: () => false,
      getSessionId: () => null,
      writeSession: (worktree, slug, role, payload) => {
        writes += 1;
        assert.equal(slug, 'task-1025');
        assert.equal(role, 'implementer');
        assert.equal(payload.agent, 'claude');
        return true;
      }
    };

    const result = await startAgent('active', {
      prompt: 'Execute the mission.',
      worktree: tmpRoot,
      agent: 'claude',
      isAgentBlockedFn: () => false,
      slug: 'task-1025',
      role: 'implementer',
      sessionsModule: fakeSessions,
      log: () => {}
    });

    assert.equal(result.agent, 'claude');
    assert.deepEqual(result.invocation.args, [
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '-p',
      'Execute the mission.'
    ]);
    assert.equal(writes, 1);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent passes resume:true to claude when a matching marker exists', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'startagent-resume-hit-'));
  try {
    const fakeSessions = {
      shouldResume: (worktree, slug, role, agent) => {
        assert.equal(slug, 'task-1025');
        assert.equal(role, 'implementer');
        assert.equal(agent, 'claude');
        return true;
      },
      getSessionId: () => null,
      writeSession: () => true
    };

    const result = await startAgent('act-on-review', {
      prompt: 'Address review.',
      worktree: tmpRoot,
      agent: 'claude',
      isAgentBlockedFn: () => false,
      slug: 'task-1025',
      role: 'implementer',
      sessionsModule: fakeSessions,
      log: () => {}
    });

    assert.deepEqual(result.invocation.args, [
      '--dangerously-skip-permissions',
      '--continue',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '-p',
      'Address review.'
    ]);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent does not pass --continue to non-resume-capable launchers even with a marker', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'startagent-codex-noresume-'));
  try {
    // Even if shouldResume reported true, codex's launcher does not support
    // a per-call resume flag; the resume option must be dropped silently.
    const fakeSessions = {
      shouldResume: () => true,
      getSessionId: () => null,
      writeSession: () => true
    };

    const result = await startAgent('act-on-review', {
      prompt: 'Address review.',
      worktree: tmpRoot,
      agent: 'codex',
      isAgentBlockedFn: () => false,
      slug: 'task-1025',
      role: 'implementer',
      sessionsModule: fakeSessions,
      log: () => {}
    });

    // Codex args do not contain --continue.
    assert.equal(result.invocation.args.includes('--continue'), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('custom is registered in LAUNCHERS and RESOLVERS', () => {
  const agents = require('../lib/agents/agents');
  // LAUNCHERS and RESOLVERS are module-private; verify custom is known by checking KNOWN_AGENT_NAMES
  assert.ok(agents.KNOWN_AGENT_NAMES.includes('custom'), 'custom should be in KNOWN_AGENT_NAMES');
  // Verify custom registration via workflowLauncherStatus
  const status = agents.workflowLauncherStatus('custom');
  assert.equal(status.agent, 'custom');
});

// ---------- Codex resume threading with specific session ID ----------

test('buildCodexDraftInvocation uses specific session ID when provided with resume', () => {
  const inv = buildCodexDraftInvocation({
    prompt: 'test prompt',
    worktree: '/tmp/test',
    resume: true,
    sessionId: '18a15d16-ee3d-4a85-81c8-cbbc7b9c09a2'
  });
  assert.ok(inv.args.includes('exec'));
  assert.ok(inv.args.includes('resume'));
  assert.ok(inv.args.includes('18a15d16-ee3d-4a85-81c8-cbbc7b9c09a2'));
  assert.equal(inv.args.includes('--last'), false);
});

test('buildCodexDraftInvocation falls back to --last when sessionId is null', () => {
  const inv = buildCodexDraftInvocation({
    prompt: 'test prompt',
    worktree: '/tmp/test',
    resume: true,
    sessionId: null
  });
  assert.ok(inv.args.includes('exec'));
  assert.ok(inv.args.includes('resume'));
  assert.ok(inv.args.includes('--last'));
});

test('buildCodexDraftInvocation does not use resume path when resume is false', () => {
  const inv = buildCodexDraftInvocation({
    prompt: 'test prompt',
    worktree: '/tmp/test',
    resume: false,
    sessionId: '18a15d16-ee3d-4a85-81c8-cbbc7b9c09a2'
  });
  assert.equal(inv.args.includes('resume'), false);
});

// ---------- Session ID extraction ----------

test('extractCodexSessionId finds session ID from codex resume hint', () => {
  const stdout = 'To continue this session, run codex resume abc123-def456 --sandbox danger-full-access';
  assert.equal(extractCodexSessionId(stdout), 'abc123-def456');
});

test('extractCodexSessionId finds session ID from Interaction Summary block', () => {
  const stdout = 'Session ID:                 18a15d16-ee3d-4a85-81c8-cbbc7b9c09a2';
  assert.equal(extractCodexSessionId(stdout), '18a15d16-ee3d-4a85-81c8-cbbc7b9c09a2');
});

test('extractCodexSessionId returns null when no session ID found', () => {
  assert.equal(extractCodexSessionId('no session info here'), null);
  assert.equal(extractCodexSessionId(null), null);
  assert.equal(extractCodexSessionId(''), null);
});

// ---------- selectAgent active-step blocklist regression: TASK-1021 ----------

test('selectAgent active-step excludes claude blocked with a future local-hour timestamp (TASK-1021 regression)', () => {
  // Reproduces the TASK-1021 transcript: active.eligible includes both claude and
  // codex, claude has a timed block that has not yet expired, and codex has a
  // working launcher. selectAgent must not return claude.
  const previous = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  try {
    const future = formatBlockUntil(new Date(Date.now() + 8 * 60 * 60 * 1000));
    const config = {
      steps: { active: { eligible: ['codex', 'claude'], selection: 'random' } },
      blocklist: { claude: { until: future } }
    };
    for (let i = 0; i < 10; i++) {
      const agent = selectAgent('active', { config });
      assert.equal(agent, 'codex', `Expected codex (claude timed-blocked until ${future}), got: ${agent}`);
    }
  } finally {
    if (previous !== undefined) process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent active-step excludes claude when permanently blocked', () => {
  const previous = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  try {
    const config = {
      steps: { active: { eligible: ['codex', 'claude'], selection: 'random' } },
      blocklist: { claude: true }
    };
    for (let i = 0; i < 10; i++) {
      const agent = selectAgent('active', { config });
      assert.equal(agent, 'codex', `Expected codex when claude is permanently blocked, got: ${agent}`);
    }
  } finally {
    if (previous !== undefined) process.env.WORKFLOW_AGENT = previous;
  }
});

test('selectAgent active-step applies main-worktree agents.local.json block before preselection', () => {
  // When the main-worktree agents.local.json has a timed block on claude,
  // readAgentConfig must merge it and selectAgent must not return claude.
  // This covers the active-step path specifically (agents.json active.eligible
  // includes claude; block must still exclude it).
  const previous = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  try {
    withTempAgentConfigTree(({ configPath, mainWorktreePath, targetPath }) => {
      const mainLocalPath = path.join(mainWorktreePath, 'agents.local.json');
      const future = formatBlockUntil(new Date(Date.now() + 8 * 60 * 60 * 1000));
      fs.writeFileSync(mainLocalPath, JSON.stringify({ blocklist: { claude: { until: future } } }));

      // Read config the same way active.js does: readAgentConfig with mergeLocal
      const agentConfig = readAgentConfig(configPath, { mergeLocal: true, mainWorktreePath, targetPath });
      assert.ok(
        agentConfig.blocklist && agentConfig.blocklist.claude,
        'main-worktree agents.local.json block for claude must be merged into agentConfig'
      );

      // Build an active-step config using the merged blocklist
      const activeConfig = {
        steps: { active: { eligible: ['codex', 'claude'], selection: 'random' } },
        blocklist: agentConfig.blocklist
      };
      for (let i = 0; i < 5; i++) {
        const agent = selectAgent('active', { config: activeConfig });
        assert.equal(
          agent, 'codex',
          `selectAgent must not return claude when blocked via main-worktree agents.local.json; got: ${agent}`
        );
      }
    });
  } finally {
    if (previous !== undefined) process.env.WORKFLOW_AGENT = previous;
  }
});

// ---------- Launch-failure retry (task-1123) ----------

test('startAgent retries with next agent when first agent exits non-zero (launch failure)', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-launch-fail-'));
  try {
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      const log = [];

      const result = await withPathLaunchers({
        opencode: 'if (process.argv.includes("--help")) process.exit(0); console.error("Error: Model not found"); process.exit(1);'
      }, () => startAgent('draft', {
        prompt: 'Execute the mission.',
        worktree: tmpRoot,
        selectAgentFn: (step, opts) => {
          if (!opts.exclude.has('custom')) return 'custom';
          return 'claude';
        },
        detectLimitHitFn: () => null,
        log: msg => log.push(msg),
      }));

      assert.equal(result.agent, 'claude');
      assert.ok(log.some(m => m.includes('custom') && m.includes('failed to complete')));
      assert.ok(log.some(m => m.includes('claude') && m.includes('attempt 2')));
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent attempts at least 3 eligible agents before giving up (SC 3)', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-three-exhaust-'));
  try {
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      const log = [];

      const error = await withPathLaunchers({
        opencode: 'if (process.argv.includes("--help")) process.exit(0); process.exit(1);',
        vibe: 'if (process.argv.includes("--help")) process.exit(0); process.exit(1);',
        codex: 'if (process.argv.includes("--help")) process.exit(0); process.exit(1);'
      }, () => startAgent('draft', {
        prompt: 'Execute.',
        worktree: tmpRoot,
        selectAgentFn: (step, opts) => {
          if (!opts.exclude.has('custom')) return 'custom';
          if (!opts.exclude.has('mistral')) return 'mistral';
          if (!opts.exclude.has('codex')) return 'codex';
          throw new Error('No agents available');
        },
        detectLimitHitFn: () => null,
        log: msg => log.push(msg)
      }).catch(err => err));

      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('All eligible agents exhausted'));
      assert.ok(error.message.includes('custom'));
      assert.ok(error.message.includes('mistral'));
      assert.ok(error.message.includes('codex'));
      // Each agent should have its own error details
      assert.ok(error.message.includes('exit 1'));
      // Verify all three agents were attempted
      assert.ok(log.some(m => m.includes('custom')));
      assert.ok(log.some(m => m.includes('mistral')));
      assert.ok(log.some(m => m.includes('codex')));
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent retries when first agent fails with non-zero exit code', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-retry-fail-'));
  try {
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      let customAttempted = false;
      let mistralAttempted = false;

      const result = await withPathLaunchers({
        opencode: 'if (process.argv.includes("--help")) process.exit(0); process.exit(1);',
        vibe: 'if (process.argv.includes("--help")) process.exit(0); process.exit(0);'
      }, () => startAgent('draft', {
        prompt: 'Execute.',
        worktree: tmpRoot,
        selectAgentFn: (step, opts) => {
          if (!opts.exclude.has('custom')) { customAttempted = true; return 'custom'; }
          mistralAttempted = true;
          return 'mistral';
        },
        detectLimitHitFn: () => null,
        log: () => {},
      }));

      // Both agents should have been tried
      assert.ok(customAttempted, 'custom should have been attempted');
      assert.ok(mistralAttempted, 'mistral should have been attempted');
      // Result should be mistral (second agent, exited 0)
      assert.equal(result.agent, 'mistral');
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent launch failure includes stderr snippet in log', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-launch-stderr-'));
  try {
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      const log = [];

      const result = await withPathLaunchers({
        opencode: 'if (process.argv.includes("--help")) process.exit(0); require("fs").writeSync(2, "Error: Model not found\\n"); process.exit(1);',
        vibe: 'if (process.argv.includes("--help")) process.exit(0); process.exit(0);'
      }, () => startAgent('draft', {
        prompt: 'Execute.',
        worktree: tmpRoot,
        selectAgentFn: (step, opts) => {
          if (!opts.exclude.has('custom')) return 'custom';
          return 'mistral';
        },
        detectLimitHitFn: () => null,
        log: msg => log.push(msg),
      }));

      assert.equal(result.agent, 'mistral');
      assert.ok(log.some(m => m.includes('Model not found')));
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent launch failure does not retry when limit-hit is detected', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-limit-vs-launch-'));
  try {
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      const log = [];
      let limitHitCount = 0;

      const result = await startAgent('draft', {
        prompt: 'Execute.',
        worktree: tmpRoot,
        selectAgentFn: (step, opts) => {
          if (!opts.exclude.has('custom')) return 'custom';
          return 'mistral';
        },
        detectLimitHitFn: ({ agent }) => {
          if (agent === 'custom') { limitHitCount++; return { until: '2026-05-01 18', source: 'test' }; }
          return null;
        },
        updateAgentBlockFn: () => ({ path: 'noop' }),
        log: msg => log.push(msg),
        
      });

      assert.equal(result.agent, 'mistral');
      assert.equal(limitHitCount, 1, 'limit-hit should have been detected once');
      assert.ok(log.some(m => m.includes('Limit hit detected')));
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent launch failure with signal retries next agent', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-signal-'));
  try {
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      const log = [];

      const result = await withPathLaunchers({
        opencode: 'if (process.argv.includes("--help")) process.exit(0); setTimeout(() => process.kill(process.pid, "SIGKILL"), 20);',
        vibe: 'if (process.argv.includes("--help")) process.exit(0); process.exit(0);'
      }, () => startAgent('draft', {
        prompt: 'Execute.',
        worktree: tmpRoot,
        selectAgentFn: (step, opts) => {
          if (!opts.exclude.has('custom')) return 'custom';
          return 'mistral';
        },
        detectLimitHitFn: () => null,
        log: msg => log.push(msg),
      }));

      assert.equal(result.agent, 'mistral');
      assert.ok(log.some(m => m.includes('custom') && m.includes('signal')));
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------- Draft-specific no-output watchdog (task-1214) ----------

test('resolveNoOutputWatchdogConfig returns draft-specific defaults when step is draft', () => {
  const { resolveNoOutputWatchdogConfig } = require('../lib/agents/agents');

  // Draft step defaults must be 15s initial / 30s interval.
  const draftConfig = resolveNoOutputWatchdogConfig({}, 'draft');
  assert.equal(draftConfig.initialDelayMs, 15_000, 'draft initial delay must be 15000ms');
  assert.equal(draftConfig.intervalMs, 30_000, 'draft interval must be 30000ms');

  // Non-draft step defaults must remain 60s initial / 60s interval.
  const nullConfig = resolveNoOutputWatchdogConfig({}, null);
  assert.equal(nullConfig.initialDelayMs, 60_000, 'null step initial delay defaults to 60000ms');
  assert.equal(nullConfig.intervalMs, 60_000, 'null step interval defaults to 60000ms');

  const activeConfig = resolveNoOutputWatchdogConfig({}, 'active');
  assert.equal(activeConfig.initialDelayMs, 60_000, 'active initial delay must be 60000ms');
  assert.equal(activeConfig.intervalMs, 60_000, 'active interval must be 60000ms');
});

test('draft launch shows agent-stage in no-output watchdog messages', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-draft-stage-'));
  try {
    const previousDraftInitialMs = process.env.WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INITIAL_MS;
    const previousDraftIntervalMs = process.env.WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INTERVAL_MS;
    const binDir = path.join(tmpRoot, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const launcherPath = path.join(binDir, 'opencode');
    fs.writeFileSync(launcherPath, `#!${process.execPath}
if (process.argv.includes('--help')) process.exit(0);
setTimeout(() => process.exit(0), 200);
`);
    fs.chmodSync(launcherPath, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
    // Use env var overrides to make tests fast while still exercising the default-selection
    // logic (no explicit noOutputWatchdog override passed to startAgent)
    process.env.WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INITIAL_MS = '50';
    process.env.WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INTERVAL_MS = '50';

    try {
      const log = [];
      const result = await startAgent('draft', {
        agent: 'custom',
        prompt: 'Execute.',
        worktree: tmpRoot,
        log: msg => log.push(msg),
        isAgentBlockedFn: () => false
      });

      assert.equal(result.agent, 'custom');
      assert.equal(result.result.status, 0);
      const diagnostic = log.find(message => /No output yet from custom.*for step "draft"/.test(message));
      assert.ok(diagnostic, `expected draft no-output diagnostic in logs: ${log.join(' | ')}`);
      assert.ok(diagnostic.includes('starting up') || diagnostic.includes('running'),
        `diagnostic must include agent stage; got: ${diagnostic}`);
    } finally {
      process.env.PATH = previousPath;
      if (previousDraftInitialMs !== undefined) process.env.WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INITIAL_MS = previousDraftInitialMs;
      else delete process.env.WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INITIAL_MS;
      if (previousDraftIntervalMs !== undefined) process.env.WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INTERVAL_MS = previousDraftIntervalMs;
      else delete process.env.WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INTERVAL_MS;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('draft launch preserves the mission worktree in cwd and PWD for child CLIs', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-draft-pwd-'));
  try {
    const binDir = path.join(tmpRoot, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const launcherPath = path.join(binDir, 'opencode');
    fs.writeFileSync(launcherPath, `#!${process.execPath}
if (process.argv.includes('--help')) process.exit(0);
require('fs').writeSync(1, JSON.stringify({ cwd: process.cwd(), pwd: process.env.PWD }));
process.exit(0);
`);
    fs.chmodSync(launcherPath, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;

    try {
      const result = await startAgent('draft', {
        agent: 'custom',
        prompt: 'Execute.',
        worktree: tmpRoot,
        isAgentBlockedFn: () => false
      });

      assert.equal(result.agent, 'custom');
      assert.equal(result.result.status, 0);
      const parsed = JSON.parse(result.result.stdout);
      assert.equal(parsed.cwd, tmpRoot);
      assert.equal(parsed.pwd, tmpRoot);
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('non-draft launch uses generic no-output watchdog', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-generic-watchdog-'));
  try {
    const previousNoOutputInitialMs = process.env.WORKFLOW_AGENT_NO_OUTPUT_INITIAL_MS;
    const previousNoOutputIntervalMs = process.env.WORKFLOW_AGENT_NO_OUTPUT_INTERVAL_MS;
    const binDir = path.join(tmpRoot, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const launcherPath = path.join(binDir, 'vibe');
    fs.writeFileSync(launcherPath, `#!${process.execPath}
if (process.argv.includes('--help')) process.exit(0);
setTimeout(() => process.exit(0), 200);
`);
    fs.chmodSync(launcherPath, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
    // Use env var overrides to make tests fast while still exercising the
    // default-selection logic (no explicit noOutputWatchdog override passed to startAgent)
    process.env.WORKFLOW_AGENT_NO_OUTPUT_INITIAL_MS = '50';
    process.env.WORKFLOW_AGENT_NO_OUTPUT_INTERVAL_MS = '50';

    try {
      const log = [];
      const result = await startAgent('active', {
        agent: 'mistral',
        prompt: 'Execute.',
        worktree: tmpRoot,
        isAgentBlockedFn: () => false,
        updateAgentBlockFn: () => ({}),
        log: msg => log.push(msg)
      });

      assert.equal(result.agent, 'mistral');
      assert.equal(result.result.status, 0);
      const diagnostic = log.find(message => /No output yet from mistral.*for step "active"/.test(message));
      assert.ok(diagnostic, `expected active no-output diagnostic in logs: ${log.join(' | ')}`);
      assert.ok(diagnostic.includes('starting up') || diagnostic.includes('running'),
        `diagnostic must include agent stage; got: ${diagnostic}`);
    } finally {
      process.env.PATH = previousPath;
      if (previousNoOutputInitialMs !== undefined) process.env.WORKFLOW_AGENT_NO_OUTPUT_INITIAL_MS = previousNoOutputInitialMs;
      else delete process.env.WORKFLOW_AGENT_NO_OUTPUT_INITIAL_MS;
      if (previousNoOutputIntervalMs !== undefined) process.env.WORKFLOW_AGENT_NO_OUTPUT_INTERVAL_MS = previousNoOutputIntervalMs;
      else delete process.env.WORKFLOW_AGENT_NO_OUTPUT_INTERVAL_MS;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent throws with clear error when all agents exhausted', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-exhaust-'));
  try {
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      const log = [];

      const error = await withPathLaunchers({
        opencode: 'if (process.argv.includes("--help")) process.exit(0); process.exit(1);',
        vibe: 'if (process.argv.includes("--help")) process.exit(0); process.exit(1);'
      }, () => startAgent('draft', {
        prompt: 'Execute.',
        worktree: tmpRoot,
        selectAgentFn: (step, opts) => {
          if (!opts.exclude.has('custom')) return 'custom';
          if (!opts.exclude.has('mistral')) return 'mistral';
          throw new Error('No agents available');
        },
        detectLimitHitFn: () => null,
        log: msg => log.push(msg)
      }).catch(err => err));

      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('All eligible agents exhausted'));
      assert.ok(error.message.includes('custom'));
      assert.ok(error.message.includes('mistral'));
      assert.ok(error.message.includes('exit 1'));
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------- per-family model override wiring (task-1256) ----------

test('startAgent passes the resolved model to the launcher invocation', async () => {
  const log = [];
  const result = await startAgent('review', {
    prompt: 'test',
    selectAgentFn: () => 'custom',
    resolveAgentModelFn: (agent) => (agent === 'custom' ? 'qwen3.5:9b' : null),
    log: msg => log.push(msg)
  });

  const i = result.invocation.args.indexOf('-m');
  assert.ok(i !== -1, `expected -m flag in args: ${result.invocation.args.join(' ')}`);
  assert.equal(result.invocation.args[i + 1], 'qwen3.5:9b');
  assert.ok(log.some(m => m.includes('Using configured model for') && m.includes('qwen3.5:9b')));
});

test('startAgent omits the model flag when resolveAgentModel returns null', async () => {
  const result = await startAgent('review', {
    prompt: 'test',
    selectAgentFn: () => 'custom',
    resolveAgentModelFn: () => null
  });

  assert.ok(!result.invocation.args.includes('-m'));
});

test('non-limit launch failure with transient error retries and persists a block for non-custom agents', async () => {
  let blockCalls = [];
  const fakeBlockFn = (agent, until) => {
    blockCalls.push({ agent, until });
    return { path: '/fake/agents.local.json', blocklist: {} };
  };

  const error = await withPathLaunchers({
    opencode: 'if (process.argv.includes("--help")) process.exit(0); process.exit(1);',
    vibe: 'if (process.argv.includes("--help")) process.exit(0); process.exit(1);'
  }, () => startAgent('draft', {
    prompt: 'Execute.',
    selectAgentFn: (step, opts) => {
      if (!opts.exclude.has('mistral')) return 'mistral';
      if (!opts.exclude.has('custom')) return 'custom';
      throw new Error('All eligible agents exhausted');
    },
    detectLimitHitFn: () => null,
    updateAgentBlockFn: fakeBlockFn,
    log: () => {}
  }).catch(err => err));

  assert.ok(error instanceof Error);
  assert.ok(error.message.includes('All eligible agents exhausted'));
  assert.equal(blockCalls.length, 1, `transient non-limit failures should persist one block for mistral; got ${JSON.stringify(blockCalls)}`);
  assert.equal(blockCalls[0].agent, 'mistral');
});

test('custom agent is never blocklisted on non-limit launch failures', async () => {
  let blockCalls = [];
  const fakeBlockFn = (agent, until) => {
    blockCalls.push({ agent, until });
    return { path: '/fake/agents.local.json', blocklist: {} };
  };

  const error = await withPathLaunchers({
    opencode: 'if (process.argv.includes("--help")) process.exit(0); process.exit(1);',
    vibe: 'if (process.argv.includes("--help")) process.exit(0); process.exit(1);'
  }, () => startAgent('draft', {
    prompt: 'Execute.',
    selectAgentFn: (step, opts) => {
      if (!opts.exclude.has('custom')) return 'custom';
      if (!opts.exclude.has('mistral')) return 'mistral';
      throw new Error('All eligible agents exhausted');
    },
    detectLimitHitFn: () => null,
    updateAgentBlockFn: fakeBlockFn,
    log: () => {}
  }).catch(err => err));

  assert.ok(error instanceof Error);
  assert.ok(error.message.includes('All eligible agents exhausted'));
  assert.equal(blockCalls.length, 1, `only non-custom agents should be blocklisted on transient failures; got ${JSON.stringify(blockCalls)}`);
  assert.equal(blockCalls[0].agent, 'mistral', 'mistral should be blocked, not custom');
});

test('hard launch failure (model not found) does not blocklist agent family', async () => {
  let blockCalls = [];
  const fakeBlockFn = (agent, until) => {
    blockCalls.push({ agent, until });
    return { path: '/fake/agents.local.json', blocklist: {} };
  };

  const error = await withPathLaunchers({
    opencode: 'if (process.argv.includes("--help")) process.exit(0); console.error("Error: model not found"); process.exit(1);',
    vibe: 'if (process.argv.includes("--help")) process.exit(0); console.error("Error: model not found"); process.exit(1);'
  }, () => startAgent('draft', {
    prompt: 'Execute.',
    selectAgentFn: (step, opts) => {
      if (!opts.exclude.has('mistral')) return 'mistral';
      if (!opts.exclude.has('custom')) return 'custom';
      throw new Error('All eligible agents exhausted');
    },
    detectLimitHitFn: () => null,
    updateAgentBlockFn: fakeBlockFn,
    log: () => {}
  }).catch(err => err));

  assert.ok(error instanceof Error);
  assert.ok(error.message.includes('All eligible agents exhausted'));
  assert.equal(blockCalls.length, 0, `hard failures must not persist blocklist entries; got ${JSON.stringify(blockCalls)}`);
});
