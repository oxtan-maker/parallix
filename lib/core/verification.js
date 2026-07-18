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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_GATE_NOTICE = exports.DEFAULT_AREA = void 0;
exports.resolveVerificationAdapter = resolveVerificationAdapter;
exports.detectAreasFromChangedFiles = detectAreasFromChangedFiles;
exports.detectMissionChangedArea = detectMissionChangedArea;
exports.resolveEffectiveArea = resolveEffectiveArea;
exports.formatVerificationCommand = formatVerificationCommand;
exports.runVerificationGate = runVerificationGate;
exports.createVerificationProofIdentity = createVerificationProofIdentity;
exports.verificationProofPath = verificationProofPath;
exports.readReusableVerificationProof = readReusableVerificationProof;
exports.writeReusableVerificationProof = writeReusableVerificationProof;
exports.readPublishedTreeState = readPublishedTreeState;
exports.captureVerifiedTreeProof = captureVerifiedTreeProof;
exports.assertVerifiedTreeProof = assertVerifiedTreeProof;
exports.default = runWorkflow;
const git_js_1 = require("./git.js");
const product_config_js_1 = require("./product-config.js");
const fmt_js_1 = require("./fmt.js");
const fsMod = __importStar(require("node:fs"));
const pathMod = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const build_freshness_js_1 = require("./build-freshness.js");
const mission_utils_js_1 = require("./mission-utils.js");
const storage_js_1 = require("./storage.js");
// parallix targets arbitrary repositories, so there is no universal gate
// command. When adapters.verification.command is not configured, verification
// is a no-op pass ("no validation"). A repository opts into a real gate by
// declaring the command in workflow.config.json.
exports.DEFAULT_AREA = 'docs';
// Shell-safe no-op so this is harmless if pasted into a command sequence: `:` is
// the bash null command and `#` comments the explanation.
exports.NO_GATE_NOTICE = ': # no verification gate configured (set adapters.verification.command)';
function resolveVerificationAdapter(rootDir = process.cwd()) {
    const config = (0, product_config_js_1.loadAdapterConfig)(rootDir);
    const verification = config.verification || {};
    const command = typeof verification.command === 'string' && verification.command.trim()
        ? verification.command.trim()
        : null;
    const defaultArea = typeof verification.defaultArea === 'string' && verification.defaultArea.trim()
        ? verification.defaultArea.trim()
        : exports.DEFAULT_AREA;
    return { command, defaultArea };
}
const KNOWN_CHANGE_AREAS = ['lib', 'server', 'auth-server', 'web-client', 'docs', 'workflow', 'android', 'kubernetes'];
const WORKFLOW_OWNED_DIRS = new Set(['test', 'scripts', 'config', 'prompts', 'data']);
/** @param {string} filesOutput */
function detectAreasFromChangedFiles(filesOutput) {
    const areas = new Set();
    filesOutput.split('\n').forEach((rawFile) => {
        const file = rawFile.trim();
        if (!file || !file.includes('/')) {
            return;
        }
        const topDir = file.split('/')[0];
        if (KNOWN_CHANGE_AREAS.includes(topDir)) {
            areas.add(topDir);
            return;
        }
        if (WORKFLOW_OWNED_DIRS.has(topDir)) {
            areas.add('workflow');
        }
    });
    return Array.from(areas);
}
/**
 * Detect the verification area from files changed in the mission's worktree
 * relative to the primary branch. Returns null when no mission context or
 * relevant changed files are available.
 */
