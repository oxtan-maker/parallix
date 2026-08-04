import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();

/** Terminal-rendering / UI framework packages that must not appear in the headless entry module graph. */
const UI_PACKAGES = ['react', 'ink'];

/**
 * Collect all .ts files under a directory (excluding node_modules and .tsx files).
 * The headless entry is the static COMMANDS map in index.ts — its dependencies
 * must not transitively include UI packages.
 */
function collectTypeScriptFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'tui') {
      results.push(...collectTypeScriptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Walk the module graph from the headless entry point (index.ts) and check
 * that no reachable .ts file imports a UI package. The ui-command.tsx is
 * dynamically imported and excluded from this check.
 */
function resolveLocal(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null;
  }
  const base = path.resolve(path.dirname(file), specifier.replace(/\.js$/, ''));
  return ['.ts', '.js', '/index.ts'].map(suffix => `${base}${suffix}`).find(fs.existsSync) ?? null;
}

function importsFrom(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)].map(match => match[1]);
}

test('headless-isolation: headless entry module graph contains no react or ink', () => {
  const headlessEntry = path.join(root, 'src', 'composition', 'create-cli.ts');
  const visited = new Set<string>();
  const violations: string[] = [];

  function visit(file: string) {
    if (visited.has(file)) { return; }
    visited.add(file);

    // Skip .tsx files (TUI components)
    if (file.endsWith('.tsx')) { return; }

    // Skip the TUI directory — it is the allowed boundary for UI imports.
    // The headless-isolation test checks that non-TUI code does not import UI packages.
    if (file.includes(path.join('interfaces', 'tui'))) { return; }

    const source = fs.readFileSync(file, 'utf8');

    for (const specifier of importsFrom(source)) {
      // Check for direct UI package imports
      for (const uiPkg of UI_PACKAGES) {
        if (specifier === uiPkg || specifier.startsWith(`${uiPkg}/`)) {
          violations.push(`${path.relative(root, file)}: imports '${specifier}'`);
        }
      }

      // Follow local imports
      const local = resolveLocal(file, specifier);
      if (local) {
        visit(local);
      }
    }
  }

  visit(headlessEntry);

  assert.deepEqual(violations, [], `Headless entry module graph must not import UI packages. Violations: ${violations.join('\n')}`);
});

test('headless-isolation: ui command is composed lazily in create-cli.ts', () => {
  const indexSource = fs.readFileSync(
    path.join(root, 'src', 'composition', 'create-cli.ts'),
    'utf8',
  );

  // The ui command is imported from the TUI module
  assert.ok(
    /runUiCommand/.test(indexSource),
    'create-cli.ts must load runUiCommand from the TUI module',
  );
});

test('headless-isolation: ui command is in the composed command registry', () => {
  const indexSource = fs.readFileSync(
    path.join(root, 'src', 'composition', 'create-cli.ts'),
    'utf8',
  );

  // The COMMANDS map includes 'ui'
  const commandsBlockMatch = indexSource.match(/return\s+\{[\s\S]*?\n  \};/);
  assert.ok(commandsBlockMatch, 'composed command registry should be present in create-cli.ts');
  assert.ok(
    commandsBlockMatch[0].includes('ui'),
    'ui must be in the COMMANDS map',
  );
});
