/**
 * mutation-gate.ts - diff-scoped mutation testing gate with ratchet enforcement.
 *
 * Mirrors coverage-gate.ts's shape (dry-run mode, exit-code contract, testable
 * `run(args, options)` export) but complements it with a mutation-score
 * signal instead of line coverage. See docs/adr/adr-mutation-testing.md for
 * the rationale and lifecycle placement (pre-integrate, not per-checkpoint).
 *
 * Usage:
 *   npx tsx src/adapters/verification/mutation-gate.ts [--dry-run] [--base <branch>] [--head <ref>]
 *     [--baseline-path <path>] [--threshold <pct>]
 *
 * Exit 0 when every diff-scoped file's mutation score is >= its baseline
 * score (the ratchet) and, if --threshold is set, >= that absolute floor.
 * Exit 1 on any ratchet regression, threshold miss, or Stryker run failure.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import scopeMutationTargetsDefault, { type ScopeResult } from '../git/mutation-scoper.js';
import { getPrimaryBranch as getPrimaryBranchDefault } from '../filesystem/mission-utils.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { packageRoot } from '../filesystem/package-root.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = packageRoot(MODULE_DIR);
const DEFAULT_BASELINE_PATH = path.join(REPO_ROOT, 'config', 'mutation-baseline.json');
// Rough per-mutant wall-clock budget for --dry-run's predicted-runtime estimate,
// based on a measured single-mutant `node --test` command-runner pass, which took
// well under 1s on a trivial fixture; 5s/file is a conservative ceiling that
// accounts for larger real files and the ~3 mutants/file StrykerJS produced
// for a two-function fixture).
const SECONDS_PER_TARGET_FILE = 5;

interface BaselineEntry {
  score: number;
  timestamp: string;
}

interface Baseline {
  filePaths: Record<string, BaselineEntry>;
}

interface MutationGateOptions {
  exitFn?: (_code: number) => void;
  scopeFn?: typeof scopeMutationTargetsDefault;
  spawnSyncFn?: typeof spawnSync;
  getPrimaryBranchFn?: typeof getPrimaryBranchDefault;
  fsModule?: typeof fs;
  repoRoot?: string;
  strykerBin?: string;
}

function parseArgs(args: string[]) {
  let dryRun = false;
  let base: string | null = null;
  let head = 'HEAD';
  let baselinePath = DEFAULT_BASELINE_PATH;
  let threshold: number | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--base' && args[i + 1]) {
      base = args[++i];
    } else if (args[i] === '--head' && args[i + 1]) {
      head = args[++i];
    } else if (args[i] === '--baseline-path' && args[i + 1]) {
      baselinePath = path.resolve(args[++i]);
    } else if (args[i] === '--threshold' && args[i + 1]) {
      threshold = parseFloat(args[++i]);
    }
  }
  return { dryRun, base, head, baselinePath, threshold };
}

function loadBaseline(baselinePath: string, fsModule: typeof fs = fs): Baseline {
  if (!fsModule.existsSync(baselinePath)) {
    return { filePaths: {} };
  }
  try {
    const parsed = JSON.parse(fsModule.readFileSync(baselinePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.filePaths && typeof parsed.filePaths === 'object') {
      return parsed as Baseline;
    }
  } catch (_) {
    // fall through to empty baseline on parse failure
  }
  return { filePaths: {} };
}

function saveBaseline(baselinePath: string, baseline: Baseline, fsModule: typeof fs = fs): void {
  fsModule.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fsModule.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

/** Find test files to run for the given target set: exact `<basename>.test.ts` matches first, else the whole test/ suite. */
function findTestFiles(targetFiles: string[], repoRoot: string, fsModule: typeof fs = fs): string[] {
  const testDir = path.join(repoRoot, 'test');
  if (!fsModule.existsSync(testDir)) {return [];}
  const matched = new Set<string>();
  for (const target of targetFiles) {
    // Targets are authored TypeScript, so strip whatever extension the scoper
    // produced rather than assuming an emitted `.js` name — stripping the wrong
    // extension leaves `<name>.ts` and matches nothing, which silently widens
    // the run to the entire `test/` tree.
    const base = path.basename(target, path.extname(target));
    const candidate = path.join(testDir, `${base}.test.ts`);
    if (fsModule.existsSync(candidate)) {matched.add(candidate);}
  }
  if (matched.size === 0) {
    for (const file of fsModule.readdirSync(testDir)) {
      if (file.endsWith('.test.ts')) {matched.add(path.join(testDir, file));}
    }
  }
  return Array.from(matched).sort();
}

