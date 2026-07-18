"use strict";
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
exports.findReproTestPath = findReproTestPath;
exports.resolveMissionParentCommit = resolveMissionParentCommit;
exports.runReproAtRef = runReproAtRef;
exports.verifyRedGreenProof = verifyRedGreenProof;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fmt = __importStar(require("../core/fmt.js"));
const mission_utils_js_1 = require("../core/mission-utils.js");
const git_js_1 = require("../core/git.js");
const REPRO_TEST_MARKER = /^Reproduction-Test:\s*(.+?)\s*$/m;
/**
 * Locate the reproduction test path from a `Reproduction-Test: <path>` line in
 * MISSION.md or any checkpoint document. Returns null when none is declared.
 */
function findReproTestPath(slug, rootDir, options = {}) {
    const { findMissionDirFn = mission_utils_js_1.findMissionDir, findCheckpointsFn = mission_utils_js_1.findCheckpoints } = options;
    const missionDir = findMissionDirFn(slug, rootDir);
    if (!missionDir) {
        return null;
    }
    const candidates = [path_1.default.join(missionDir, 'MISSION.md')];
    try {
        candidates.push(...findCheckpointsFn(missionDir));
    }
    catch (_) {
        // missionDir may not be readable; MISSION.md alone is enough to try
    }
    for (const file of candidates) {
        if (!file || !fs_1.default.existsSync(file)) {
            continue;
        }
        const match = fs_1.default.readFileSync(file, 'utf8').match(REPRO_TEST_MARKER);
        if (match) {
            return match[1].trim();
        }
    }
    return null;
}
/**
 * Resolve the commit where the mission branch diverged from its base branch.
 * Uses merge-base so a rebased/advanced base still yields the true fork point.
 */
function resolveMissionParentCommit(slug, rootDir, options = {}) {
    const { gitFn = null } = options;
    const runner = gitFn || git_js_1.git;
    const branch = options.branch || (0, mission_utils_js_1.missionBranchName)(slug, rootDir);
    let base;
    try {
        base = (0, mission_utils_js_1.resolveMissionBaseBranch)(slug, rootDir, { gitFn: runner });
    }
    catch (_) {
        return null;
    }
    const result = runner(['-C', rootDir, 'merge-base', base, branch]);
    const sha = ((result && result.stdout) || '').trim();
    return result && result.status === 0 && sha ? sha : null;
}
/**
 * Run a test against the source at `ref`, overlaying the test file from
 * `headRef` so the test exists even at the parent commit (where it was not
 * yet authored). Runs inside a throwaway detached worktree so the live
 * worktree is never mutated.
 */
function runReproAtRef(ref, testPath, options = {}) {
    const { rootDir = process.cwd(), headRef = 'HEAD', gitFn = null, runCommandFn = null } = options;
    const gitRunner = gitFn || git_js_1.git;
    const cmdRunner = runCommandFn || git_js_1.run;
    const tmp = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'redgreen-'));
    const worktreePath = path_1.default.join(tmp, 'wt');
    try {
        const add = gitRunner(['-C', rootDir, 'worktree', 'add', '--detach', worktreePath, ref]);
        if (!add || add.status !== 0) {
            return { status: null, skipped: true, reason: 'worktree-add-failed' };
        }
        // Overlay the reproduction test from the branch HEAD so the parent ref runs
        // the same test against pre-fix source.
        const show = gitRunner(['-C', rootDir, 'show', `${headRef}:${testPath}`]);
        if (show && show.status === 0) {
            const dest = path_1.default.join(worktreePath, testPath);
            fs_1.default.mkdirSync(path_1.default.dirname(dest), { recursive: true });
            fs_1.default.writeFileSync(dest, show.stdout);
        }
        const result = cmdRunner('node', ['--test', testPath], { cwd: worktreePath });
        return { status: result && typeof result.status === 'number' ? result.status : 1 };
    }
    finally {
        try {
            gitRunner(['-C', rootDir, 'worktree', 'remove', '--force', worktreePath]);
        }
        catch (_) { }
        try {
            fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
        catch (_) { }
    }
}
/**
 * Verify the red→green proof for a mission that declares a reproduction test.
 * Returns:
 *   { ok: true, skipped: true }  — no usable test runner
 *   { ok: true, skipped: false } — repro failed at parent and passed at HEAD
 *   { ok: false, ... , error }   — repro missing, passed at parent, or failed at HEAD
 */
