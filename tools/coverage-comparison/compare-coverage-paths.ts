#!/usr/bin/env node
// TASK-2591 — repeatable comparison of the historical c8 coverage contract and
// Node 26.7+ native coverage (--test-coverage-include-all) on the
// integration-ci test population.
//
// Usage (from the repository root, after `npm run build`):
//   npx tsx tools/coverage-comparison/compare-coverage-paths.ts \
//     --node <node >= 26.7 executable> \
//     [--c8 <c8 10.x executable>] [--baseline-node <node 24 executable>] \
//     [--variants none,c8,native-include-all,native-current,native-patterns] [--repeat 1] \
//     [--out tools/coverage-comparison/comparison-results.json]
//
// Re-analyse the LCOV files of an interrupted or earlier run without
// re-running the suite:
//   npx tsx tools/coverage-comparison/compare-coverage-paths.ts --analyze <scratch dir>
//
// Every variant runs the same `node --test` argv that `npm run
// test:integration:ci:prebuilt` builds (buildTestRunPlan with --integration-ci);
// only the coverage implementation differs. c8 is no longer a repository
// dependency, so the c8 variant needs an explicit --c8 path to a c8 10.x
// install. The c8 arguments are the historical contract from
// src/adapters/verification/coverage-gate.ts at b9b2940a1^ (buildC8Args).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTestRunPlan } from '../../test/lib/test-run-plan.js';
import { normalizeLcov } from '../../src/adapters/verification/coverage-gate.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
function option(name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const analyzeDir = option('--analyze');
const node = option('--node');
if (!node && !analyzeDir) { throw new Error('--node <node >= 26.7> is required'); }
const c8 = option('--c8');
const baselineNode = option('--baseline-node', process.execPath)!;
const variants = option('--variants', 'none,c8,native-include-all,native-current')!.split(',');
const repeat = Number(option('--repeat', '1'));
const outPath = path.resolve(root, option('--out', 'tools/coverage-comparison/comparison-results.json')!);

// Historical c8 contract (b9b2940a1^:src/adapters/verification/coverage-gate.ts).
const INCLUDES = ['src/**/*.ts'];
const EXCLUDES = ['test/**', 'prompts/**', 'config/*.json', '.workflow/**', 'node_modules/**'];

fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
// Scratch is kept after the run: it holds each variant's LCOV for --analyze.
const scratchRoot = analyzeDir ? path.resolve(root, analyzeDir) : fs.mkdtempSync(path.join(root, 'tmp', 'coverage-compare-'));

function planFor(testNode: string) {
  process.env.PARALLIX_TEST_NODE = testNode;
  return buildTestRunPlan({ executionRoot: root, requestedArgs: ['--integration-ci'] });
}

// 'current' is the pre-TASK-2591 CI invocation; 'patterns' adds source maps
// and the c8 include/exclude patterns, which Node 24 supports; 'include-all'
// adds --test-coverage-include-all (Node 26.7+).
type NativeMode = 'current' | 'patterns' | 'include-all';
function nativeArgs(nodeArgs: string[], lcovPath: string, mode: NativeMode): string[] {
  const testIndex = nodeArgs.indexOf('--test');
  return [
    ...nodeArgs.slice(0, testIndex),
    '--experimental-test-coverage',
    ...(mode === 'current' ? [] : [
      // Without source maps the native reporter attributes V8 ranges to the
      // tsx-transpiled line positions, not the .ts source lines c8 remaps to.
      '--enable-source-maps',
      ...(mode === 'include-all' ? ['--test-coverage-include-all'] : []),
      ...INCLUDES.map(pattern => `--test-coverage-include=${pattern}`),
      ...EXCLUDES.map(pattern => `--test-coverage-exclude=${pattern}`),
    ]),
    '--test-coverage-lines=0',
    '--test-reporter=lcov',
    `--test-reporter-destination=${lcovPath}`,
    ...nodeArgs.slice(testIndex),
  ];
}

interface RunResult { variant: string; node: string; run: number; status: number | null; seconds: number; v8PayloadBytes: number; lcov: string | null }

function directoryBytes(dir: string): number {
  if (!fs.existsSync(dir)) { return 0; }
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) { total += fs.statSync(path.join(entry.parentPath, entry.name)).size; }
  }
  return total;
}

