const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.env.PARALLIX_HOME) {
  fs.mkdirSync(process.env.PARALLIX_HOME, { recursive: true });
  const isolatedBlocklist = path.join(process.env.PARALLIX_HOME, 'agents.local.json');
  if (!fs.existsSync(isolatedBlocklist)) {
    fs.writeFileSync(isolatedBlocklist, '{"blocklist":{}}\n');
  }
}

const { spawnSync } = require('child_process');

const { createDummyLauncher } = require('./lib/agent-mock');

const {
  isAgentBlocked,
  readAgentConfig,
  selectAgent,
  setCommandPathProbe,
  startAgent,
  updateAgentBlock,
  shouldPersistLaunchFailureBlock
} = require('../lib/agents/agents');

function makeFakeLauncher(scriptedResults, recorder) {
  let attempt = 0;
  return ({ prompt, worktree, env }) => {
    const i = attempt;
    attempt += 1;
    recorder.calls.push({ prompt, worktree, env });
    const scripted = scriptedResults[i] || scriptedResults[scriptedResults.length - 1];
    return {
      invocation: {
        command: 'fake',
        args: [],
        options: { cwd: worktree, env: { ...env } }
      },
      resultPromise: Promise.resolve(scripted)
    };
  };
}

function installPathLaunchers(tmpRoot) {
  const launcher = createDummyLauncher(tmpRoot);
  const binDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const name of ['codex', 'claude', 'gemini', 'opencode', 'vibe']) {
    fs.copyFileSync(launcher, path.join(binDir, name));
    fs.chmodSync(path.join(binDir, name), 0o755);
  }
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  process.env.CODEX_HOME ||= path.join(tmpRoot, 'glm-codex-home');
  setCommandPathProbe(name => fs.existsSync(path.join(binDir, name)));
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Workflow Test',
      GIT_AUTHOR_EMAIL: 'workflow-test@example.com',
      GIT_COMMITTER_NAME: 'Workflow Test',
      GIT_COMMITTER_EMAIL: 'workflow-test@example.com'
    }
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  return result;
}

