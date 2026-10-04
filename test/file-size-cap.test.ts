/**
 * TASK-2596 — 500-line cap on production source files.
 *
 * Deterministic guardrail: every applicable TypeScript production source
 * file (src/ and web/, mirroring the production include set in
 * tsconfig.json) must stay at or under 500 physical lines unless it is named
 * in the explicit exception list below. The check runs in the default
 * (unit) suite, so the cap is enforced on every `npm test`.
 *
 * The failure message deliberately directs a cohesive refactor rather than a
 * cosmetic file split: the point of the cap is to keep files reviewable by
 * pushing changes toward real module boundaries.
 *
 * The exception list is pre-existing debt only. Each entry is an exact file
 * path, worked down in dedicated missions; the narrow-exception test below
 * fails when an entry goes stale so the list cannot quietly rot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const MAX_LINES = 500;

/**
 * Production source roots, mirroring the `src/**` and `web/**` include
 * entries in tsconfig.json. Generated files, dependencies, build output,
 * documentation, and test fixtures are not under these roots and are
 * therefore not applicable.
 */
const SOURCE_ROOTS = ['src', 'web'] as const;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

/**
 * Pre-existing debt: every applicable file already over the cap when this
 * guardrail was introduced (TASK-2596), as exact paths, sorted. Remove an
 * entry once its file is at or under MAX_LINES — the narrow-exception test
 * fails while a stale entry remains.
 */
const EXCEPTIONS: readonly string[] = [
  'src/adapters/agents/agents.ts',
  'src/adapters/backlog/legacy-mission-import.ts',
  'src/adapters/cli/commands/active.ts',
  'src/adapters/cli/commands/draft-stats.ts',
  'src/adapters/cli/commands/stats-report-rendering.ts',
  'src/adapters/config/product-config.ts',
  'src/adapters/config/repository-gates.ts',
  'src/adapters/forgejo/forgejo-git.ts',
  'src/adapters/forgejo/forgejo-pr.ts',
  'src/adapters/review/review-artifacts.ts',
  'src/adapters/review/review-commands.ts',
  'src/adapters/review/review-events.ts',
  'src/adapters/review/review-loop.ts',
  'src/adapters/review/review-state.ts',
  'src/adapters/sqlite/database-adapter.ts',
  'src/adapters/sqlite/importer.ts',
  'src/adapters/sqlite/mission-serialization.ts',
  'src/adapters/sqlite/mission-store.ts',
  'src/application/handoff-command-use-case.ts',
  'src/application/projections/metrics-read-adapter.ts',
  'src/application/projections/metrics.ts',
  'src/application/rebase-workflow.ts',
  'src/application/rebound-kernel.ts',
  'src/application/recovery-supervisor.ts',
  'src/composition/create-cli.ts',
  'src/domain/review.ts',
  'src/interfaces/tui/shell.tsx',
  'src/interfaces/web/host.ts',
  'src/interfaces/web/transport.ts',
];

const REMEDIATION_GUIDANCE = `
Remediation: do not merely split the file into smaller chunks. Refactor it
so that a senior engineer would approve the result: extract cohesive
modules with a single, named responsibility each (a use case, an adapter,
a projection, a command handler), and let file sizes fall out of the
design. The exception list in this file is for pre-existing debt only —
work each entry down in a dedicated mission and remove it. If a file
genuinely cannot be brought under the cap by a cohesive refactor, raise
that in review instead of adding an exception.`;

/** Physical line count: newline-terminated lines, plus a final line that lacks a trailing newline. */
function physicalLineCount(content: string): number {
  if (content === '') { return 0; }
  let newlines = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) { newlines += 1; }
  }
  return content.endsWith('\n') ? newlines : newlines + 1;
}

/**
 * Recursively collect applicable production source files as sorted
 * repo-relative paths with POSIX separators, so the EXCEPTIONS literals
 * match on every platform. Native separators are used only for absolute
 * filesystem paths.
 */
function collectSourceFiles(): string[] {
  const found: string[] = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    const stack: string[] = [sourceRoot];
    while (stack.length > 0) {
      const relative = stack.pop() as string;
      for (const entry of fs.readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
        const child = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) {
          stack.push(child);
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
          found.push(child);
        }
      }
    }
  }
  found.sort();
  return found;
}

