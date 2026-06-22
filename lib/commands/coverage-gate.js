#!/usr/bin/env node

/**
 * coverage-gate.js - run parallix tests with Node's built-in coverage support
 * and enforce a configurable line-coverage threshold (default 90%).
 *
 * Usage:
 *   node parallix/lib/commands/coverage-gate.js [--threshold <pct>] [--dry-run]
 *
 * Exit 0 when tests pass and coverage >= threshold.
 * Exit 1 otherwise.
 *
 * Denominator: parallix/index.js plus all nested .js files under parallix/lib
 * Excludes: parallix/test/*, parallix/prompts/*, parallix/config/*.json,
 *           coverage output dirs, node_modules, generated/temp files.
 *
 * /tmp write inventory (SC-1): every /tmp or os.tmpdir() write location used by
 * coverage-gate.js and the workflow test infrastructure it runs:
 *
 * 1. PER_RUN_SCRATCH array (line 58) — tracks per-process scratch dirs created
 *    by this process. Each entry is a path returned by fs.mkdtempSync().
 * 2. Node --experimental-test-coverage scratch (line 146) — Node creates
 *    coverage-*.json files under NODE_V8_COVERAGE. coverage-gate.js sets
 *    NODE_V8_COVERAGE to a per-process unique dir via createPerRunScratchDirs()
 *    (line 176), so Node writes to a unique path, never /tmp/node-coverage-*.
 * 3. parallix/coverage/ directory (line 153) — created via fs.mkdirSync for
 *    lcov output; lives under REPO_ROOT, not /tmp.
 * 4. TEMP_DIR_PREFIXES (lines 26-44) — prefix-based cleanup allowlist used by
 *    cleanupNewTempDirs() (lines 94-110). Covers dirs created by test files
 *    under parallix/test/*. These prefixes are intentionally NOT modified per SC-8.
 * 5. os.tmpdir() default parameter (lines 85, 94) — listTempEntries() and
 *    cleanupNewTempDirs() accept os.tmpdir() as default root. runTests() passes
 *    a per-run TMPDIR to the child test process and cleans only that root.
 * 6. Per-process mkdtempSync dirs (line 113) — createPerRunScratchDirs() creates
 *    a unique dir via fs.mkdtempSync(path.join(os.tmpdir(), 'node-coverage-'))
 *    and records it in PER_RUN_SCRATCH for targeted cleanup.
 * 7. Test files (37 files, ~168 mkdtempSync calls) — all use
 *    fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-')) pattern; already
 *    per-process unique. No fixed-path /tmp writes in test files. Generic
 *    runtime-* dirs are intentionally excluded because runtime-matrix launcher
 *    tests keep executable probes there while parallel coverage processes run.
 * 8. /tmp/test-main — not produced by any in-scope code; orphaned 1.1 GB dir
 *    on disk from manual integration test (pre-existing, outside parallix/ scope).
 * 9. Prompt templates (review.md, review-verbose.md, act-on-review.md, etc.) —
 *    /tmp/{{slug}}-*.md patterns are templates, not actual writes.
 *
 * Cleanup strategy: per-process inventory (PER_RUN_SCRATCH) + exit/SIGINT/SIGTERM
 * handlers (lines 131-141) that remove only tracked dirs. No blanket rm -rf.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fmt = require('../core/fmt');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SELF_TEST_FILE = 'coverage-gate.test.js';
const TEMP_DIR_PREFIXES = [
  'agents-',
  'sessions-',
  'review-',
  'forgejo-',
  'workflow-',
  'gatekeeper-',
  'graphify-',
  'claude-',
  'codex-',
  'gemini-',
  'opencode-',
  'startagent-',
  'test-',
  'mission-task-',
  'visualBoard-task-',
  'backlog-'
];
const COVERAGE_INCLUDES = [
  'index.js',
  'lib/**/*.js'
];
const COVERAGE_EXCLUDES = [
  'test/**',
  'prompts/**',
  'config/*.json',
  '.workflow/**',
  'node_modules/**'
];
// The full suite regularly exceeds 10 minutes in this repository, especially
// under cold caches. Keep the gate generous so it can finish without a manual
// override while still failing on real hangs.
const DEFAULT_TEST_TIMEOUT_MS = 3_600_000;
const PER_RUN_SCRATCH = [];
let threshold = 90;
let dryRun = false;
let lcov = false;
let cleanupDone = false;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--threshold' && process.argv[i + 1]) {
    threshold = parseFloat(process.argv[i + 1]);
    i++;
  } else if (process.argv[i] === '--dry-run') {
    dryRun = true;
  } else if (process.argv[i] === '--lcov') {
    lcov = true;
  }
}

