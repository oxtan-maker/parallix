import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();

// ---------------------------------------------------------------------------
// SC11: No-bypass test — controller does not spawn CLI commands, import legacy
// handlers, write Markdown/Git/SQLite directly, or implement unowned lifecycle
// ---------------------------------------------------------------------------

/** Modules the controller and projection layer must not import. */
const FORBIDDEN_IMPORTS = [
  'node:child_process',   // no spawning CLI commands
  'node:fs',              // no direct filesystem writes
  'ink',                  // no Ink TUI
  'react',                // no React
  'node:react',           // no Node React
  'http',                 // no HTTP transport
  'sqlite',               // no direct SQLite access
  '../core/git',          // no Git operations
  '../tools/forgejo',     // no Forgejo access
  '../core/fmt',          // no formatting utilities
  'process.exit',         // no process termination
];

/** Legacy command handler paths that must not be imported by the controller. */
const FORBIDDEN_LEGACY_PATHS = [
  'src/platform/runtime/lib/commands/',
];

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function importsFrom(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function hasForbiddenImport(source: string, filePath: string): string[] {
  const violations: string[] = [];
  const imports = importsFrom(source);
  for (const specifier of imports) {
    for (const forbidden of FORBIDDEN_IMPORTS) {
      if (specifier.includes(forbidden)) {
        violations.push(`${filePath}: imports "${specifier}" (forbidden: ${forbidden})`);
      }
    }
    // Check for legacy command handler imports
    for (const legacyPath of FORBIDDEN_LEGACY_PATHS) {
      if (specifier.includes(legacyPath)) {
        violations.push(`${filePath}: imports "${specifier}" (forbidden legacy handler)`);
      }
    }
  }
  if (source.includes('process.exit')) {
    violations.push(`${filePath}: uses process.exit`);
  }
  return violations;
}

// Files under test: controller and projection modules
const CONTROLLER_FILES = [
  path.join(root, 'src', 'application', 'controller', 'board-controller.ts'),
  path.join(root, 'src', 'application', 'controller', 'board-command.ts'),
  path.join(root, 'src', 'application', 'projections', 'board.ts'),
  path.join(root, 'src', 'application', 'projections', 'mission-board.ts'),
  path.join(root, 'src', 'application', 'projections', 'analytics.ts'),
  path.join(root, 'src', 'application', 'projections', 'activity.ts'),
  path.join(root, 'src', 'application', 'projections', 'agent-status.ts'),
  path.join(root, 'src', 'application', 'projections', 'mission-detail.ts'),
  path.join(root, 'src', 'application', 'projections', 'repository-selector.ts'),
];

test('board controller and projections do not import forbidden dependencies', () => {
  const allViolations: string[] = [];
  for (const filePath of CONTROLLER_FILES) {
    const source = readSource(filePath);
    allViolations.push(...hasForbiddenImport(source, filePath));
  }
  if (allViolations.length > 0) {
    assert.fail(`No-bypass violations found:\n${allViolations.join('\n')}`);
  }
});

test('board controller does not import any legacy command handler', () => {
  const controllerSource = readSource(
    path.join(root, 'src', 'application', 'controller', 'board-controller.ts'),
  );
  const commandSource = readSource(
    path.join(root, 'src', 'application', 'controller', 'board-command.ts'),
  );
  for (const source of [controllerSource, commandSource]) {
    const imports = importsFrom(source);
    for (const specifier of imports) {
      assert.ok(
        !specifier.includes('lib/commands/'),
        `Controller must not import legacy command handler: ${specifier}`,
      );
    }
  }
});

test('board controller does not implement lifecycle transitions not owned by integrated use case', () => {
  const controllerSource = readSource(
    path.join(root, 'src', 'application', 'controller', 'board-controller.ts'),
  );
  // The controller should dispatch through ExecuteMissionService, not call transition functions directly
  const imports = importsFrom(controllerSource);
  const hasWorkflowImport = imports.some((s) => s.includes('mission-workflow'));
  assert.equal(hasWorkflowImport, false, 'Controller must not import mission-workflow (delegates to ExecuteMissionService)');
});

test('board projections do not implement lifecycle transitions', () => {
  for (const filePath of CONTROLLER_FILES) {
    if (!filePath.includes('projections')) { continue; }
    const source = readSource(filePath);
    const imports = importsFrom(source);
    // Projections may import domain types but should not import command handlers
    for (const specifier of imports) {
      assert.ok(
        !specifier.includes('lib/commands/'),
        `Projection ${filePath} must not import legacy command handler: ${specifier}`,
      );
    }
  }
});

test('board controller uses ExecuteMissionService for active:execute dispatch', () => {
  const controllerSource = readSource(
    path.join(root, 'src', 'application', 'controller', 'board-controller.ts'),
  );
  assert.ok(
    controllerSource.includes('ExecuteMissionService'),
    'Controller must use ExecuteMissionService for active:execute dispatch',
  );
  assert.ok(
    controllerSource.includes('this.executeMission.execute'),
    'Controller must delegate to ExecuteMissionService.execute',
  );
});
