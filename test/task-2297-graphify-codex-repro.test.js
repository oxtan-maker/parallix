const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Reproduction test for task-2297: graphify does not work for codex
//
// Background: Codex running from a task worktree (e.g. parallix-task-2297)
// invoked `graphify query "..."` and got:
//   error: graph file not found: /home/magnus/code/parallix-task-2294/graphify-out/graph.json
//
// The graphify Python package resolves `graphify-out/graph.json` relative to
// the current working directory. When the agent's CWD diverges from the active
// worktree (e.g. the agent cd's into a subdirectory or the skill invocation
// resolves from a sibling worktree), the lookup silently targets the wrong
// graphify-out/ path.
//
// Fix: AGENTS.md `## graphify` section anchors every graphify subcommand to
// the active worktree using `$(pwd)/graphify-out/graph.json` (or equivalent
// absolute-path resolution) so the path can never resolve to a sibling
// worktree. It also handles the missing-graph case with a check + actionable
// message instead of an uncaught `graph file not found` failure.

const AGENTS_MD = path.resolve(__dirname, '..', 'AGENTS.md');

test('AGENTS.md graphify section anchors graph paths to the active worktree', () => {
  const content = fs.readFileSync(AGENTS_MD, 'utf8');

  // Extract the ## graphify section (from "## graphify" to the next "## " or EOF)
  const match = content.match(/^(## graphify\n[\s\S]*?)(?=^## |\z)/m);
  assert.ok(match, 'AGENTS.md must contain a ## graphify section');
  const section = match[1];

  // Criterion 1: Graph paths must be anchored to the active worktree.
  // The section must use $(pwd)/graphify-out or an equivalent absolute-path
  // expression so the path can never resolve to a sibling worktree.
  assert.ok(
    /\$\(pwd\)\s*\/\s*graphify-out/.test(section) ||
    /--graph\s+["']?\$\{?PWD\}?\/graphify-out/.test(section) ||
    /--graph\s+["']?\$\(\s*pwd\s*\)\s*\/\s*graphify-out/.test(section),
    'graphify commands must anchor graph paths to $(pwd)/graphify-out ' +
    '(not bare graphify-out/) so lookups never resolve to a sibling worktree'
  );
});

test('AGENTS.md graphify section handles missing graph actionably', () => {
  const content = fs.readFileSync(AGENTS_MD, 'utf8');

  const match = content.match(/^(## graphify\n[\s\S]*?)(?=^## |\z)/m);
  assert.ok(match, 'AGENTS.md must contain a ## graphify section');
  const section = match[1];

  // Criterion 2: When graphify-out/graph.json is absent, the instructions
  // must provide an actionable result (e.g. a conditional check + message
  // or a clear "build first" hint) instead of an uncaught error.
  assert.ok(
    /\[ -f/.test(section) && /graphify-out/.test(section) ||
    /if.*graphify-out.*graph\.json/.test(section) ||
    /graphify-out\/graph\.json.*exists/.test(section) &&
    /build|extract|create|run.*\/graphify/.test(section),
    'graphify section must handle missing graph actionably ' +
    '(conditional check with actionable guidance, not bare error)'
  );
});

test('queryGraph from worktree without graph returns actionable missing-graph result (red-to-green)', async () => {
  // Exercise the programmatic queryGraph helper with mocked dependencies.
  // This verifies the active-worktree resolution path that the Codex-facing
  // query uses via the AGENTS.md instruction mechanism.
  const os = require('node:os');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-codex-repro-'));

  try {
    // Active worktree: has graphify-out/ but no graph.json
    const activeWorktree = path.join(tmpRoot, 'active');
    fs.mkdirSync(path.join(activeWorktree, 'graphify-out'), { recursive: true });

    // Sibling worktree: has graphify-out/graph.json (the stale path)
    const siblingWorktree = path.join(tmpRoot, 'sibling');
    fs.mkdirSync(path.join(siblingWorktree, 'graphify-out'), { recursive: true });
    fs.writeFileSync(
      path.join(siblingWorktree, 'graphify-out', 'graph.json'),
      JSON.stringify({ nodes: [], edges: [] }),
      'utf8'
    );

    // Load from the compiled dist bundle (CJS entry used by mission-utils-graphify.test.ts)
    const { resolveGraphPath, queryGraph } = require(path.resolve(__dirname, '..', 'dist/lib/core/mission-utils'));

    // --- Scenario 1: active worktree has NO graph ---
    // resolveGraphPath must return null for the active worktree (no graph)
    const activeResult = resolveGraphPath({ rootDir: activeWorktree });
    assert.strictEqual(activeResult, null,
      'resolveGraphPath must return null when graph.json is absent in active worktree');

    // resolveGraphPath must return absolute path for the sibling worktree (has graph)
    const siblingResult = resolveGraphPath({ rootDir: siblingWorktree });
    assert.ok(siblingResult, 'resolveGraphPath must return result when graph.json exists');
    assert.strictEqual(siblingResult.graphPath, path.join(siblingWorktree, 'graphify-out', 'graph.json'));
    assert.ok(siblingResult.graphPath.startsWith('/'), 'graphPath must be absolute');

    // queryGraph must return actionable missing-graph for active worktree (mocked)
    const queryResult = queryGraph({
      question: 'test',
      rootDir: activeWorktree,
      commandRunner: () => ({ status: 0, stdout: '' }),
      log: () => {},
    });
    assert.strictEqual(queryResult.success, false);
    assert.strictEqual(queryResult.reason, 'missing-graph',
      'queryGraph must return actionable missing-graph for worktree without graph');

    // The missing-graph result MUST NOT reference the sibling path
    // (the stale-sibling regression: query should use active path, not sibling)
    assert.ok(
      !queryResult.output || !queryResult.output.includes(siblingWorktree),
      'missing-graph result must NOT reference sibling worktree path'
    );

    // --- Scenario 2: active worktree HAS graph — verify --graph uses active path ---
    // Give the active worktree a graph.json
    fs.writeFileSync(
      path.join(activeWorktree, 'graphify-out', 'graph.json'),
      JSON.stringify({ nodes: [{ id: 'active' }], edges: [] }),
      'utf8'
    );

    // Capturing command runner: record the arguments passed to graphify
    let capturedArgs = null;
    const capturingRunner = (cmd, args) => {
      capturedArgs = args;
      return { status: 0, stdout: 'query output' };
    };

    const queryWithGraph = queryGraph({
      question: 'test question',
      rootDir: activeWorktree,
      commandRunner: capturingRunner,
      log: () => {},
    });

    assert.strictEqual(queryWithGraph.success, true);
    assert.ok(capturedArgs, 'commandRunner must have been called');

    // The --graph argument must use the active worktree's path, not the sibling's
    const graphFlagIndex = capturedArgs.indexOf('--graph');
    assert.ok(graphFlagIndex >= 0, '--graph flag must be present in query args');
    const graphPathArg = capturedArgs[graphFlagIndex + 1];
    assert.strictEqual(graphPathArg, path.join(activeWorktree, 'graphify-out', 'graph.json'),
      '--graph must use active worktree path, not sibling');
    assert.ok(
      !graphPathArg.includes(path.basename(siblingWorktree)),
      '--graph must NOT contain sibling worktree name'
    );

    // Verify AGENTS.md instructs agents to use --graph with absolute path
    const content = fs.readFileSync(AGENTS_MD, 'utf8');
    assert.ok(
      /--graph.*\$\(pwd\).*graphify-out/.test(content),
      'AGENTS.md must instruct agents to use --graph with $(pwd)-anchored path'
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Codex launcher sets cwd to active worktree so $(pwd)/graphify-out resolves correctly', async () => {
  // Exercise buildCodexDraftInvocation at the real Codex-facing seam.
  // The Codex launcher sets cwd: worktree, which makes $(pwd) in the agent's
  // shell resolve to the active worktree. Combined with AGENTS.md instructions
  // to use $(pwd)/graphify-out/graph.json, this ensures the graph path never
  // resolves to a sibling worktree.
  const os = require('node:os');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-codex-launcher-'));

  try {
    // Active worktree: has graphify-out/graph.json
    const activeWorktree = path.join(tmpRoot, 'active-worktree');
    fs.mkdirSync(path.join(activeWorktree, 'graphify-out'), { recursive: true });
    fs.writeFileSync(
      path.join(activeWorktree, 'graphify-out', 'graph.json'),
      JSON.stringify({ nodes: [], edges: [] }),
      'utf8'
    );

    // Sibling worktree: also has graphify-out/graph.json (the stale path)
    const siblingWorktree = path.join(tmpRoot, 'sibling-worktree');
    fs.mkdirSync(path.join(siblingWorktree, 'graphify-out'), { recursive: true });
    fs.writeFileSync(
      path.join(siblingWorktree, 'graphify-out', 'graph.json'),
      JSON.stringify({ nodes: [], edges: [] }),
      'utf8'
    );

    // Load buildCodexDraftInvocation from the compiled dist bundle
    const { __setSpawnAndTeeForTest, __setSessionsForTest, startCodexDraftAgent } =
      require(path.resolve(__dirname, '..', 'dist/lib/agents/codex'));

    // Capture the spawnAndTee call to inspect cwd and env
    let capturedCwd = null;
    let capturedEnv = null;
    let capturedArgs = null;
    __setSpawnAndTeeForTest((cmd, args, options) => {
      capturedCwd = options.cwd;
      capturedEnv = options.env;
      capturedArgs = args;
      return Promise.resolve({
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        error: null,
      });
    });
    __setSessionsForTest({ findLatestSessionId: () => null });

    // Invoke Codex with the active worktree
    startCodexDraftAgent({
      prompt: 'test prompt',
      worktree: activeWorktree,
      interactive: false,
    });

    // The cwd must be the active worktree, not the sibling
    assert.strictEqual(
      capturedCwd,
      activeWorktree,
      'Codex launcher must set cwd to active worktree'
    );

    // The cwd must NOT be the sibling worktree
    assert.ok(
      !capturedCwd.includes(path.basename(siblingWorktree)),
      'Codex launcher cwd must NOT reference sibling worktree'
    );

    // Verify AGENTS.md instructs agents to use $(pwd)/graphify-out
    // which resolves correctly because cwd is the active worktree
    const content = fs.readFileSync(AGENTS_MD, 'utf8');
    assert.ok(
      /\$\(pwd\)\s*\/\s*graphify-out/.test(content),
      'AGENTS.md must anchor graph paths to $(pwd)/graphify-out so they resolve correctly with cwd=worktree'
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