function detectMissionChangedArea(missionDir, rootDir = process.cwd(), options = {}) {
    if (!missionDir) {
        return null;
    }
    const gitRunner = options.gitRunner || git_js_1.git;
    let baseBranch = options.baseBranch;
    if (!baseBranch) {
        try {
            baseBranch = (0, mission_utils_js_1.getPrimaryBranch)(rootDir, gitRunner);
        }
        catch {
            return null;
        }
    }
    const diffResult = gitRunner(['-C', rootDir, 'diff', '--name-only', `${baseBranch}...HEAD`]);
    if (diffResult.status !== 0 || !diffResult.stdout || !diffResult.stdout.trim()) {
        return null;
    }
    const areas = detectAreasFromChangedFiles(diffResult.stdout);
    // A verification command accepts one area. Mixed-area changes must use the
    // strict superset rather than silently choosing the first path in git's
    // alphabetical output (for example, docs before lib).
    if (areas.length > 1) {
        return 'all';
    }
    return areas[0] || null;
}
/** Resolve an explicit, diff-scoped, or configured verification area. */
function resolveEffectiveArea(area, rootDir = process.cwd(), missionDir = null) {
    if (area) {
        return area;
    }
    const { defaultArea } = resolveVerificationAdapter(rootDir);
    return detectMissionChangedArea(missionDir, rootDir) || defaultArea;
}
/** @param {string} [area] @param {string} [rootDir] @param {string|null} [missionDir] */
function formatVerificationCommand(area, rootDir = process.cwd(), missionDir = null) {
    const { command } = resolveVerificationAdapter(rootDir);
    // An already-resolved area is authoritative. Only resolve from mission
    // context when the caller has not supplied one.
    const effectiveArea = area || resolveEffectiveArea(undefined, rootDir, missionDir);
    if (!command) {
        return exports.NO_GATE_NOTICE;
    }
    return command.replaceAll('{{area}}', effectiveArea || exports.DEFAULT_AREA);
}
/** @param {string} [area] @param {{rootDir?: string, log?: Function, stdio?: string, runFn?: Function}} [options] */
function runVerificationGate(area, options = {}) {
    const opts = options;
    const rootDir = opts.rootDir || process.cwd();
    const { command, defaultArea } = resolveVerificationAdapter(rootDir);
    const effectiveArea = area || defaultArea;
    if (!command) {
        const info = opts.log || fmt_js_1.log.info;
        info(`No verification gate configured for area: ${effectiveArea}; default is no validation. `
            + 'Set adapters.verification.command in workflow.config.json to enforce one.');
        return { status: 0 };
    }
    const stdio = opts.stdio || 'inherit';
    const runFn = opts.runFn || git_js_1.run;
    return runFn('bash', ['-c', command.replaceAll('{{area}}', effectiveArea)], { cwd: rootDir, stdio });
}
function digest(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
}
/**
 * Fingerprint every tracked input for an expensive verifier. This deliberately
 * uses the complete tracked index rather than a guessed changed-file subset:
 * an incomplete manifest must execute, never reuse. Any dirty worktree fails
 * closed before the index fingerprint can be trusted.
 */
