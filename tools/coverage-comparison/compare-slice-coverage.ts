#!/usr/bin/env node
// TASK-2622.04 — matched-settings line-coverage parity for a bounded slice of
// migrated test files.
//
// Usage (from the repository root):
//   npx tsx tools/coverage-comparison/compare-slice-coverage.ts \
//     --checkout <baseline checkout> --files test/a.test.ts,test/b.test.ts --out <baseline.info>
//   npx tsx tools/coverage-comparison/compare-slice-coverage.ts \
//     --checkout . --files <same list> --out <candidate.info>
//   npx tsx tools/coverage-comparison/compare-slice-coverage.ts --compare <baseline.info> <candidate.info>
//
// Each file runs alone in its own covered `node --test` process, with the
// argv buildTestRunPlan selects for an explicitly requested file plus the
// native coverage reporters. One file per process sidesteps the concurrent
// isolated-worker attribution instability recorded in
// tools/nx-evaluation/coverage-attribution-probe.json, so the comparison
// reflects execution rather than reporter scheduling. Fragments are merged
// and normalized exactly like the fast unit runner's report.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTestRunPlan, withCoverageReporters } from '../../test/lib/test-run-plan.js';
import { checkoutTestTmpdir } from '../../test/lib/test-tmpdir.js';
import { mergeLcov } from '../../src/adapters/verification/coverage-gate.js';
import { removeNonExecutableCoverage, removeTypeOnlyCoverage } from '../../src/adapters/verification/type-only-coverage.js';

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };

type Coverage = Map<string, Map<number, number>>;

function collect(checkout: string, files: readonly string[]): string {
  const scratch = fs.mkdtempSync(path.join(checkoutTestTmpdir(checkout), 'slice-coverage-'));
  try {
    const fragments = files.map((file, index) => {
      const plan = buildTestRunPlan({ executionRoot: checkout, requestedArgs: [file], coverage: true });
      const lcov = path.join(scratch, `${index}.info`);
      const result = spawnSync(plan.testNode, withCoverageReporters(plan.nodeArgs, lcov), {
        cwd: checkout, stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, FORCE_COLOR: '0', PARALLIX_EXECUTION_ROOT: checkout, TMPDIR: checkoutTestTmpdir(checkout) },
      });
      console.error(`[slice-coverage] ${file}: exit ${result.status}`);
      if (result.status !== 0 || !fs.existsSync(lcov)) { throw new Error(`${file} did not pass with coverage`); }
      return fs.readFileSync(lcov, 'utf8');
    });
    return removeNonExecutableCoverage(removeTypeOnlyCoverage(mergeLcov(fragments), checkout), checkout);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Parse LCOV into checkout-relative source paths and per-line hit counts. */
function parse(lcov: string): Coverage {
  const files: Coverage = new Map();
  let current: Map<number, number> | null = null;
  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) {
      const source = line.slice(3);
      const relative = source.slice(source.lastIndexOf(`${path.sep}src${path.sep}`) + 1);
      current = files.get(relative) ?? new Map();
      files.set(relative, current);
    } else if (line.startsWith('DA:') && current) {
      const [lineNumber, hits] = line.slice(3).split(',').map(Number);
      current.set(lineNumber, Math.max(current.get(lineNumber) ?? 0, hits));
    }
  }
  return files;
}

function compare(baseline: Coverage, candidate: Coverage) {
  let baselineLines = 0, baselineCovered = 0, candidateLines = 0, candidateCovered = 0;
  const lostCovered: string[] = [];
  const changedDenominator: string[] = [];
  for (const [file, lines] of baseline) {
    const next = candidate.get(file) ?? new Map<number, number>();
    const sameLines = lines.size === next.size && [...lines.keys()].every(line => next.has(line));
    if (!sameLines) { changedDenominator.push(file); }
    for (const [line, hits] of lines) {
      baselineLines += 1;
      if (hits > 0) {
        baselineCovered += 1;
        if (!(next.get(line)! > 0)) { lostCovered.push(`${file}:${line}`); }
      }
    }
  }
  for (const [file, lines] of candidate) {
    if (!baseline.has(file)) { changedDenominator.push(file); }
    for (const hits of lines.values()) { candidateLines += 1; if (hits > 0) { candidateCovered += 1; } }
  }
  const rate = (covered: number, total: number) => total === 0 ? 0 : Math.round((covered / total) * 10_000) / 100;
  return {
    sourceFiles: { baseline: baseline.size, candidate: candidate.size },
    executableLines: { baseline: baselineLines, candidate: candidateLines },
    coveredLines: { baseline: baselineCovered, candidate: candidateCovered },
    lineRatePercent: { baseline: rate(baselineCovered, baselineLines), candidate: rate(candidateCovered, candidateLines) },
    changedDenominator,
    lostCovered,
  };
}

const comparison = args.indexOf('--compare');
if (comparison >= 0) {
  const [baselinePath, candidatePath] = args.slice(comparison + 1, comparison + 3);
  const report = compare(parse(fs.readFileSync(baselinePath, 'utf8')), parse(fs.readFileSync(candidatePath, 'utf8')));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.lostCovered.length === 0 && report.changedDenominator.length === 0 ? 0 : 1;
} else {
  const checkout = path.resolve(option('--checkout') ?? '.');
  const files = (option('--files') ?? '').split(',').filter(Boolean);
  const out = option('--out');
  if (files.length === 0 || !out) { throw new Error('--files and --out are required'); }
  fs.writeFileSync(path.resolve(out), collect(checkout, files));
}
