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
  updateAgentBlock
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
      // fallback can only be "mistral".
      const order = ['codex', 'claude', 'mistral'];
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

      // Fallback must be mistral (NOT claude — claude is the implementer).
      assert.equal(result.agent, 'mistral');
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