function createVerificationProofIdentity(command, rootDir = process.cwd(), options = {}) {
    if (typeof command !== 'string' || !command.trim()) {
        return { ok: false, error: 'verification proof requires a non-empty command' };
    }
    const gitRunner = options.gitRunner || git_js_1.git;
    let resolvedRoot;
    try {
        resolvedRoot = fsMod.realpathSync(rootDir);
    }
    catch {
        return { ok: false, error: 'verification proof root is unreadable' };
    }
    const dirty = gitRunner(['-C', resolvedRoot, 'status', '--porcelain']);
    const dirtyOutput = dirty.stdout || '';
    if (dirty.status !== 0 || dirtyOutput.trim()) {
        return { ok: false, error: 'verification proof cannot reuse a dirty worktree' };
    }
    const tracked = gitRunner(['-C', resolvedRoot, 'ls-files', '-s']);
    const trackedOutput = tracked.stdout || '';
    if (tracked.status !== 0 || !trackedOutput.trim()) {
        return { ok: false, error: 'verification proof input manifest is unreadable' };
    }
    const toolchain = JSON.stringify({ node: process.version, modules: process.versions.modules, platform: process.platform, arch: process.arch });
    const inputFingerprint = digest(trackedOutput);
    return { ok: true, inputFingerprint, toolchain, identity: digest(JSON.stringify({ version: 1, command: command.trim(), inputFingerprint, toolchain })) };
}
function verificationProofPath(identity, homeDir = (0, storage_js_1.resolveParallixHome)({ ensureDir: false })) {
    return pathMod.join(homeDir, 'verification-proofs', `${identity}.json`);
}
function readReusableVerificationProof(command, rootDir = process.cwd(), options = {}) {
    const identityResult = createVerificationProofIdentity(command, rootDir, options);
    if (!identityResult.ok) {
        return identityResult;
    }
    const filePath = options.proofPath || verificationProofPath(identityResult.identity);
    const result = (0, storage_js_1.readJson)(filePath);
    const proof = result.data;
    if (!result.ok || !proof || proof.version !== 1 || proof.status !== 'passed'
        || proof.identity !== identityResult.identity || proof.command !== command.trim()
        || proof.inputFingerprint !== identityResult.inputFingerprint || proof.toolchain !== identityResult.toolchain) {
        return { ok: false, identity: identityResult.identity, error: 'verification proof is missing, malformed, or does not match current inputs' };
    }
    return { ok: true, proof, identity: identityResult.identity };
}
function writeReusableVerificationProof(command, rootDir = process.cwd(), options = {}) {
    const identityResult = createVerificationProofIdentity(command, rootDir, options);
    if (!identityResult.ok) {
        return identityResult;
    }
    if (options.expectedIdentity && identityResult.identity !== options.expectedIdentity) {
        return { ok: false, identity: identityResult.identity, error: 'verification inputs changed while the gate was running' };
    }
    const proof = { version: 1, identity: identityResult.identity, command: command.trim(), inputFingerprint: identityResult.inputFingerprint, toolchain: identityResult.toolchain, status: 'passed' };
    try {
        (0, storage_js_1.writeJson)(options.proofPath || verificationProofPath(proof.identity, (0, storage_js_1.resolveParallixHome)({ ensureDir: true })), proof, { mode: 0o600 });
    }
    catch {
        return { ok: false, identity: proof.identity, error: 'verification proof could not be written' };
    }
    return { ok: true, proof, identity: proof.identity };
}
/** @param {string} rootDir @param {{gitRunner?: GitFn}} [options] */
function readPublishedTreeState(rootDir, options = {}) {
    const gitRunner = options.gitRunner || git_js_1.git;
    const resolvedRoot = fsMod.realpathSync(rootDir);
    const commitResult = gitRunner(['-C', resolvedRoot, 'rev-parse', 'HEAD']);
    const treeResult = gitRunner(['-C', resolvedRoot, 'rev-parse', 'HEAD^{tree}']);
    const commit = commitResult.stdout ? commitResult.stdout.trim() : '';
    const tree = treeResult.stdout ? treeResult.stdout.trim() : '';
    if (commitResult.status !== 0 || treeResult.status !== 0 || !commit || !tree) {
        return {
            ok: false,
            error: `could not resolve current published tree for ${resolvedRoot}`
        };
    }
    return { ok: true, rootDir: resolvedRoot, commit, tree };
}
/** @param {string} [area] @param {string} [rootDir] @param {{gitRunner?: GitFn, runFn?: Function, stdio?: string}} [options] */
function captureVerifiedTreeProof(area, rootDir = process.cwd(), options = {}) {
    const { gitRunner = git_js_1.git, runFn = git_js_1.run, stdio = 'inherit' } = options;
    const freshness = (0, build_freshness_js_1.getBuildFreshnessStatus)(rootDir);
    if (!freshness.ok) {
        fmt_js_1.log.warn(freshness.message || 'build freshness check failed');
    }
    const before = readPublishedTreeState(rootDir, { gitRunner });
    if (!before.ok) {
        return before;
    }
    const verification = runVerificationGate(area, {
        rootDir: before.rootDir,
        runFn,
        stdio
    });
    if (verification.status !== 0) {
        return {
            ok: false,
            error: `verification gate failed for ${before.rootDir} with exit code ${verification.status}`
        };
    }
    const after = readPublishedTreeState(before.rootDir, { gitRunner });
    if (!after.ok) {
        return after;
    }
    if (after.commit !== before.commit || after.tree !== before.tree) {
        return {
            ok: false,
            error: `verification proof became stale while publishing ${before.rootDir}`
        };
    }
    const { command, defaultArea } = resolveVerificationAdapter(before.rootDir);
    const effectiveArea = area || defaultArea;
    return {
        ok: true,
        proof: {
            rootDir: before.rootDir,
            area: effectiveArea,
            command: command || null,
            commit: after.commit,
            tree: after.tree,
            verifiedAt: new Date().toISOString()
        }
    };
}
/** @param {{rootDir?: string, commit?: string, tree?: string}} proof @param {string} [rootDir] @param {{gitRunner?: GitFn}} [opts] */
function assertVerifiedTreeProof(proof, rootDir = process.cwd(), opts = {}) {
    if (!proof || typeof proof !== 'object') {
        return { ok: false, error: 'missing verification proof' };
    }
    const o = opts;
    const gitRunner = o.gitRunner || git_js_1.git;
    const freshness = (0, build_freshness_js_1.getBuildFreshnessStatus)(rootDir);
    if (!freshness.ok) {
        fmt_js_1.log.warn(freshness.message || 'build freshness check failed');
    }
    const current = readPublishedTreeState(rootDir, { gitRunner });
    if (!current.ok) {
        return current;
    }
    if (proof.rootDir !== current.rootDir) {
        return { ok: false, error: `verification proof was captured from a different checkout: ${proof.rootDir}` };
    }
    if (proof.commit !== current.commit || proof.tree !== current.tree) {
        return { ok: false, error: 'verification proof does not match the tree being published' };
    }
    return { ok: true, proof: current };
}
/** @param {string[]} args @param {{log?: Function}} [options] */
function runWorkflow(args, options = {}) {
    const opts = options;
    const logFn = opts.log || fmt_js_1.log.plain;
    const area = args[0] || process.env.VERIFY_AREA || exports.DEFAULT_AREA;
    logFn(`Running verification gate for area: ${area}...`);
    return runVerificationGate(area, { stdio: 'inherit' });
}
