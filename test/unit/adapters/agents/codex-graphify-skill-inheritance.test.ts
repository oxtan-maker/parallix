import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

// Regression coverage for active-worktree graph resolution (TASK-2297).

test('queryGraph from worktree without graph returns actionable missing-graph result (red-to-green)', async () => {
  // Exercise the programmatic queryGraph helper with mocked dependencies.
  // Verify graph lookups stay within the active worktree.
  const tmpRoot = registeredMkdtemp('graphify-codex-repro-');

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

    // Load from source (ESM)
    const { resolveGraphPath, queryGraph } = await import('../../../../src/adapters/filesystem/mission-utils.js');

    // --- Scenario 1: active worktree has NO graph ---
    // resolveGraphPath must return null for the active worktree (no graph)
    const activeResult = resolveGraphPath({ rootDir: activeWorktree });
    assert.strictEqual(activeResult, null,
      'resolveGraphPath must return null when graph.json is absent in active worktree');

    // resolveGraphPath must return absolute path for the sibling worktree (has graph)
    const siblingResult = resolveGraphPath({ rootDir: siblingWorktree });
    assert.ok(siblingResult, 'resolveGraphPath must return result when graph.json exists');
    assert.strictEqual(siblingResult.graphPath, path.join(siblingWorktree, 'graphify-out', 'graph.json'));
    assert.ok((siblingResult.graphPath as string).startsWith('/'), 'graphPath must be absolute');

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
    let capturedArgs: { value: string[] | null } = { value: null };
    const capturingRunner: NonNullable<NonNullable<Parameters<typeof queryGraph>[0]>["commandRunner"]> = (_cmd, args) => {
      capturedArgs.value = args;
      return { status: 0, stdout: 'query output' };
    };

    const queryWithGraph = queryGraph({
      question: 'test question',
      rootDir: activeWorktree,
      commandRunner: capturingRunner,
      log: () => {},
    });

    assert.strictEqual(queryWithGraph.success, true);
    assert.ok(capturedArgs.value, 'commandRunner must have been called');

    // The --graph argument must use the active worktree's path, not the sibling's
    const graphFlagIndex = capturedArgs.value!.indexOf('--graph');
    assert.ok(graphFlagIndex >= 0, '--graph flag must be present in query args');
    const graphPathArg = capturedArgs.value![graphFlagIndex + 1];
    assert.strictEqual(graphPathArg, path.join(activeWorktree, 'graphify-out', 'graph.json'),
      '--graph must use active worktree path, not sibling');
    assert.ok(
      !graphPathArg.includes(path.basename(siblingWorktree)),
      '--graph must NOT contain sibling worktree name'
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Codex launcher sets cwd to active worktree (TASK-2297)', async () => {
  // Exercise the Codex-facing launcher seam to verify worktree isolation.
  const tmpRoot = registeredMkdtemp('graphify-codex-launcher-');

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

    // Load from source (ESM)
    const codex = await import('../../../../src/adapters/agents/codex.js');
    const { __setSpawnAndTeeForTest, __setSessionsForTest, startCodexDraftAgent } = codex;

    // Capture the spawnAndTee call to inspect cwd and env
    let capturedCwd: { value: string | null } = { value: null };
    let capturedEnv: { value: NodeJS.ProcessEnv | null } = { value: null };
    let capturedArgs: { value: string[] | null } = { value: null };
    __setSpawnAndTeeForTest((cmd, args, options) => {
      assert.ok(options?.cwd);
      assert.ok(options.env);
      capturedCwd.value = options.cwd;
      capturedEnv.value = options.env;
      capturedArgs.value = args;
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
      capturedCwd.value,
      activeWorktree,
      'Codex launcher must set cwd to active worktree'
    );

    // The cwd must NOT be the sibling worktree
    assert.ok(
      !capturedCwd.value!.includes(path.basename(siblingWorktree)),
      'Codex launcher cwd must NOT reference sibling worktree'
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