function discoverTestFiles() {
  const testDir = path.join(REPO_ROOT, 'test');
  if (!fs.existsSync(testDir)) return [];
  return fs.readdirSync(testDir)
    .filter(file => file.endsWith('.test.js'))
    .filter(file => file !== SELF_TEST_FILE)
    .map(file => path.join(testDir, file))
    .sort();
}

function listTempEntries(tmpRoot = os.tmpdir()) {
  if (!fs.existsSync(tmpRoot)) return new Set();
  return new Set(fs.readdirSync(tmpRoot));
}

function shouldCleanTempDir(name) {
  return TEMP_DIR_PREFIXES.some(prefix => name.startsWith(prefix));
}

function cleanupNewTempDirs(beforeEntries, tmpRoot = os.tmpdir()) {
  if (!fs.existsSync(tmpRoot)) return;
  for (const name of fs.readdirSync(tmpRoot)) {
    if (beforeEntries.has(name) || !shouldCleanTempDir(name)) continue;
    const fullPath = path.join(tmpRoot, name);
    let stat = null;
    try {
      stat = fs.statSync(fullPath);
    } catch (_) {
      continue;
    }
    if (!stat.isDirectory()) continue;
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } catch (_) {}
  }
}

function createPerRunScratchDirs() {
  const coverageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-coverage-'));
  PER_RUN_SCRATCH.push(coverageDir);
  return coverageDir;
}

function createPerRunTmpRoot() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-gate-tmp-'));
  PER_RUN_SCRATCH.push(tmpRoot);
  return tmpRoot;
}

function createMockGraphifyBin() {
  const graphifyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphify-'));
  PER_RUN_SCRATCH.push(graphifyDir);
  const graphifyBin = path.join(graphifyDir, 'graphify');
  fs.writeFileSync(graphifyBin, `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--help" ]]; then
  echo "mock graphify"
  exit 0
fi
if [[ "\${1:-}" == "update" ]]; then
  mkdir -p graphify-out
  echo '{"nodes":[],"edges":[]}' > graphify-out/graph.json
  echo '# Mock Graph Report' > graphify-out/GRAPH_REPORT.md
  echo "[mock graphify] update $*"
  exit 0
fi
echo "Unhandled graphify command: $*" >&2
exit 1
`, { mode: 0o755 });
  return graphifyBin;
}

function cleanupPerRunScratch() {
  if (cleanupDone) return;
  cleanupDone = true;
  for (const dir of PER_RUN_SCRATCH) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (_) {}
  }
  PER_RUN_SCRATCH.length = 0;
}

function registerExitHandlers() {
  process.on('exit', cleanupPerRunScratch);
  process.on('SIGINT', () => {
    cleanupPerRunScratch();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanupPerRunScratch();
    process.exit(143);
  });
}

function resetPerRunScratchState() {
  PER_RUN_SCRATCH.length = 0;
  cleanupDone = false;
}

function buildCoverageArgs(testFiles, coverageThreshold = threshold, useLcov = lcov) {
  const args = [
    '--test',
    '--experimental-test-coverage',
    `--test-coverage-lines=${coverageThreshold}`,
    ...COVERAGE_INCLUDES.flatMap(pattern => ['--test-coverage-include', pattern]),
    ...COVERAGE_EXCLUDES.flatMap(pattern => ['--test-coverage-exclude', pattern]),
  ];

  if (useLcov) {
    const coverageDir = path.join(REPO_ROOT, 'coverage');
    if (!fs.existsSync(coverageDir)) {
      fs.mkdirSync(coverageDir, { recursive: true });
    }
    args.push('--test-reporter=lcov');
    args.push(`--test-reporter-destination=${path.join(coverageDir, 'lcov.info')}`);
    args.push('--test-reporter=spec');
    args.push('--test-reporter-destination=stdout');
  }

  args.push(...testFiles);
  return args;
}

function resolveTestTimeoutMs(env = process.env) {
  const raw = env.WORKFLOW_COVERAGE_GATE_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_TEST_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TEST_TIMEOUT_MS;
}

