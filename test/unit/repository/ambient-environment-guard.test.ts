/**
 * TASK-2668.05 — environment variables are interpreted only in
 * src/composition/config.ts. Production code may still spread the host
 * environment into a child-process environment (`...process.env`), but must not
 * read an individual variable. Every production file is checked without migration exemptions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'src');
const CONFIG_MODULE = 'src/composition/config.ts';

const AMBIENT_READ = /\bprocess\.env\b/;
const FORWARDING = /\.\.\.\s*process\.env(?!\s*(?:[.[]|\?\.))/g;
const INJECTED_VARIABLE = /\b(?:env|environment|processEnv|inheritEnv|baseEnv)\??\.[A-Z][A-Z0-9_]{2,}\b|\b(?:env|environment)\[\s*['"A-Z]/;


function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { return sourceFiles(full); }
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

function code(line: string): string {
  return line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
}

function interpretedReads(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n').flatMap((raw, index) => {
    const line = code(raw).replace(/\bdelete\s+(?:env|environment)\s*\[[^\]]+\]\s*;?/g, '').replace(/\b(?:env|environment)\s*\[[^\]]+\]\s*=(?!=)/g, 'output =');
    const withoutForwarding = line.replace(FORWARDING, 'forwarded');
    const ambient = AMBIENT_READ.test(withoutForwarding) && !/\.\.\.\s*\([^\n]*\|\|\s*process\.env\s*\)/.test(line);
    return ambient || INJECTED_VARIABLE.test(line) ? [`${path.relative(ROOT, file)}:${index + 1}`] : [];
  });
}

const offenders = new Map<string, string[]>();
for (const file of sourceFiles(SRC)) {
  const rel = path.relative(ROOT, file);
  if (rel === CONFIG_MODULE) { continue; }
  const reads = interpretedReads(file);
  if (reads.length) { offenders.set(rel, reads); }
}

test('production code interprets environment variables only in the composition config module (TASK-2668.05)', () => {
  const unlisted = [...offenders];
  assert.deepEqual(
    unlisted.map(([file, reads]) => `${file}: ${reads.join(', ')}`),
    [],
    'Read the variable in src/composition/config.ts and pass the typed slice inward; spreading process.env into a child environment is the only other allowed use.',
  );
});

test('unit tests inject production configuration instead of mutating the process environment (TASK-2668.08)', () => {
  const mutations: string[] = [];
  for (const file of sourceFiles(path.join(ROOT, 'test', 'unit'))) {
    // Harness tests exercise Node's runner environment, never production configuration.
    if (file.startsWith(path.join(ROOT, 'test', 'unit', 'test', 'lib') + path.sep)) { continue; }
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (/\bdelete\s+process\.env\b|\bprocess\.env(?:\.[\w]+|\[[^\]]+\])\s*=(?!=)/.test(code(line))) {
        mutations.push(`${path.relative(ROOT, file)}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(mutations, [], 'Pass an explicit environment source to resolveConfiguration and inject its typed result.');
});