function runVariant(variant: string, run: number): RunResult {
  const dir = path.join(scratchRoot, `${variant}-${run}`);
  fs.mkdirSync(dir, { recursive: true });
  const manifestDir = path.join(dir, 'manifest');
  fs.mkdirSync(manifestDir);
  const testNode = variant === 'native-current' || variant === 'native-patterns' ? baselineNode : node!;
  const plan = planFor(testNode);
  const lcovPath = path.join(dir, 'lcov.info');
  let command = plan.testNode;
  let argv: string[];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '0',
    PARALLIX_PREBUILT_PACK: '1',
    PARALLIX_EXECUTION_ROOT: root,
    PARALLIX_TEST_MANIFEST_DIR: manifestDir,
  };
  if (variant === 'none') {
    argv = plan.nodeArgs;
  } else if (variant === 'c8') {
    if (!c8) { throw new Error('the c8 variant needs --c8 <path to c8 10.x>'); }
    command = c8;
    argv = [
      '--all', '--extension', '.ts', '--exclude-after-remap',
      ...INCLUDES.flatMap(pattern => ['--include', pattern]),
      ...EXCLUDES.flatMap(pattern => ['--exclude', pattern]),
      '--check-coverage', '--lines=0',
      '--reporter=lcov', `--reports-dir=${dir}`, `--temp-directory=${path.join(dir, 'v8')}`,
      plan.testNode, ...plan.nodeArgs,
    ];
  } else if (variant === 'native-include-all') {
    // The current repository runner also points NODE_V8_COVERAGE at a scratch
    // directory; the native runner otherwise creates its own. Keep it here so
    // the payload location matches the runner.
    env.NODE_V8_COVERAGE = path.join(dir, 'v8');
    argv = nativeArgs(plan.nodeArgs, lcovPath, 'include-all');
  } else if (variant === 'native-current') {
    env.NODE_V8_COVERAGE = path.join(dir, 'v8');
    argv = nativeArgs(plan.nodeArgs, lcovPath, 'current');
  } else if (variant === 'native-patterns') {
    env.NODE_V8_COVERAGE = path.join(dir, 'v8');
    argv = nativeArgs(plan.nodeArgs, lcovPath, 'patterns');
  } else {
    throw new Error(`unknown variant ${variant}`);
  }
  const started = process.hrtime.bigint();
  const result = spawnSync(command, argv, { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  const lcov = fs.existsSync(lcovPath) ? fs.readFileSync(lcovPath, 'utf8') : null;
  // The raw V8 payload is ~1 GB per coverage run; record its size, then drop it.
  const v8PayloadBytes = directoryBytes(path.join(dir, 'v8'));
  fs.rmSync(path.join(dir, 'v8'), { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'lcov-report'), { recursive: true, force: true });
  const nodeVersion = spawnSync(plan.testNode, ['--version'], { encoding: 'utf8' }).stdout.trim();
  console.error(`[compare] ${variant} run ${run}: status=${result.status} ${seconds.toFixed(1)}s node=${nodeVersion}`);
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ variant, node: nodeVersion, run, status: result.status, seconds, v8PayloadBytes }) + '\n');
  return { variant, node: nodeVersion, run, status: result.status, seconds, v8PayloadBytes, lcov };
}

type Coverage = Map<string, Map<number, number>>;
function parse(lcov: string): Coverage {
  const files: Coverage = new Map();
  let current: Map<number, number> | null = null;
  for (const line of normalizeLcov(lcov).split('\n')) {
    if (line.startsWith('SF:')) {
      const file = path.relative(root, path.resolve(root, line.slice(3)));
      current = new Map();
      files.set(file, current);
    } else if (current && line.startsWith('DA:')) {
      const [lineNumber, hits] = line.slice(3).split(',').map(Number);
      current.set(lineNumber, hits);
    }
  }
  return files;
}

