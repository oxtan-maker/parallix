import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Runtime regression for task-2407: `snapshotWorktreeTopology` must be a
 * callable named export once the real CLI composition graph is loaded.
 *
 * The integrate/handoff runtime loads this graph the same way
 * `src/composition/application-services.ts` does: it dynamically imports
 * `production-capabilities`, which statically imports `board-projection`,
 * which statically imports `snapshotWorktreeTopology` from the git adapter
 * `src/adapters/git/worktree.ts`. When that composition graph is loaded under
 * a circular import, Node fails the named import with
 * "does not provide an export named 'snapshotWorktreeTopology'" before any code
 * runs, so handoff stops at step 1.7 (NEL capture) with no board projection.
 *
 * This test loads the production-relevant graph in that exact order and asserts
 * the export is callable. It imports the real modules (no mocking of the
 * composition graph) so a cyclic-export regression turns it red; it only stubs
 * the git boundary through the adapter's own `gitFn` option, never by replacing
 * the production modules, so it stays a hermetic unit test.
 */

test('task-2407 CLI composition graph provides snapshotWorktreeTopology as a callable named export', async () => {
  // 1. Load the production composition graph the way the handoff runtime does.
  //    This is the import that throws the missing-named-export error under a
  //    circular dependency, so a bare dynamic import is itself the assertion.
  const productionCapabilities = await import('../src/composition/production-capabilities.js');
  assert.equal(
    typeof productionCapabilities.composeProductionCapabilities,
    'function',
    'production-capabilities must load composeProductionCapabilities from the composition graph',
  );

  // 2. Load the handoff use-case so the graph that reaches captureNelAtHandoff
  //    is fully resolved through the same composition entry point.
  const handoffUseCase = await import('../src/application/handoff-command-use-case.js');
  assert.equal(
    typeof handoffUseCase.HandoffCommandUseCase,
    'function',
    'handoff use-case must resolve through the composition graph',
  );

  // 3. The git adapter export must be a callable named export once the graph is
  //    loaded, not an undefined binding from a partially-initialised cycle.
  const worktree = await import('../src/adapters/git/worktree.js');
  assert.equal(
    typeof worktree.snapshotWorktreeTopology,
    'function',
    'snapshotWorktreeTopology must be a callable named export once the CLI composition graph is loaded',
  );
});

test('task-2407 snapshotWorktreeTopology topology resolves a worktree through its own gitFn boundary', async () => {
  const { snapshotWorktreeTopology } = await import('../src/adapters/git/worktree.js');
  let gitCalls = 0;
  const topology = snapshotWorktreeTopology({
    cwd: process.cwd(),
    gitFn: () => {
      gitCalls += 1;
      return { status: 0, stdout: '' };
    },
    currentBranch: () => '',
  });
  assert.equal(typeof topology.resolveWorktree, 'function');
  assert.equal(gitCalls, 1, 'the topology snapshot must read the worktree list once through the injected gitFn');
});
