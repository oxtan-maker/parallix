"use strict";
/**
 * mutation-gate.ts - diff-scoped mutation testing gate with ratchet enforcement.
 *
 * Mirrors coverage-gate.ts's shape (dry-run mode, exit-code contract, testable
 * `run(args, options)` export) but complements it with a mutation-score
 * signal instead of line coverage. See docs/adr/adr-mutation-testing.md for
 * the rationale and lifecycle placement (pre-integrate, not per-checkpoint).
 *
 * Usage:
 *   node lib/commands/mutation-gate.js [--dry-run] [--base <branch>] [--head <ref>]
 *     [--baseline-path <path>] [--threshold <pct>]
 *
 * Exit 0 when every diff-scoped file's mutation score is >= its baseline
 * score (the ratchet) and, if --threshold is set, >= that absolute floor.
 * Exit 1 on any ratchet regression, threshold miss, or Stryker run failure.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECONDS_PER_TARGET_FILE = exports.DEFAULT_BASELINE_PATH = void 0;
exports.run = run;
exports.parseArgs = parseArgs;
exports.loadBaseline = loadBaseline;
exports.saveBaseline = saveBaseline;
exports.findTestFiles = findTestFiles;
exports.buildStrykerConfig = buildStrykerConfig;
exports.computeScoresFromReport = computeScoresFromReport;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const mutation_scoper_js_1 = __importDefault(require("../core/mutation-scoper.js"));
const mission_utils_js_1 = require("../core/mission-utils.js");
const fmt = __importStar(require("../core/fmt.js"));
const package_root_js_1 = require("../core/package-root.js");
const REPO_ROOT = (0, package_root_js_1.packageRoot)(__dirname);
const DEFAULT_BASELINE_PATH = path.join(REPO_ROOT, 'config', 'mutation-baseline.json');
exports.DEFAULT_BASELINE_PATH = DEFAULT_BASELINE_PATH;
// Rough per-mutant wall-clock budget for --dry-run's predicted-runtime estimate,
// based on the CP-1 POC (a single-mutant `node --test` command-runner pass took
// well under 1s on a trivial fixture; 5s/file is a conservative ceiling that
// accounts for larger real files and the ~3 mutants/file StrykerJS produced
// for a two-function fixture).
const SECONDS_PER_TARGET_FILE = 5;
exports.SECONDS_PER_TARGET_FILE = SECONDS_PER_TARGET_FILE;
function parseArgs(args) {
    let dryRun = false;
    let base = null;
    let head = 'HEAD';
    let baselinePath = DEFAULT_BASELINE_PATH;
    let threshold = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dry-run') {
            dryRun = true;
        }
        else if (args[i] === '--base' && args[i + 1]) {
            base = args[++i];
        }
        else if (args[i] === '--head' && args[i + 1]) {
            head = args[++i];
        }
        else if (args[i] === '--baseline-path' && args[i + 1]) {
            baselinePath = path.resolve(args[++i]);
        }
        else if (args[i] === '--threshold' && args[i + 1]) {
            threshold = parseFloat(args[++i]);
        }
    }
    return { dryRun, base, head, baselinePath, threshold };
}
function loadBaseline(baselinePath, fsModule = fs) {
    if (!fsModule.existsSync(baselinePath)) {
        return { filePaths: {} };
    }
    try {
        const parsed = JSON.parse(fsModule.readFileSync(baselinePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.filePaths && typeof parsed.filePaths === 'object') {
            return parsed;
        }
    }
    catch (_) {
        // fall through to empty baseline on parse failure
    }
    return { filePaths: {} };
}
function saveBaseline(baselinePath, baseline, fsModule = fs) {
    fsModule.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fsModule.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}
/** Find test files to run for the given target set: exact `<basename>.test.js` matches first, else the whole test/ suite. */
function findTestFiles(targetFiles, repoRoot, fsModule = fs) {
    const testDir = path.join(repoRoot, 'test');
    if (!fsModule.existsSync(testDir)) {
        return [];
    }
    const matched = new Set();
    for (const target of targetFiles) {
        const base = path.basename(target, '.js');
        const candidate = path.join(testDir, `${base}.test.js`);
        if (fsModule.existsSync(candidate)) {
            matched.add(candidate);
        }
    }
    if (matched.size === 0) {
        for (const file of fsModule.readdirSync(testDir)) {
            if (file.endsWith('.test.js')) {
                matched.add(path.join(testDir, file));
            }
        }
    }
    return Array.from(matched).sort();
}
function buildStrykerConfig(targetFiles, testFiles, repoRoot) {
    const relTestFiles = testFiles.map(f => path.relative(repoRoot, f));
    return {
        packageManager: 'npm',
        mutate: targetFiles,
        testRunner: 'command',
        commandRunner: {
            command: `${process.execPath} --test ${relTestFiles.join(' ')}`,
        },
        reporters: ['json'],
        coverageAnalysis: 'off',
        tempDirName: '.stryker-tmp-mutation-gate',
        concurrency: 2,
    };
}
function computeScoresFromReport(reportPath, fsModule = fs) {
    const report = JSON.parse(fsModule.readFileSync(reportPath, 'utf8'));
    const scores = {};
    for (const [file, data] of Object.entries(report.files || {})) {
        const mutants = data.mutants || [];
        let killed = 0;
        let survived = 0;
        let timeout = 0;
        for (const mutant of mutants) {
            if (mutant.status === 'Killed') {
                killed++;
            }
            else if (mutant.status === 'Survived') {
                survived++;
            }
            else if (mutant.status === 'Timeout') {
                timeout++;
            }
        }
        const denominator = killed + survived + timeout;
        const score = denominator === 0 ? 100 : Math.round((killed / denominator) * 10000) / 100;
        scores[file] = { killed, survived, timeout, score };
    }
    return scores;
}
function runStryker(configPath, runCwd, spawnSyncFn, strykerBin) {
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
function run(args = [], options = {}) {
    const { exitFn = process.exit, scopeFn = mutation_scoper_js_1.default, spawnSyncFn = node_child_process_1.spawnSync, getPrimaryBranchFn = mission_utils_js_1.getPrimaryBranch, fsModule = fs, repoRoot = REPO_ROOT, strykerBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'stryker'), } = options;
    const { dryRun, base, head, baselinePath, threshold } = parseArgs(args);
    let baseBranch = base;
    if (!baseBranch) {
        try {
            baseBranch = getPrimaryBranchFn(repoRoot);
        }
        catch (err) {
            fmt.log.fail(`Unable to resolve base branch: ${err.message}`);
            exitFn(1);
            return;
        }
    }
    let scope;
    try {
        scope = scopeFn(baseBranch, head, { repoRoot });
    }
    catch (err) {
        fmt.log.fail(`Failed to compute diff-scoped mutation targets: ${err.message}`);
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
        const regressions = [];
        const belowThreshold = [];
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
            for (const line of regressions) {
                fmt.log.fail(`  ${line}`);
            }
            exitFn(1);
            return;
        }
        if (belowThreshold.length > 0) {
            fmt.log.fail('mutation-gate: threshold FAILED — mutation score below floor on:');
            for (const line of belowThreshold) {
                fmt.log.fail(`  ${line}`);
            }
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
    }
    finally {
        try {
            fsModule.rmSync(scratchDir, { recursive: true, force: true });
        }
        catch (_) {
            // best-effort cleanup
        }
    }
}
if (typeof require !== 'undefined' && require.main === module) {
    run(process.argv.slice(2));
}
run.parseArgs = parseArgs;
run.loadBaseline = loadBaseline;
run.saveBaseline = saveBaseline;
run.findTestFiles = findTestFiles;
run.buildStrykerConfig = buildStrykerConfig;
run.computeScoresFromReport = computeScoresFromReport;
run.DEFAULT_BASELINE_PATH = DEFAULT_BASELINE_PATH;
run.SECONDS_PER_TARGET_FILE = SECONDS_PER_TARGET_FILE;
exports.default = run;
if (typeof module !== 'undefined') {
    module.exports = run;
}
