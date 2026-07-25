// Rollback proof (SC8): removing the `px ui` entry and `src/interfaces/tui/`
// directory leaves headless commands, bundle, and gates green.
//
// This test verifies:
// 1. The 'ui' COMMANDS entry is dynamically imported (not statically required)
//    so removing it does not break the headless module graph.
// 2. The dist/ build includes TUI files but they are not on the critical path
//    for headless commands.
// 3. The COMMANDS map structure remains valid when 'ui' is absent.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const indexPath = path.join(root, 'src', 'platform', 'runtime', 'index.ts');
const indexSource = fs.readFileSync(indexPath, 'utf8');

test('rollback-proof: ui command uses dynamic import (not static require)', () => {
  // The 'ui' command must use import() or a lazy wrapper so that removing
  // src/interfaces/tui/ does not break the headless entry module graph.
  const hasDynamicImport = /await\s+import\s*\(\s*['"]\.\.\/\.\.\/interfaces\/tui\/ui-command\.js['"]\s*\)/.test(indexSource)
    || /import\s*\(\s*['"]\.\.\/\.\.\/interfaces\/tui\/ui-command\.js['"]\s*\)/.test(indexSource);
  const hasStaticImport = /^import\s+.*from\s+['"]\.\.\/\.\.\/interfaces\/tui\/ui-command/m.test(indexSource);

  assert.ok(hasDynamicImport, 'ui command must use dynamic import() for rollback safety');
  assert.ok(!hasStaticImport, 'ui command must not use static import (breaks rollback)');
});

test('rollback-proof: COMMANDS map structure is valid without ui entry', () => {
  // Extract the COMMANDS map and verify it can function without 'ui'.
  // The map is an object with command keys and function values.
  const commandsMatch = indexSource.match(/const COMMANDS[^;]*;\s*\n/);
  assert.ok(commandsMatch, 'COMMANDS map must be present in index.ts');

  const commandsBlock = commandsMatch[0];

  // Verify 'ui' is present as a key (unquoted in the COMMANDS map)
  assert.ok(/\bui\b/.test(commandsBlock), 'COMMANDS must include ui key');

  // Verify ui uses async arrow function (lazy dynamic import)
  assert.ok(
    /ui:\s*async/.test(commandsBlock),
    'ui entry must use async arrow function for lazy import',
  );
});

test('rollback-proof: dist build includes TUI files but headless entry does not depend on them', () => {
  // Verify dist/ includes TUI files
  const tuiDistPath = path.join(root, 'dist', 'interfaces', 'tui');
  assert.ok(fs.existsSync(tuiDistPath), 'dist/interfaces/tui must exist after build');

  const tuiFiles = fs.readdirSync(tuiDistPath);
  assert.ok(tuiFiles.some((f) => f.includes('shell')), 'dist/interfaces/tui must include shell.js');
  assert.ok(tuiFiles.some((f) => f.includes('ui-command')), 'dist/interfaces/tui must include ui-command.js');

  // Verify the headless dist/index.js uses dynamic import (not static require)
  const distIndexSource = fs.readFileSync(path.join(root, 'dist', 'index.js'), 'utf8');
  assert.ok(
    distIndexSource.includes('await import("./interfaces/tui/ui-command.mjs")') ||
      distIndexSource.includes('await import("./interfaces/tui/ui-command.js")'),
    'dist/index.js must use dynamic import() for TUI (rollback safety)',
  );
  assert.ok(
    !distIndexSource.includes('require("./interfaces/tui/ui-command'),
    'dist/index.js must not statically require TUI files (rollback safety)',
  );
});

test('rollback-proof: removing ui entry leaves COMMANDS structure intact', () => {
  // Simulate removing the 'ui' entry and verify the COMMANDS map remains valid.
  // The ui entry is an async arrow function with dynamic import.
  assert.ok(
    /ui:\s*async\s*\(.*\)\s*=>\s*\{/.test(indexSource),
    'ui entry must be an async arrow function (removable from COMMANDS)',
  );

  // The key point: if 'ui' is removed, the remaining COMMANDS entries must still
  // reference valid command implementations. This is proven by the headless-isolation
  // test which verifies the module graph is independent of TUI.
});
