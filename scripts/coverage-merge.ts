#!/usr/bin/env node
// TASK-2547 — merge the per-tier LCOV fragments produced by the CI-safe test
// execution into one Sonar-consumable coverage/lcov.info.
//
// The GitHub `ci-required` job runs the unit and integration-ci populations as
// separate Node invocations (each writes its own lcov under coverage/). This
// script unions them with correct LCOV semantics: a source/line present in more
// than one fragment keeps the larger hit count and the LF/LH tallies are
// recomputed, so Sonar receives one coherent report instead of duplicated
// concatenated DA records.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mergeLcov } from '../src/adapters/verification/coverage-gate.js';
import { packageRoot } from '../src/adapters/filesystem/package-root.js';

function fail(message: string): never {
  console.error(`[coverage-merge] ${message}`);
  process.exit(1);
}

function resolve(root: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

const args = process.argv.slice(2);
let output: string | undefined;
const inputs: string[] = [];
for (const arg of args) {
  if (arg === '--output' || arg === '-o') {
    output = args.shift() ?? undefined;
  } else if (arg.startsWith('-')) {
    // ignore unknown flags
  } else if (!output) {
    output = arg;
  } else {
    inputs.push(arg);
  }
}

if (!output || inputs.length === 0) {
  fail('usage: coverage-merge.ts <output> <input...>');
}

const root = packageRoot(import.meta.dirname);
const outPath = resolve(root, output);
try {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
} catch (_) {
  // directory already exists or is creatable
}

const fragments = inputs.map(inPath => fs.readFileSync(resolve(root, inPath), 'utf8'));
fs.writeFileSync(outPath, mergeLcov(fragments));
console.error(`[coverage-merge] wrote ${outPath} from ${inputs.length} fragment(s)`);
