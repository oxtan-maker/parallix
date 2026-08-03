import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// SC10 — Single-path guardrail: only the concrete read adapters and
// BoardProjectionBuilder may assemble mission/board/status projections.
// Any module outside this set that imports domain Mission/Review types
// and calls parse primitives directly (without routing through adapters)
// violates the single-path contract.

// ---------------------------------------------------------------------------
// Allowed projection-assembling modules (the concrete adapters + builder)
// ---------------------------------------------------------------------------

const ALLOWED_ASSEMBLERS = new Set([
  'src/adapters/backlog/concrete-mission-read-adapter.ts',
  'src/adapters/backlog/concrete-review-read-adapter.ts',
  'src/adapters/backlog/concrete-gate-read-adapter.ts',
  'src/adapters/backlog/concrete-agent-read-adapter.ts',
  'src/adapters/backlog/concrete-operation-log-read-adapter.ts',
  'src/adapters/backlog/concrete-git-read-adapter.ts',
  'src/adapters/backlog/mission-materialization.ts',
  'src/application/projections/board-readers.ts',
  'src/composition/board-projection.ts',
  // SC8/SC9: status.ts now routes through BoardProjectionBuilder
  'src/platform/runtime/lib/commands/status.ts',
]);

// ---------------------------------------------------------------------------
// Modules that use parse primitives for non-board purposes (allowed)
// These call resolveTaskFile/getTaskStatus etc. but do NOT assemble a
// Mission/Review domain object or board projection.
// ---------------------------------------------------------------------------

const NON_BOARD_CONSUMERS = new Set([
  'src/platform/runtime/lib/commands/handoff.ts',
  'src/platform/runtime/lib/commands/checkpoint.ts',
  'src/platform/runtime/lib/commands/active.ts',
  'src/platform/runtime/lib/commands/draft.ts',
  'src/platform/runtime/lib/commands/review.ts',
  'src/platform/runtime/lib/commands/integrate.ts',
  'src/platform/runtime/lib/commands/rebase.ts',
  'src/platform/runtime/lib/commands/repair-handoff.ts',
  'src/platform/runtime/lib/commands/resolve-conflict.ts',
  'src/platform/runtime/lib/core/mission-utils.ts',
  'src/platform/runtime/lib/tools/backlog.ts',
  'src/platform/runtime/lib/review/review-state.ts',
  'src/platform/runtime/lib/review/review-loop.ts',
  'src/platform/runtime/lib/commands/mutation-gate.ts',
  'src/platform/runtime/lib/commands/setup-review.ts',
  'src/platform/runtime/lib/commands/verify.ts',
]);

// Resolve repo root from the known test/adapters/ location
const repoRoot = path.resolve(process.cwd());

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
      results.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const rel = path.relative(repoRoot, fullPath);
      results.push(rel);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Guardrail tests
// ---------------------------------------------------------------------------

test('SC10: status.ts routes mission output through BoardProjectionBuilder (single-path guardrail)', () => {
  const statusPath = path.join(repoRoot, 'src/platform/runtime/lib/commands/status.ts');
  const content = fs.readFileSync(statusPath, 'utf8');

  // status.ts must import the composition-owned projection builder.
  assert.ok(
    content.includes('composeBoardProjection'),
    'status.ts must import composeBoardProjection for SC8/SC9',
  );

  // status.ts must build the projection through composition.
  assert.ok(
    content.includes('buildProjectionBuilder') || content.includes('composeBoardProjection('),
    'status.ts must instantiate BoardProjectionBuilder for SC8',
  );

  // status.ts must use the projection for mission output (projection.stages or projection.cards)
  assert.ok(
    content.includes('projection.stages') || content.includes('projection.cards'),
    'status.ts must read mission data from the projection for SC9',
  );
});

test('SC10: no module outside the allowed set assembles a board projection', () => {
  const srcDir = path.join(repoRoot, 'src');
  const allTsFiles = findTsFiles(srcDir);

  const violators: string[] = [];

  for (const relPath of allTsFiles) {
    // Skip allowed assemblers and non-board consumers
    if (ALLOWED_ASSEMBLERS.has(relPath) || NON_BOARD_CONSUMERS.has(relPath)) {
      continue;
    }

    // Skip test files and non-command modules
    if (relPath.includes('/test/')) {
      continue;
    }

    const fullPath = path.join(repoRoot, relPath);

    // Skip temp files created by other tests (e.g., __temp-violating-file.ts)
    // and files that disappear between listing and reading (parallel test race).
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');

    // A module assembles a projection if it:
    // 1. Constructs BoardProjectionBuilder
    // 2. OR imports MissionReadAdapter/ReviewReadAdapter etc. and constructs Mission objects
    const importsBuilder =
      content.includes('BoardProjectionBuilder') &&
      content.includes('new BoardProjectionBuilder');
    const constructsMission =
      content.includes('materializeBacklogMission') &&
      !content.includes('import.*materializeBacklogMission.*from.*mission-materialization');

    if (importsBuilder || constructsMission) {
      violators.push(relPath);
    }
  }

  assert.strictEqual(
    violators.length,
    0,
    `Modules outside the allowed set that assemble projections: ${violators.join(', ')}`,
  );
});

test('SC1: BoardProjectionBuilder construction is limited to src/composition/', () => {
  const offenders = findTsFiles(path.join(repoRoot, 'src'))
    .filter((relPath) => !relPath.startsWith('src/composition/'))
    .filter((relPath) => fs.readFileSync(path.join(repoRoot, relPath), 'utf8').includes('new BoardProjectionBuilder'));

  assert.deepEqual(
    offenders,
    [],
    `BoardProjectionBuilder must be constructed only by src/composition/: ${offenders.join(', ')}`,
  );
});

test('SC10: status-projection.ts removed (dead code eliminated)', () => {
  const statusProjPath = path.join(repoRoot, 'src/platform/runtime/lib/commands/status-projection.ts');

  // status-projection.ts should no longer exist (merged into status.ts)
  assert.ok(
    !fs.existsSync(statusProjPath),
    'status-projection.ts should be removed (dead code eliminated, SC9)',
  );

  // index.ts should import status.ts (the dispatched command)
  const indexPath = path.join(repoRoot, 'src/platform/runtime/lib/index.ts');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  assert.ok(
    indexContent.includes('./commands/status') || indexContent.includes('./commands/status.js'),
    'index.ts must import status.ts (the dispatched command)',
  );
});
