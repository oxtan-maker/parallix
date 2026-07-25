import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const srcApplication = path.join(root, 'src', 'application');
const srcDomain = path.join(root, 'src', 'domain');

/** Terminal-rendering / UI framework packages that must not leak into application or domain layers. */
const UI_PACKAGES = ['react', 'ink', 'react-dom', '@react-spring'];

/** Collect all .ts and .tsx files under a directory (excluding node_modules). */
function collectTypeScriptFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...collectTypeScriptFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Check if a file imports a UI package (excluding type-only imports). */
function hasUiImport(file: string): { uiPackage: string; line: string } | null {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');
  for (const line of lines) {
    // Match import statements: import ... from 'react' or import 'react'
    const importMatch = line.match(/(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/);
    if (importMatch) {
      const specifier = importMatch[1];
      for (const uiPkg of UI_PACKAGES) {
        if (specifier === uiPkg || specifier.startsWith(`${uiPkg}/`)) {
          // Check if this is a type-only import
          // Patterns: import type { ... } from, import type X from, import { type ... } from
          const isTypeOnly = /^import\s+type\s+/.test(line)
            || /^import\s+\{\s*type\s+/.test(line)
            || /^import\s+type\s+\{/.test(line);
          if (!isTypeOnly) {
            return { uiPackage: uiPkg, line: line.trim() };
          }
        }
      }
    }
  }
  return null;
}

test('import-boundary: no react/ink imports in src/application/ (ADR 0051)', () => {
  const files = collectTypeScriptFiles(srcApplication);
  const violations: string[] = [];
  for (const file of files) {
    const hit = hasUiImport(file);
    if (hit) {
      violations.push(`${path.relative(root, file)}: ${hit.line} (imports ${hit.uiPackage})`);
    }
  }
  assert.deepEqual(violations, [], `Application layer must not import UI packages. Violations: ${violations.join('\n')}`);
});

test('import-boundary: no react/ink imports in src/domain/ (ADR 0051)', () => {
  const files = collectTypeScriptFiles(srcDomain);
  const violations: string[] = [];
  for (const file of files) {
    const hit = hasUiImport(file);
    if (hit) {
      violations.push(`${path.relative(root, file)}: ${hit.line} (imports ${hit.uiPackage})`);
    }
  }
  assert.deepEqual(violations, [], `Domain layer must not import UI packages. Violations: ${violations.join('\n')}`);
});

test('import-boundary: tui directory is the allowed source of react/ink imports', () => {
  const tuiDir = path.join(root, 'src', 'interfaces', 'tui');
  // Collect .ts and .tsx files for the TUI directory
  const tuiFiles: string[] = [];
  const entries = fs.readdirSync(tuiDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      tuiFiles.push(path.join(tuiDir, entry.name));
    }
  }
  // The TUI directory itself MUST have react and ink imports (it's the allowed boundary)
  const hasReact = tuiFiles.some(file => {
    const source = fs.readFileSync(file, 'utf8');
    return /from\s+['"]react['"]/.test(source);
  });
  const hasInk = tuiFiles.some(file => {
    const source = fs.readFileSync(file, 'utf8');
    return /from\s+['"]ink['"]/.test(source);
  });
  assert.ok(hasReact, 'TUI directory must import react');
  assert.ok(hasInk, 'TUI directory must import ink');
});
