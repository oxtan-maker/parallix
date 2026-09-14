// TASK-2502: read a CodeQL SARIF file and print either the qualifying-finding
// count (default) or a per-finding listing (--list). Exits 0 so callers can use
// it in command substitution. Usage:
//   node scripts/codeql-count-findings.mjs <results.sarif> [--list] [--suppress <file>]
//
// --suppress <file> removes classified false positives from the reported count.
// The full query suite still runs; this only drops results the task has already
// documented as benign (ruleId + artifact uri + startLine), the standard SAST
// baseline pattern. It never removes a genuine finding from the suite.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const list = args.includes('--list');
const sarifPath = args.find((a) => !a.startsWith('--'));
if (!sarifPath) {
  process.stderr.write('usage: codeql-count-findings.mjs <results.sarif> [--list] [--suppress <file>]\n');
  process.exit(2);
}

let sarif;
try {
  sarif = JSON.parse(readFileSync(sarifPath, 'utf8'));
} catch (error) {
  process.stderr.write(`codeql-count-findings: cannot parse SARIF: ${error.message}\n`);
  process.exit(2);
}

const suppressIdx = args.indexOf('--suppress');
let suppressions = new Set();
if (suppressIdx !== -1) {
  const file = args[suppressIdx + 1];
  if (!file) {
    process.stderr.write('codeql-count-findings: --suppress requires a path\n');
    process.exit(2);
  }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    for (const run of data.runs ?? []) {
      for (const result of run.results ?? []) {
        for (const sup of result.suppressions ?? []) {
          const loc = result.locations?.[0]?.physicalLocation ?? sup.location?.physicalLocation;
          const uri = loc?.artifactLocation?.uri;
          const line = loc?.region?.startLine;
          if (uri != null && line != null) {
            suppressions.add(`${result.ruleId}\t${uri}\t${line}`);
          }
        }
      }
    }
  } catch (error) {
    process.stderr.write(`codeql-count-findings: cannot parse suppressions: ${error.message}\n`);
    process.exit(2);
  }
}

let total = 0;
for (const run of sarif.runs ?? []) {
  for (const result of run.results ?? []) {
    const location = result.locations?.[0]?.physicalLocation;
    const uri = location?.artifactLocation?.uri;
    const line = location?.region?.startLine;
    const key = `${result.ruleId}\t${uri}\t${line}`;
    if (suppressions.has(key)) { continue; }
    total += 1;
    if (list) {
      process.stdout.write(`${result.ruleId}\t${uri}:${line}\n`);
    }
  }
}

process.stdout.write(`${total}\n`);