function runTests(testFiles, coverageThreshold = threshold, _spawnSync = spawnSync) {
  const tmpRoot = createPerRunTmpRoot();
  const tmpEntriesBefore = listTempEntries(tmpRoot);
  const nodeCoverageDir = createPerRunScratchDirs();
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_OPTIONS;
  childEnv.TMPDIR = tmpRoot;
  childEnv.NODE_V8_COVERAGE = nodeCoverageDir;
  childEnv.GRAPHIFY_BIN = createMockGraphifyBin();

  const result = _spawnSync(process.execPath, buildCoverageArgs(testFiles, coverageThreshold), {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: childEnv,
    stdio: ['pipe', 'inherit', 'inherit'],
    timeout: resolveTestTimeoutMs(),
  });

  cleanupNewTempDirs(tmpEntriesBefore, tmpRoot);
  cleanupPerRunScratch();

  if (result.error) {
    fmt.log.error(`[coverage-gate] failed to spawn test runner: ${result.error.message}`);
    return 1;
  }

  if (result.signal) {
    fmt.log.error(`[coverage-gate] test runner killed by signal ${result.signal}`);
    return 1;
  }

  return result.status === null ? 1 : result.status;
}

function main() {
  const testFiles = discoverTestFiles();
  if (testFiles.length === 0) {
    fmt.log.fail('no parallix test files found under test/');
    process.exit(1);
  }

  fmt.log.info(`Found ${testFiles.length} test file(s)`);

  if (dryRun) {
    fmt.log.info(`DRY-RUN mode — threshold=${threshold}%`);
    fmt.log.info('Denominator: index.js + lib/**/*.js');
    fmt.log.info(`Include globs: ${COVERAGE_INCLUDES.join(', ')}`);
    fmt.log.info(`Exclude globs: ${COVERAGE_EXCLUDES.join(', ')}`);
    fmt.log.info(`Would run: ${fmt.command(`${process.execPath} ${buildCoverageArgs(testFiles, threshold).join(' ')}`)}`);
    process.exit(0);
  }

  registerExitHandlers();
  process.exit(runTests(testFiles, threshold));
}

if (require.main === module) {
  main();
}

function run(args, options = {}) {
  const exitFn = options.exitFn || process.exit;
  let threshold_ = 90;
  let dryRun_ = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--threshold' && args[i + 1]) {
      threshold_ = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun_ = true;
    }
  }
  const savedThreshold = threshold;
  const savedDryRun = dryRun;
  threshold = threshold_;
  dryRun = dryRun_;
  try {
    if (dryRun_) {
      const testFiles = discoverTestFiles();
      if (testFiles.length === 0) {
        if (typeof exitFn === 'function') exitFn(1);
      } else {
        fmt.log.info(`Found ${testFiles.length} test file(s)`);
        fmt.log.info(`DRY-RUN mode — threshold=${threshold}%`);
        fmt.log.info('Denominator: index.js + lib/**/*.js');
        fmt.log.info(`Include globs: ${COVERAGE_INCLUDES.join(', ')}`);
        fmt.log.info(`Exclude globs: ${COVERAGE_EXCLUDES.join(', ')}`);
        fmt.log.info(`Would run: ${fmt.command(`${process.execPath} ${buildCoverageArgs(testFiles, threshold).join(' ')}`)}`);
        if (typeof exitFn === 'function') exitFn(0);
        else process.exit(0);
      }
    } else {
      registerExitHandlers();
      exitFn(runTests(discoverTestFiles(), threshold));
    }
  } finally {
    threshold = savedThreshold;
    dryRun = savedDryRun;
  }
}

module.exports = run;
module.exports.buildCoverageArgs = buildCoverageArgs;
module.exports.cleanupNewTempDirs = cleanupNewTempDirs;
module.exports.cleanupPerRunScratch = cleanupPerRunScratch;
module.exports.createPerRunScratchDirs = createPerRunScratchDirs;
module.exports.COVERAGE_EXCLUDES = COVERAGE_EXCLUDES;
module.exports.COVERAGE_INCLUDES = COVERAGE_INCLUDES;
module.exports.DEFAULT_TEST_TIMEOUT_MS = DEFAULT_TEST_TIMEOUT_MS;
module.exports.discoverTestFiles = discoverTestFiles;
module.exports.listTempEntries = listTempEntries;
module.exports.registerExitHandlers = registerExitHandlers;
module.exports.resetPerRunScratchState = resetPerRunScratchState;
module.exports.resolveTestTimeoutMs = resolveTestTimeoutMs;
module.exports.runTests = runTests;
module.exports.shouldCleanTempDir = shouldCleanTempDir;