function summarize(coverage: Coverage) {
  let lf = 0; let lh = 0; let untested = 0;
  for (const lines of coverage.values()) {
    const hit = [...lines.values()].filter(hits => hits > 0).length;
    lf += lines.size; lh += hit;
    if (hit === 0) { untested++; }
  }
  const outsideSrc = [...coverage.keys()].filter(file => !file.startsWith('src/') || !file.endsWith('.ts'));
  return { files: coverage.size, untestedFiles: untested, outsideSrc: outsideSrc.length, linesFound: lf, linesHit: lh, pct: lf ? Number((100 * lh / lf).toFixed(2)) : 0 };
}

function compare(reference: Coverage, candidate: Coverage) {
  const onlyReference = [...reference.keys()].filter(file => !candidate.has(file)).sort();
  const onlyCandidate = [...candidate.keys()].filter(file => !reference.has(file)).sort();
  let sameLineSet = 0; let differentLineSet = 0; let coveredDisagreements = 0;
  const differingFiles: Array<{ file: string; referenceLf: number; candidateLf: number; referenceLh: number; candidateLh: number }> = [];
  for (const [file, lines] of reference) {
    const other = candidate.get(file);
    if (!other) { continue; }
    const keys = new Set([...lines.keys(), ...other.keys()]);
    const sameSet = keys.size === lines.size && keys.size === other.size;
    if (sameSet) { sameLineSet++; } else { differentLineSet++; }
    let disagreements = 0;
    for (const key of keys) {
      if (lines.has(key) && other.has(key) && ((lines.get(key)! > 0) !== (other.get(key)! > 0))) { disagreements++; }
    }
    coveredDisagreements += disagreements;
    if (!sameSet || disagreements) {
      differingFiles.push({
        file,
        referenceLf: lines.size, candidateLf: other.size,
        referenceLh: [...lines.values()].filter(hits => hits > 0).length,
        candidateLh: [...other.values()].filter(hits => hits > 0).length,
      });
    }
  }
  return { onlyReference, onlyCandidate, sameLineSet, differentLineSet, coveredDisagreements, differingFiles };
}

function loadRun(dir: string): RunResult | null {
  const runFile = path.join(scratchRoot, dir, 'run.json');
  const match = dir.match(/^(.*)-(\d+)$/);
  if (!match) { return null; }
  const lcovPath = path.join(scratchRoot, dir, 'lcov.info');
  const recorded = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : null;
  return {
    variant: match[1], run: Number(match[2]),
    node: recorded?.node ?? 'unknown', status: recorded?.status ?? null,
    seconds: recorded?.seconds ?? Number.NaN, v8PayloadBytes: recorded?.v8PayloadBytes ?? 0,
    lcov: fs.existsSync(lcovPath) ? fs.readFileSync(lcovPath, 'utf8') : null,
  };
}

const results: RunResult[] = [];
if (analyzeDir) {
  for (const dir of fs.readdirSync(scratchRoot).sort()) {
    const loaded = loadRun(dir);
    if (loaded) { results.push(loaded); }
  }
} else {
  for (let run = 1; run <= repeat; run++) {
    for (const variant of variants) { results.push(runVariant(variant, run)); }
  }
}

const coverageByVariant = new Map<string, Coverage>();
for (const result of results) {
  if (result.lcov && !coverageByVariant.has(result.variant)) { coverageByVariant.set(result.variant, parse(result.lcov)); }
}
const report = {
  generatedAt: new Date().toISOString(),
  commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  runs: results.map(({ lcov: _lcov, ...rest }) => ({ ...rest, seconds: Number(rest.seconds.toFixed(1)) })),
  medianSeconds: Object.fromEntries([...new Set(results.map(result => result.variant))].map(variant => {
    const times = results.filter(result => result.variant === variant && result.status === 0).map(result => result.seconds).sort((a, b) => a - b);
    const middle = Math.floor(times.length / 2);
    const median = times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
    return [variant, Number(median.toFixed(1))];
  })),
  coverage: Object.fromEntries([...coverageByVariant].map(([variant, coverage]) => [variant, summarize(coverage)])),
  comparisons: Object.fromEntries([...coverageByVariant.keys()]
    .filter(variant => variant !== 'c8' && coverageByVariant.has('c8'))
    .map(variant => [`c8-vs-${variant}`, compare(coverageByVariant.get('c8')!, coverageByVariant.get(variant)!)])),
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.error(`[compare] wrote ${outPath}`);