function buildStrykerConfig(targetFiles: string[], testFiles: string[], repoRoot: string) {
  const relTestFiles = testFiles.map(f => path.relative(repoRoot, f));
  return {
    packageManager: 'npm',
    mutate: targetFiles,
    testRunner: 'command',
    commandRunner: {
      // The test seam replaces dependencies with `mock.module()`, which Node
      // only enables behind `--experimental-test-module-mocks`; without it every
      // seam-using file throws on import and every mutant reads as survived.
      command: `${process.execPath} --import tsx --experimental-test-module-mocks --test ${relTestFiles.join(' ')}`,
    },
    reporters: ['json'],
    coverageAnalysis: 'off',
    tempDirName: '.stryker-tmp-mutation-gate',
    concurrency: 2,
  };
}

interface FileMutationScore {
  killed: number;
  survived: number;
  timeout: number;
  score: number;
}

function computeScoresFromReport(reportPath: string, fsModule: typeof fs = fs): Record<string, FileMutationScore> {
  const report = JSON.parse(fsModule.readFileSync(reportPath, 'utf8'));
  const scores: Record<string, FileMutationScore> = {};
  for (const [file, data] of Object.entries<any>(report.files || {})) {
    const mutants: any[] = data.mutants || [];
    let killed = 0;
    let survived = 0;
    let timeout = 0;
    for (const mutant of mutants) {
      if (mutant.status === 'Killed') {killed++;}
      else if (mutant.status === 'Survived') {survived++;}
      else if (mutant.status === 'Timeout') {timeout++;}
    }
    const denominator = killed + survived + timeout;
    const score = denominator === 0 ? 100 : Math.round((killed / denominator) * 10000) / 100;
    scores[file] = { killed, survived, timeout, score };
  }
  return scores;
}

function runStryker(configPath: string, runCwd: string, spawnSyncFn: typeof spawnSync, strykerBin: string): { status: number | null; error?: Error | null } {
  // Stryker's `command` test runner spawns `node --test <file>` per mutant,
  // inheriting this process's env. If mutation-gate itself is invoked from
  // inside a `node --test` run (as it legitimately is by its own regression
  // test, test/mutation-gate-ratchet.test.js), NODE_TEST_CONTEXT leaks into
  // those nested invocations and node treats them as subtests of the outer
  // run instead of independent processes — the outer test runner swallows
  // their pass/fail exit code, so every mutant looks "Survived" regardless
  // of whether the test actually failed. coverage-gate.ts hits the exact
  // same hazard and strips the same two vars for the same reason.
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_OPTIONS;
  const result = spawnSyncFn(strykerBin, ['run', configPath], {
    cwd: runCwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  });
  return { status: result.status, error: result.error };
}