function withPrimaryAndMissionWorktrees(run) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-cross-worktree-'));
  const primaryWorktree = path.join(tmpRoot, 'primary');
  const missionWorktree = path.join(tmpRoot, 'mission-task-1208');
  const previousCwd = process.cwd();

  try {
    fs.mkdirSync(path.join(primaryWorktree, 'workflow', 'config'), { recursive: true });
    runGit(tmpRoot, ['init', '-b', 'main', primaryWorktree]);
    fs.writeFileSync(
      path.join(primaryWorktree, 'workflow', 'config', 'agents.json'),
      JSON.stringify({
        steps: {
          active: { eligible: ['custom', 'codex'], selection: 'first' },
          review: { eligible: ['custom', 'codex'], selection: 'first' }
        }
      }, null, 2)
    );
    runGit(primaryWorktree, ['add', 'workflow/config/agents.json']);
    runGit(primaryWorktree, ['commit', '-m', 'seed workflow config']);
    runGit(primaryWorktree, ['worktree', 'add', '-b', 'mission/task-1208', missionWorktree]);

    run({
      tmpRoot,
      primaryWorktree,
      missionWorktree,
      missionConfigPath: path.join(missionWorktree, 'workflow', 'config', 'agents.json'),
      primaryLocalPath: path.join(primaryWorktree, 'agents.local.json'),
      missionLocalPath: path.join(missionWorktree, 'agents.local.json'),
      targetPath: path.join(tmpRoot, 'parallix', 'agents.local.json')
    });
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

test('startAgent persists a block via updateAgentBlock when limit-hit detector fires', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-limit-test-'));
  try {
    // Stub selectAgent to deterministic order
    const order = ['claude', 'codex'];
    const selectAgentFn = (step, opts = {}) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set();
      return order.find(a => !exclude.has(a));
    };

    const detectLimitHitFn = ({ agent }) => {
      if (agent === 'claude') return { until: '2026-05-01 18', source: 'parsed' };
      return null;
    };

    const blocks = [];
    const updateAgentBlockFn = (agent, until) => {
      blocks.push({ agent, until });
      return { path: path.join(tmpRoot, 'agents.local.json') };
    };

    // Use a fake launcher table by overriding startAgent through opts.detectLimitHitFn etc.
    // The actual launcher is invoked by agents.js using LAUNCHERS map; we cannot inject it via opts.
    // Instead we exercise the retry path by pinning agentOverride; the detector hits once on first launch
    // and selectAgent picks the second-choice agent (codex).
    // createDummyLauncher installs bare-name launchers on PATH and configures the command probe.
    installPathLaunchers(tmpRoot);
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      const result = await startAgent('review', {
        prompt: 'test',
        worktree: tmpRoot,
        agent: 'claude',
        detectLimitHitFn,
        updateAgentBlockFn,
        selectAgentFn,
        isAgentBlockedFn: () => false,
        log: () => {}
      });
      assert.equal(result.agent, 'codex');
      assert.equal(blocks.length, 1);
      assert.deepEqual(blocks[0], { agent: 'claude', until: '2026-05-01 18' });
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent does not loop forever when WORKFLOW_AGENT is pinned and that agent hits limit', async () => {
  // Regression for the WORKFLOW_AGENT-override blind spot in selectAgent.
  // With WORKFLOW_AGENT=claude pinned and selectAgent honoring exclude, a claude
  // limit-hit must fall through to another eligible family rather than re-picking claude.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-limit-pinned-'));
  try {
    installPathLaunchers(tmpRoot);
    const previousAgent = process.env.WORKFLOW_AGENT;
    process.env.WORKFLOW_AGENT = 'claude';

    try {
      // Real selectAgent: must honor exclude even when WORKFLOW_AGENT is set.
      const config = {
        steps: { review: { eligible: ['claude', 'codex'], selection: 'random' } }
      };
      const { selectAgent } = require('../lib/agents/agents');
      const selectAgentFn = (step, opts = {}) => selectAgent(step, { ...opts, config });

      const detectLimitHitFn = ({ agent }) => {
        if (agent === 'claude') return { until: '2026-05-01 18', source: 'parsed' };
        return null;
      };
      const blocks = [];
      const updateAgentBlockFn = (agent, until) => {
        blocks.push({ agent, until });
        return { path: path.join(tmpRoot, 'agents.local.json') };
      };

      const result = await startAgent('review', {
        prompt: 'test',
        worktree: tmpRoot,
        // No opts.agent — simulates a path where only WORKFLOW_AGENT pins the choice.
        detectLimitHitFn,
        updateAgentBlockFn,
        selectAgentFn,
        log: () => {}
      });
      assert.equal(result.agent, 'codex');
      assert.deepEqual(blocks, [{ agent: 'claude', until: '2026-05-01 18' }]);
    } finally {
      if (previousAgent === undefined) delete process.env.WORKFLOW_AGENT;
      else process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent throws when every eligible agent hits the limit', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-limit-exhausted-'));
  try {
    const order = ['claude', 'codex'];
    const selectAgentFn = (step, opts = {}) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set();
      const next = order.find(a => !exclude.has(a));
      if (!next) {
        throw new Error('All eligible agents are exhausted (limit-hit or excluded).');
      }
      return next;
    };

    const detectLimitHitFn = () => ({ until: '2026-05-01 23', source: 'fallback' });
    const updateAgentBlockFn = () => ({ path: 'noop' });

    installPathLaunchers(tmpRoot);
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      await assert.rejects(
        () => startAgent('review', {
          prompt: 'test',
          worktree: tmpRoot,
          agent: 'claude',
          detectLimitHitFn,
          updateAgentBlockFn,
          selectAgentFn,
          log: () => {}
        }),
        /exhausted/i
      );
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('updateAgentBlock writes { until, reason } to agents.local.json', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-block-reason-'));
  try {
    const targetPath = path.join(tmpRoot, 'agents.local.json');
    const result = updateAgentBlock('codex', '2026-06-01 14', { targetPath, reason: 'transient crash' });
    assert.equal(result.blocklist.codex.until, '2026-06-01 14');
    assert.equal(result.blocklist.codex.reason, 'transient crash');

    const written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    assert.equal(written.blocklist.codex.until, '2026-06-01 14');
    assert.equal(written.blocklist.codex.reason, 'transient crash');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('updateAgentBlock persists reason with limit-hit source description', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-block-limit-reason-'));
  try {
    const targetPath = path.join(tmpRoot, 'agents.local.json');
    const result = updateAgentBlock('claude', '2026-07-01 10', { targetPath, reason: 'parsed: weekly usage limit reached' });
    assert.equal(result.blocklist.claude.reason, 'parsed: weekly usage limit reached');

    const written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    assert.ok(written.blocklist.claude.reason.includes('weekly usage limit reached'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('updateAgentBlock writes a YYYY-MM-DD HH timestamp to agents.local.json and preserves siblings', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-block-write-'));
  try {
    const targetPath = path.join(tmpRoot, 'agents.local.json');
    fs.writeFileSync(targetPath, JSON.stringify({
      _comment: 'preserved',
      blocklist: { gemini: { until: '2026-05-01 12' } }
    }, null, 2));

    const result = updateAgentBlock('claude', '2026-05-02 09', { targetPath });
    assert.equal(result.path, targetPath);
    assert.equal(result.blocklist.claude.until, '2026-05-02 09');
    assert.equal(result.blocklist.gemini.until, '2026-05-01 12');

    const written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    assert.equal(written._comment, 'preserved');
    assert.equal(written.blocklist.claude.until, '2026-05-02 09');
    assert.equal(written.blocklist.gemini.until, '2026-05-01 12');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('updateAgentBlock creates agents.local.json when missing', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-block-create-'));
  try {
    const targetPath = path.join(tmpRoot, 'agents.local.json');
    assert.equal(fs.existsSync(targetPath), false);

    updateAgentBlock('codex', '2026-05-01 15', { targetPath });
    assert.equal(fs.existsSync(targetPath), true);
    const written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    assert.deepEqual(written.blocklist, { codex: { until: '2026-05-01 15' } });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('updateAgentBlock rejects malformed timestamps', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-block-validate-'));
  try {
    const targetPath = path.join(tmpRoot, 'agents.local.json');
    assert.throws(() => updateAgentBlock('codex', '2026-05-01T15:00', { targetPath }), /YYYY-MM-DD HH/);
    assert.throws(() => updateAgentBlock('', '2026-05-01 15', { targetPath }), /agent name/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('updateAgentBlock fails loudly on malformed agents.local.json instead of overwriting it', () => {
  // Regression: a corrupted agents.local.json must NOT be silently replaced by a
  // limit-hit handler. The read path (parseAgentConfigFile) is a hard failure;
  // the write path must match that contract.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-block-malformed-'));
  try {
    const targetPath = path.join(tmpRoot, 'agents.local.json');
    const corrupt = '{ this is not valid json';
    fs.writeFileSync(targetPath, corrupt);

    assert.throws(
      () => updateAgentBlock('codex', '2026-05-01 15', { targetPath }),
      (err) => err && err.code === 'WORKFLOW_AGENT_CONFIG_INVALID' && err.configPath === targetPath
    );

    // Original (corrupt) contents must still be on disk — not silently overwritten.
    assert.equal(fs.readFileSync(targetPath, 'utf8'), corrupt);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('updateAgentBlock fails loudly when agents.local.json is a JSON array at the root', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-block-array-'));
  try {
    const targetPath = path.join(tmpRoot, 'agents.local.json');
    fs.writeFileSync(targetPath, '[]');

    assert.throws(
      () => updateAgentBlock('codex', '2026-05-01 15', { targetPath }),
      /Invalid local agent config/
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('updateAgentBlock from a mission worktree writes PARALLIX_HOME agents.local.json', () => {
  withPrimaryAndMissionWorktrees(({ primaryLocalPath, missionLocalPath, missionWorktree, targetPath }) => {
    fs.writeFileSync(primaryLocalPath, JSON.stringify({
      _comment: 'preserve me',
      blocklist: { claude: { until: '2029-12-31 23' } }
    }, null, 2));

    process.chdir(missionWorktree);
    const result = updateAgentBlock('custom', '2030-01-02 03', { targetPath });

    assert.equal(result.path, targetPath);
    assert.equal(fs.existsSync(missionLocalPath), false, 'mission worktree must not receive the automatic block');
    const written = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    assert.deepEqual(written.blocklist.custom, { until: '2030-01-02 03' });
    assert.ok(fs.existsSync(primaryLocalPath), 'legacy source remains present');
  });
});

test('readAgentConfig in a sibling worktree migrates blocks from the primary worktree', () => {
  withPrimaryAndMissionWorktrees(({ missionConfigPath, primaryLocalPath, targetPath }) => {
    fs.writeFileSync(primaryLocalPath, JSON.stringify({
      blocklist: { custom: { until: '2030-01-02 03' } }
    }, null, 2));

    const config = readAgentConfig(missionConfigPath, { mergeLocal: true, targetPath });

    assert.deepEqual(config.blocklist.custom, { until: '2030-01-02 03' });
    assert.equal(isAgentBlocked('custom', config), true);
  });
});

test('selectAgent excludes a family migrated from primary worktree agents.local.json', () => {
  const previousAgent = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;

  withPrimaryAndMissionWorktrees(({ tmpRoot, missionConfigPath, primaryLocalPath, targetPath }) => {
    installPathLaunchers(tmpRoot);
    fs.writeFileSync(primaryLocalPath, JSON.stringify({
      blocklist: { custom: { until: '2030-01-02 03' } }
    }, null, 2));

    try {
      const config = readAgentConfig(missionConfigPath, { mergeLocal: true, targetPath });
      assert.equal(selectAgent('active', { config }), 'codex');
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
      else delete process.env.WORKFLOW_AGENT;
    }
  });
});

test('updateAgentBlock preserves malformed PARALLIX_HOME agents.local.json', () => {
  withPrimaryAndMissionWorktrees(({ primaryLocalPath, missionLocalPath, missionWorktree, targetPath }) => {
    const corrupt = '{ "blocklist": { "custom": true, } }\n';
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, corrupt);

    process.chdir(missionWorktree);
    assert.throws(
      () => updateAgentBlock('custom', '2030-01-02 03', { targetPath }),
      (err) => err && err.code === 'WORKFLOW_AGENT_CONFIG_INVALID' && err.configPath === targetPath
    );

    assert.equal(fs.readFileSync(targetPath, 'utf8'), corrupt);
    assert.equal(fs.existsSync(primaryLocalPath), false);
    assert.equal(fs.existsSync(missionLocalPath), false);
  });
});

test('existing PARALLIX_HOME blocklist is authoritative and legacy sources remain untouched', () => {
  withPrimaryAndMissionWorktrees(({ missionConfigPath, primaryLocalPath, missionLocalPath, missionWorktree, targetPath }) => {
    fs.writeFileSync(
      path.join(missionWorktree, 'workflow', 'config', 'agents.local.json'),
      JSON.stringify({ blocklist: { custom: false } }, null, 2)
    );
    fs.writeFileSync(missionLocalPath, JSON.stringify({ blocklist: { custom: { blocked: false } } }, null, 2));
    fs.writeFileSync(primaryLocalPath, JSON.stringify({
      blocklist: { custom: { until: '2030-01-02 03' } }
    }, null, 2));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify({
      blocklist: { custom: true }
    }, null, 2));

    const config = readAgentConfig(missionConfigPath, {
      mergeLocal: true, targetPath
    });

    assert.equal(config.blocklist.custom, true);
    assert.equal(isAgentBlocked('custom', config), true);
    assert.ok(fs.existsSync(primaryLocalPath));
    assert.ok(fs.existsSync(missionLocalPath));
  });
});

test('startAgent forwards launcher exit metadata to the limit-hit detector', async () => {
  // Regression for round-5 finding 1: detectLimitHit must be gated on a
  // failed launcher run, not on transcript text alone. agents.js is the only
  // production caller and it must pass status/signal/error so a successful
  // child (status:0 with quoted limit-hit phrases) cannot trigger a block.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-detect-args-'));
  try {
    installPathLaunchers(tmpRoot);
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      const seenDetectArgs = [];
      // Stub detector returns null so the loop exits after one attempt; we
      // only care that agents.js handed the launcher result's exit metadata
      // through to the detector.
      const detectLimitHitFn = (args) => {
        seenDetectArgs.push(args);
        return null;
      };

      const blocks = [];
      const updateAgentBlockFn = (agent, until) => {
        blocks.push({ agent, until });
        return { path: path.join(tmpRoot, 'agents.local.json') };
      };

      await startAgent('review', {
        prompt: 'test',
        worktree: tmpRoot,
        agent: 'claude',
        detectLimitHitFn,
        updateAgentBlockFn,
        selectAgentFn: () => 'claude',
        log: () => {}
      });

      assert.equal(seenDetectArgs.length, 1, 'detector must be called exactly once');
      const args = seenDetectArgs[0];
      assert.equal(args.agent, 'claude');
      // status / signal / error keys must be present on the call so the real
      // detector can gate on launcher failure. Their values come from the
      // child process result and may be number|null|undefined depending on
      // the test harness, but the keys must exist.
      assert.ok(Object.prototype.hasOwnProperty.call(args, 'status'), 'must pass status to detector');
      assert.ok(Object.prototype.hasOwnProperty.call(args, 'signal'), 'must pass signal to detector');
      assert.ok(Object.prototype.hasOwnProperty.call(args, 'error'), 'must pass error to detector');
      assert.equal(blocks.length, 0, 'detector returned null so no block should be persisted');
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent reroutes an explicit agent override that is already in the blocklist', async () => {
  // Regression for round-6 finding 2: explicit `agent:` launches must consult the
  // persisted blocklist before launching. Without this gate, a known-blocked
  // family (e.g. a pinned reviewer carried over from review-state.json) is
  // relaunched immediately and wastes a retry hitting the same limit.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-blocked-override-'));
  try {
    installPathLaunchers(tmpRoot);
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      // Stub the blocklist: claude is currently blocked, codex is free.
      const isAgentBlockedFn = (agent) => agent === 'claude';

      const seenSelectExcludes = [];
      const selectAgentFn = (step, opts = {}) => {
        const exclude = opts.exclude instanceof Set ? opts.exclude : new Set();
        seenSelectExcludes.push([...exclude].sort());
        if (exclude.has('codex')) {
          throw new Error('All eligible agents are exhausted (limit-hit or excluded).');
        }
        return 'codex';
      };

      const detectLimitHitFn = () => null;
      const updateAgentBlockFn = () => ({ path: path.join(tmpRoot, 'agents.local.json') });

      const result = await startAgent('review', {
        prompt: 'test',
        worktree: tmpRoot,
        // Pinned to the blocked family. The harness must reroute to selectAgent
        // before ever calling the launcher, so the result must be codex.
        agent: 'claude',
        isAgentBlockedFn,
        detectLimitHitFn,
        updateAgentBlockFn,
        selectAgentFn,
        log: () => {}
      });

      assert.equal(result.agent, 'codex', 'blocked override must reroute through selectAgent');
      // selectAgent must have been called with claude already in the tried set.
      assert.equal(seenSelectExcludes.length, 1);
      assert.deepEqual(seenSelectExcludes[0], ['claude']);
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent honours opts.exclude as a seed for the tried set (family-separation guard)', async () => {
  // Regression for finding 1: when reviewer fallback is invoked, the implementer
  // family must already be in the tried set so selectAgent cannot pick it as the
  // fallback reviewer.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-exclude-seed-'));
  try {
    installPathLaunchers(tmpRoot);
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      const seenExcludes = [];
      // Reviewer "codex" hits a limit. Without the exclude seed, selectAgent could
      // legitimately pick "claude" (the implementer). With exclude=[claude], the
      // tried-set already has claude on the very first selectAgent call, so the
      // fallback can only be "vibe".
      const order = ['codex', 'claude', 'vibe'];
      const selectAgentFn = (step, opts = {}) => {
        const exclude = opts.exclude instanceof Set ? opts.exclude : new Set();
        seenExcludes.push([...exclude].sort());
        return order.find(a => !exclude.has(a));
      };

      const detectLimitHitFn = ({ agent }) => {
        if (agent === 'codex') return { until: '2026-05-01 18', source: 'parsed' };
        return null;
      };
      const updateAgentBlockFn = () => ({ path: path.join(tmpRoot, 'agents.local.json') });

      const result = await startAgent('review', {
        prompt: 'test',
        worktree: tmpRoot,
        agent: 'codex',
        exclude: ['claude'],
        detectLimitHitFn,
        updateAgentBlockFn,
        selectAgentFn,
        log: () => {}
      });

      // Fallback must be vibe (NOT claude — claude is the implementer).
      assert.equal(result.agent, 'vibe');
      // The fallback selectAgent call must have been invoked with exclude
      // containing both claude (seed) and codex (already-tried original).
      assert.deepEqual(seenExcludes[0], ['claude', 'codex']);
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// Reproduction test for task-1405: deterministic config/setup failures must NOT
// poison the persistent blocklist.  Before the fix these assertions return `true`
// (incorrectly blocking); after the fix they return `false` (correctly allowing
// reroute without blocklist poisoning).
test('shouldPersistLaunchFailureBlock returns false for unsupported CLI flags', () => {
  // Unsupported flag is a deterministic config error — the agent cannot run with
  // the given invocation.  Blocking it wastes retries and poisons agents.local.json.
  const result = { status: 1, stderr: 'Error: unsupported flag: --foobar\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for home/bootstrap failures', () => {
  // Home directory or bootstrap failures are deterministic setup errors.  Blocking
  // the agent family for an hour does not help — the underlying config problem
  // persists and the next retry hits the same failure.
  const result = { status: 1, stderr: 'home bootstrap error: cannot create /tmp/test-home\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for permission-denied on home dirs', () => {
  const result = { status: 1, stderr: 'Error: permission denied accessing home directory\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns true for transient crashes (ECONNRESET)', () => {
  // Network-level transient failures are worth blocking briefly so the retry
  // loop picks a different agent family rather than hammering the same broken
  // backend.
  const result = { status: 1, stderr: 'ECONNRESET: connection reset by peer\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), true);
});

test('shouldPersistLaunchFailureBlock returns true for signal kills (SIGKILL)', () => {
  // Signal-based kills indicate a runtime crash worth blocking temporarily.
  const result = { status: null, signal: 'SIGKILL', error: null };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), true);
});

test('shouldPersistLaunchFailureBlock returns false for custom agent regardless of failure', () => {
  // Custom agents (opencode) are never blocked via the persistent blocklist.
  const result = { status: 1, stderr: 'anything goes wrong\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('custom', result), false);
});

// Reproduction tests for task-1404: websocket/connectivity and provider-reachability
// errors must NOT poison the persistent blocklist. Before the fix these assertions
// return `true` (incorrectly blocking); after the fix they return `false`.
test('shouldPersistLaunchFailureBlock returns false for websocket connection failure (os error 1)', () => {
  // Connectivity/runtime errors like websocket failures are transient infrastructure
  // issues, not quota events. Blocking the agent wastes retries.
  const result = { status: 1, stderr: 'failed to connect to websocket ... Operation not permitted (os error 1)\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for connection refused', () => {
  const result = { status: 1, stderr: 'Error: connection refused to localhost:3000\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for ECONNREFUSED', () => {
  const result = { status: 1, stderr: 'ECONNREFUSED 127.0.0.1:8080\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for provider endpoint unreachable', () => {
  const result = { status: 1, stderr: 'reachability check failed: required provider endpoints are unreachable over HTTP\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for endpoint unreachable', () => {
  const result = { status: 1, stderr: 'Error: endpoint unreachable: api.example.com\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

// New non-blocking patterns for task-1412: timeout, sandbox, connectivity,
// prompt rejection, argument errors, and resource exhaustion.

// (d) Timeout errors
test('shouldPersistLaunchFailureBlock returns false for timeout', () => {
  const result = { status: 1, stderr: 'Error: timeout waiting for response\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for timed out', () => {
  const result = { status: 1, stderr: 'Request timed out: server did not respond in time\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for deadline exceeded', () => {
  const result = { status: 1, stderr: 'Error: deadline exceeded\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for request timed out', () => {
  const result = { status: 1, stderr: 'HTTP request timed out after 30s\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

// (e) Sandbox / permission-denial errors (non-auth)
test('shouldPersistLaunchFailureBlock returns false for sandbox violation', () => {
  const result = { status: 1, stderr: 'Error: sandbox violation — access to host network denied\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for sandbox denied', () => {
  const result = { status: 1, stderr: 'Sandbox denied: container policy blocked execution\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for tool call denied', () => {
  const result = { status: 1, stderr: 'Tool call denied: file_write not permitted in sandbox\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for action denied', () => {
  const result = { status: 1, stderr: 'Action denied: network_request blocked by policy\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for approval denied', () => {
  const result = { status: 1, stderr: 'Approval denied: user did not approve the proposed action\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

// (f) Provider connectivity errors
test('shouldPersistLaunchFailureBlock returns false for EPIPE', () => {
  const result = { status: 1, stderr: 'Error: EPIPE — broken pipe connecting to API\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for ETIMEDOUT', () => {
  const result = { status: 1, stderr: 'Error: ETIMEDOUT connecting to provider\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for ENETUNREACH', () => {
  const result = { status: 1, stderr: 'Error: ENETUNREACH — network unreachable\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for ENOTFOUND', () => {
  const result = { status: 1, stderr: 'Error: ENOTFOUND api.mistral.ai\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for EAI_AGAIN', () => {
  const result = { status: 1, stderr: 'Error: EAI_AGAIN: DNS resolution failed\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for socket hang up', () => {
  const result = { status: 1, stderr: 'Error: socket hang up\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for fetch failed', () => {
  const result = { status: 1, stderr: 'TypeError: fetch failed\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for service unavailable', () => {
  const result = { status: 1, stderr: 'Error: service unavailable\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for gateway timeout', () => {
  const result = { status: 1, stderr: 'Error: gateway timeout (504)\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for overloaded', () => {
  const result = { status: 1, stderr: 'Error: service overloaded\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for temporarily unavailable', () => {
  const result = { status: 1, stderr: 'Error: temporarily unavailable\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for please try again', () => {
  const result = { status: 1, stderr: 'Error: please try again later\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for retry after', () => {
  const result = { status: 1, stderr: 'Error: retry after 60 seconds\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

// (g) Prompt rejection errors
test('shouldPersistLaunchFailureBlock returns false for prompt rejected', () => {
  const result = { status: 1, stderr: 'Error: prompt rejected by content policy\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for prompt blocked', () => {
  const result = { status: 1, stderr: 'Error: prompt blocked\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for content policy', () => {
  const result = { status: 1, stderr: 'Error: content policy violation\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for content filter', () => {
  const result = { status: 1, stderr: 'Error: content filter triggered\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for safety filter', () => {
  const result = { status: 1, stderr: 'Error: safety filter blocked the request\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

// (h) Invocation argument errors
test('shouldPersistLaunchFailureBlock returns false for invalid argument', () => {
  const result = { status: 1, stderr: 'Error: invalid argument: --workspace\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for invalid option', () => {
  const result = { status: 1, stderr: 'Error: invalid option: --yolo\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for invalid parameter', () => {
  const result = { status: 1, stderr: 'Error: invalid parameter: model="gpt-99"\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for missing required', () => {
  const result = { status: 1, stderr: 'Error: missing required argument: --prompt\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for argument error', () => {
  const result = { status: 1, stderr: 'Error: argument error — expected integer\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

// (i) Resource exhaustion errors
test('shouldPersistLaunchFailureBlock returns false for out of memory', () => {
  const result = { status: 1, stderr: 'Error: out of memory\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for OOM', () => {
  const result = { status: 1, stderr: 'Killed: OOM killer invoked\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for memory limit', () => {
  const result = { status: 1, stderr: 'Error: memory limit exceeded (2GB cap)\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('codex', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for context window exceeded', () => {
  const result = { status: 1, stderr: 'Error: context window exceeded (max 128K tokens)\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

test('shouldPersistLaunchFailureBlock returns false for token limit exceeded', () => {
  const result = { status: 1, stderr: 'Error: token limit exceeded\n', stdout: '' };
  assert.equal(shouldPersistLaunchFailureBlock('mistral', result), false);
});

// (j) detectLimitHit guard for status === undefined
const { detectLimitHit } = require('../lib/agents/limit-hit');

test('detectLimitHit returns null when status is undefined (legacy caller)', () => {
  // Legacy callers that don't pass exit metadata must not trigger false-positive
  // limit-hit blocks. When status is undefined, the detector should return null.
  const result = detectLimitHit({
    agent: 'codex',
    stdout: 'you\'ve hit your weekly limit',
    stderr: '',
    status: undefined,
    signal: undefined,
    error: undefined
  });
  assert.equal(result, null, 'detectLimitHit must return null when status is undefined');
});

test('detectLimitHit still fires when status is 1 (explicit failure)', () => {
  // When status is explicitly 1 (failure), limit-hit detection should still work.
  const result = detectLimitHit({
    agent: 'codex',
    stdout: 'you\'ve hit your weekly limit',
    stderr: '',
    status: 1,
    signal: undefined,
    error: undefined
  });
  assert.ok(result !== null, 'detectLimitHit must fire when status is 1');
  assert.equal(result.source, 'fallback');
});