function verifyRedGreenProof(slug, options = {}) {
    const { rootDir = process.cwd(), log = fmt.log.plain, headRef = 'HEAD', findReproTestPathFn = findReproTestPath, resolveMissionParentCommitFn = resolveMissionParentCommit, runReproAtRefFn = runReproAtRef, branch: branchOverride } = options;
    const branch = branchOverride || (0, mission_utils_js_1.missionBranchName)(slug, rootDir);
    // Strip injected-function keys from options before passing to child calls
    const childOpts = { ...options };
    delete childOpts.findReproTestPathFn;
    delete childOpts.resolveMissionParentCommitFn;
    delete childOpts.runReproAtRefFn;
    delete childOpts.branch;
    // 1. Locate the reproduction test declared by the mission.
    const testPath = findReproTestPathFn(slug, rootDir, childOpts);
    if (!testPath) {
        const errMsg = `Mission ${slug} declares no \`Reproduction-Test:\` line in MISSION.md or any checkpoint document.`;
        log(fmt.status('FAIL', errMsg));
        return { ok: false, skipped: false, reason: 'repro-not-declared', error: errMsg };
    }
    // 2. Resolve the parent commit (fork point) of the mission branch.
    const parentCommit = resolveMissionParentCommitFn(slug, rootDir, { branch, ...childOpts });
    if (!parentCommit) {
        const errMsg = `Could not resolve the parent commit for mission ${slug} (ambiguous or missing merge base).`;
        log(fmt.status('FAIL', errMsg));
        return { ok: false, skipped: false, reason: 'parent-unresolved', error: errMsg };
    }
    // 3. Red: the reproduction test must FAIL at the parent commit.
    const red = runReproAtRefFn(parentCommit, testPath, { rootDir, headRef, ...childOpts });
    if (red && red.skipped) {
        log(fmt.status('WARN', `Red→green gate: no usable test runner for ${slug} (${red.reason || 'unknown'}); skipping.`));
        return { ok: true, skipped: true, reason: red.reason || 'no-test-runner' };
    }
    if (red.status === 0) {
        const errMsg = `Reproduction test ${testPath} PASSED at parent commit ${parentCommit.slice(0, 12)} — it must fail (red) to lock the bug.`;
        log(fmt.status('FAIL', errMsg));
        return { ok: false, skipped: false, reason: 'not-red', error: errMsg, testPath, parentCommit };
    }
    // 4. Green: the reproduction test must PASS at HEAD.
    const green = runReproAtRefFn(headRef, testPath, { rootDir, headRef, ...childOpts });
    if (green && green.skipped) {
        log(fmt.status('WARN', `Red→green gate: could not run repro at HEAD for ${slug} (${green.reason || 'unknown'}); skipping.`));
        return { ok: true, skipped: true, reason: green.reason || 'no-test-runner' };
    }
    if (green.status !== 0) {
        const errMsg = `Reproduction test ${testPath} FAILED at HEAD — the fix must make it pass (green).`;
        log(fmt.status('FAIL', errMsg));
        return { ok: false, skipped: false, reason: 'not-green', error: errMsg, testPath, parentCommit };
    }
    log(fmt.status('INFO', `Red→green gate: ${slug} repro ${testPath} red at ${parentCommit.slice(0, 12)}, green at HEAD.`));
    return { ok: true, skipped: false, reason: 'red-green-verified', testPath, parentCommit };
}
/**
 * CLI entry point: px verify-repro --test <path> --slug <slug>
 * Standalone command for verifying red→green proof outside the handoff flow.
 */
function main() {
    const args = process.argv.slice(2);
    let slug = null;
    let testPath = null;
    let rootDir = process.cwd();
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--slug' && args[i + 1]) {
            slug = args[++i];
        }
        else if (args[i] === '--test' && args[i + 1]) {
            testPath = args[++i];
        }
        else if (args[i] === '--root' && args[i + 1]) {
            rootDir = args[++i];
        }
    }
    if (!slug) {
        process.stderr.write('Usage: node lib/tools/redgreen.js --slug <slug> --test <path>\n');
        process.exit(1);
    }
    if (!testPath) {
        // Try to find it from MISSION.md
        testPath = findReproTestPath(slug, rootDir);
        if (!testPath) {
            process.stderr.write(`No --test specified and no Reproduction-Test: line found for ${slug}\n`);
            process.exit(1);
        }
    }
    const result = verifyRedGreenProof(slug, { rootDir, log: process.stdout.write.bind(process.stdout), testPath });
    if (!result.ok) {
        process.stderr.write(`FAIL: ${result.error}\n`);
        process.exit(1);
    }
    if (result.skipped) {
        process.stdout.write(`SKIP: ${result.reason}\n`);
        process.exit(0);
    }
    process.stdout.write(`PASS: ${result.reason} (test: ${result.testPath})\n`);
    process.exit(0);
}
// CLI entry point when run directly
if (typeof require !== 'undefined' && require.main === module) {
    main();
}
;