function run(args: string[] = [], options: MutationGateOptions = {}) {
  const {
    exitFn = process.exit,
    scopeFn = scopeMutationTargetsDefault,
    spawnSyncFn = spawnSync,
    getPrimaryBranchFn = getPrimaryBranchDefault,
    fsModule = fs,
    repoRoot = REPO_ROOT,
    strykerBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'stryker'),
  } = options;

  const { dryRun, base, head, baselinePath, threshold } = parseArgs(args);

  let baseBranch = base;
  if (!baseBranch) {
    try {
      baseBranch = getPrimaryBranchFn(repoRoot);
    } catch (err) {
      fmt.log.fail(`Unable to resolve base branch: ${(err as Error).message}`);
      exitFn(1);
      return;
    }
  }

  let scope: ScopeResult;
  try {
    scope = scopeFn(baseBranch as string, head, { repoRoot });
  } catch (err) {
    fmt.log.fail(`Failed to compute diff-scoped mutation targets: ${(err as Error).message}`);
    exitFn(1);
    return;
  }

  const testFiles = findTestFiles(scope.targetFiles, repoRoot, fsModule);
  const predictedSeconds = Math.max(SECONDS_PER_TARGET_FILE, scope.targetFiles.length * SECONDS_PER_TARGET_FILE);

  if (dryRun) {
    fmt.log.info(`mutation-gate DRY-RUN — base=${baseBranch} head=${head}`);
    fmt.log.info(`Diff-scoped target files (${scope.targetFiles.length}): ${scope.targetFiles.join(', ') || '(none)'}`);
    fmt.log.info(`Changed files: ${scope.changedFiles.join(', ') || '(none)'}`);
    fmt.log.info(`Callee files: ${scope.calleeFiles.join(', ') || '(none)'}`);
    fmt.log.info(`Matched test files (${testFiles.length}): ${testFiles.map(f => path.relative(repoRoot, f)).join(', ') || '(none)'}`);
    fmt.log.info(`Predicted run time: ~${predictedSeconds}s`);
    exitFn(0);
    return;
  }

  if (scope.targetFiles.length === 0) {
    fmt.log.info('mutation-gate: no diff-scoped target files, nothing to mutate.');
    exitFn(0);
    return;
  }

  if (testFiles.length === 0) {
    fmt.log.fail('mutation-gate: no test files found under test/, cannot verify mutants.');
    exitFn(1);
    return;
  }

  const scratchDir = fsModule.mkdtempSync(path.join(os.tmpdir(), 'mutation-gate-'));
  const configPath = path.join(scratchDir, 'stryker.conf.json');
  const reportPath = path.join(repoRoot, 'reports', 'mutation', 'mutation.json');
  try {
    const config = buildStrykerConfig(scope.targetFiles, testFiles, repoRoot);
    fsModule.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const strykerResult = runStryker(configPath, repoRoot, spawnSyncFn, strykerBin);
    if (strykerResult.error) {
      fmt.log.fail(`mutation-gate: failed to run StrykerJS: ${strykerResult.error.message}`);
      exitFn(1);
      return;
    }
    if (!fsModule.existsSync(reportPath)) {
      fmt.log.fail(`mutation-gate: expected StrykerJS report at ${reportPath} but it was not produced (exit code ${strykerResult.status}).`);
      exitFn(1);
      return;
    }

    const scores = computeScoresFromReport(reportPath, fsModule);
    const baseline = loadBaseline(baselinePath, fsModule);
    const regressions: string[] = [];
    const belowThreshold: string[] = [];

    for (const file of scope.targetFiles) {
      const fileScore = scores[file];
      const newScore = fileScore ? fileScore.score : 100;
      const priorEntry = baseline.filePaths[file];
      if (priorEntry && newScore < priorEntry.score) {
        regressions.push(`${file}: ${newScore} < baseline ${priorEntry.score}`);
      }
      if (threshold !== null && newScore < threshold) {
        belowThreshold.push(`${file}: ${newScore} < threshold ${threshold}`);
      }
    }

    if (regressions.length > 0) {
      fmt.log.fail('mutation-gate: ratchet FAILED — mutation score regressed on:');
      for (const line of regressions) {fmt.log.fail(`  ${line}`);}
      exitFn(1);
      return;
    }
    if (belowThreshold.length > 0) {
      fmt.log.fail('mutation-gate: threshold FAILED — mutation score below floor on:');
      for (const line of belowThreshold) {fmt.log.fail(`  ${line}`);}
      exitFn(1);
      return;
    }

    const now = new Date().toISOString();
    for (const file of scope.targetFiles) {
      const fileScore = scores[file];
      const newScore = fileScore ? fileScore.score : 100;
      baseline.filePaths[file] = { score: newScore, timestamp: now };
    }
    saveBaseline(baselinePath, baseline, fsModule);

    fmt.log.info('mutation-gate: PASSED');
    for (const file of scope.targetFiles) {
      fmt.log.info(`  ${file}: ${scores[file] ? scores[file].score : 100}`);
    }
    exitFn(0);
  } finally {
    try {
      fsModule.rmSync(scratchDir, { recursive: true, force: true });
    } catch (_) {
      // best-effort cleanup
    }
  }
}

// Entry detection: the invoked script path when run as an ESM script
// (`tsx src/adapters/verification/mutation-gate.ts`).
//
// Deliberately NOT compared against import.meta.url: this module is inlined
// into the canonical bundle, where every inlined module reports the bundle's
// own URL. That would make the gate run on every `px` command.
const isEsmEntry = Boolean(process.argv[1]) && /[\\/]mutation-gate\.ts$/.test(process.argv[1]);
if (isEsmEntry) {
  run(process.argv.slice(2));
}

(run as any).parseArgs = parseArgs;
(run as any).loadBaseline = loadBaseline;
(run as any).saveBaseline = saveBaseline;
(run as any).findTestFiles = findTestFiles;
(run as any).buildStrykerConfig = buildStrykerConfig;
(run as any).computeScoresFromReport = computeScoresFromReport;
(run as any).DEFAULT_BASELINE_PATH = DEFAULT_BASELINE_PATH;
(run as any).SECONDS_PER_TARGET_FILE = SECONDS_PER_TARGET_FILE;

export default run;
export {
  run,
  parseArgs,
  loadBaseline,
  saveBaseline,
  findTestFiles,
  buildStrykerConfig,
  computeScoresFromReport,
  DEFAULT_BASELINE_PATH,
  SECONDS_PER_TARGET_FILE,
};