/** Precomputed once per process: the applicable set with measured line counts. */
const applicableFiles: ReadonlyArray<{ path: string; lines: number }> = collectSourceFiles()
  .map(file => ({
    path: file,
    lines: physicalLineCount(fs.readFileSync(path.join(ROOT, file), 'utf8')),
  }));

const exceptionSet = new Set(EXCEPTIONS);

// Test files are kept separate for readability. A faster runner may group
// their execution, but must not turn those groups into giant source files.
// These exact paths are pre-existing debt; remove entries as tests are
// refactored into cohesive files.
const TEST_MAX_LINES = 1_000;
const TEST_EXCEPTIONS: readonly string[] = [
  'test/active.test.ts',
  'test/agents.test.ts',
  'test/backlog.test.ts',
  'test/draft.test.ts',
  'test/e2e-mission-lifecycle.test.ts',
  'test/e2e-real-agent-smoke.test.ts',
  'test/forgejo.test.ts',
  'test/handoff.test.ts',
  'test/integrate.test.ts',
  'test/integration-pipelines.test.ts',
  'test/review-artifacts.test.ts',
  'test/review.test.ts',
  'test/setup-review.test.ts',
  'test/stats.test.ts',
];

const testFiles: ReadonlyArray<{ path: string; lines: number }> = (() => {
  const found: Array<{ path: string; lines: number }> = [];
  const stack = ['test'];
  while (stack.length > 0) {
    const relative = stack.pop() as string;
    for (const entry of fs.readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) stack.push(child);
      else if (entry.isFile() && /\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
        found.push({ path: child, lines: physicalLineCount(fs.readFileSync(path.join(ROOT, child), 'utf8')) });
      }
    }
  }
  return found;
})();

test('file-size cap: production source files stay at or under 500 lines unless explicitly excepted', () => {
  const violations = applicableFiles
    .filter(file => file.lines > MAX_LINES && !exceptionSet.has(file.path))
    .sort((a, b) => b.lines - a.lines);

  const lines = violations.map(file => `  ${file.path} (${file.lines} lines)`).join('\n');
  assert.deepEqual(
    violations.map(file => file.path),
    [],
    `The following production source files exceed the ${MAX_LINES}-line cap `
      + `without an entry in the exception list:\n${lines}${REMEDIATION_GUIDANCE}`,
  );
});

test('file-size cap: the exception list stays narrow and current', () => {
  const applicablePaths = new Set(applicableFiles.map(file => file.path));
  const lineCounts = new Map(applicableFiles.map(file => [file.path, file.lines]));

  const stale = EXCEPTIONS
    .map(entry => {
      if (!applicablePaths.has(entry)) {
        return `  ${entry} (no longer an applicable production source file — deleted or moved?)`;
      }
      const lines = lineCounts.get(entry) as number;
      if (lines <= MAX_LINES) {
        return `  ${entry} (now ${lines} lines — debt worked down, remove this entry)`;
      }
      return null;
    })
    .filter((entry): entry is string => entry !== null);

  const lines = stale.join('\n');
  assert.deepEqual(
    stale,
    [],
    `Stale exception entries — remove them so the list keeps naming only `
      + `live over-cap files:\n${lines}`,
  );
});

test('file-size cap: the guardrail actually enumerates production sources', () => {
  // Guards against a broken walk or misconfigured root passing vacuously.
  assert.ok(
    applicableFiles.length > 0,
    `expected applicable production source files under ${[...SOURCE_ROOTS].join(' and ')}; the walk found none`,
  );
  for (const sourceRoot of SOURCE_ROOTS) {
    assert.ok(
      // Enumerated paths are POSIX-normalized in collectSourceFiles().
      applicableFiles.some(file => file.path.startsWith(sourceRoot + '/')),
      `expected applicable files under ${sourceRoot}/; the walk found none in that root`,
    );
  }
});

test('file-size cap: new test files stay at or under 1000 lines', () => {
  const exceptions = new Set(TEST_EXCEPTIONS);
  const violations = testFiles.filter(file => file.lines > TEST_MAX_LINES && !exceptions.has(file.path));
  assert.deepEqual(violations, [], 'Refactor large tests into cohesive files; execution grouping must not merge source files.');
  const current = new Map(testFiles.map(file => [file.path, file.lines]));
  const stale = TEST_EXCEPTIONS.filter(file => (current.get(file) ?? 0) <= TEST_MAX_LINES);
  assert.deepEqual(stale, [], 'Remove test-size exceptions once the file is at or under 1000 lines.');
});
