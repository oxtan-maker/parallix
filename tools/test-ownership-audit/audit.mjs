/** Reproduce the historical ownership audit; never used for test selection. */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
const evidencePath = path.resolve(root, process.argv[2] || 'backlog/docs/task-2622.20-results.json');
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const rows = evidence.dispositions;
const printer = ts.createPrinter({ removeComments: true });
const replacements = rows.flatMap(({ original, owners }) => {
  const old = path.basename(original);
  const replacement = path.basename(owners[0]);
  return [[old, replacement], [old.replace(/\.ts$/, '.js'), replacement.replace(/\.ts$/, '.js')]];
});

function declarations(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const assertions = [];
  const cases = [];
  function walk(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      if (/^assert(?:\.|$)/.test(expression)) assertions.push(printer.printNode(ts.EmitHint.Unspecified, node, tree));
      if (/^(?:test|it|(?:t|context)\.test)$/.test(expression) && node.arguments[0]) {
        cases.push(printer.printNode(ts.EmitHint.Unspecified, node.arguments[0], tree));
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return { assertions, cases };
}

const available = { assertions: new Map(), cases: new Map() };
const owners = [...new Set(rows.flatMap(row => row.owners))].filter(file => file.endsWith('.ts'));
for (const file of owners) {
  const found = declarations(file, fs.readFileSync(path.join(root, file), 'utf8'));
  for (const [kind, values] of Object.entries(found)) {
    for (const value of values) available[kind].set(value, (available[kind].get(value) || 0) + 1);
  }
}

const missing = [];
let assertionCalls = 0;
let caseDeclarations = 0;
for (const row of rows) {
  const result = spawnSync('git', ['show', `${evidence.migrationBase}:${row.original}`], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`cannot read original source: ${row.original}: ${result.stderr}`);
  let source = result.stdout;
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash !== row.originalSha256) throw new Error(`original source hash differs: ${row.original}`);
  if (!row.original.endsWith('.ts')) continue;
  for (const [old, replacement] of replacements) source = source.replaceAll(old, replacement);
  const found = declarations(row.original, source);
  assertionCalls += found.assertions.length;
  caseDeclarations += found.cases.length;
  for (const [kind, values] of Object.entries(found)) {
    for (const value of values) {
      const remaining = available[kind].get(value) || 0;
      if (remaining > 0) available[kind].set(value, remaining - 1);
      else missing.push({ file: row.original, kind, value });
    }
  }
}
console.log(JSON.stringify({ assertionCalls, caseDeclarations, missing }, null, 2));
if (missing.length || assertionCalls !== evidence.originalAssertions || caseDeclarations !== evidence.originalCases) {
  process.exitCode = 1;
}
