"use strict";
/**
 * mutation-scoper.ts - resolve the diff-scoped file set for mutation testing.
 *
 * Computes the files changed between a base branch and a head ref, then
 * resolves their direct (depth-1) local callees by scanning
 * `require()`/`import ... from` statements — a lightweight regex-based scan,
 * not a full TypeScript compiler pass (see docs/adr/adr-mutation-testing.md
 * for why: a full compiler-services pass was ruled out by the mission's stop
 * rules as unacceptable added complexity for a diff-scoping utility).
 *
 * Scope is restricted to `lib/**\/*.js` and top-level `index.js`, matching
 * coverage-gate.ts's denominator and the mission's "lib/ source files, not
 * test/ files" boundary.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.scopeMutationTargets = scopeMutationTargets;
exports.getChangedFiles = getChangedFiles;
exports.resolveCallees = resolveCallees;
exports.extractLocalDependencies = extractLocalDependencies;
exports.isInScope = isInScope;
exports.toRuntimePath = toRuntimePath;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const git_js_1 = require("./git.js");
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REQUIRE_RE = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
const IMPORT_FROM_RE = /(?:import|export)[^'"]*from\s+['"](\.\.?\/[^'"]+)['"]/g;
function isInScope(relPath) {
    if (relPath === 'index.js') {
        return true;
    }
    return relPath.startsWith('lib/') && relPath.endsWith('.js');
}
/**
 * Git tracks `.ts` sources (the `.js` build output of `npm run build:cjs` is
 * gitignored — see `.gitignore`), but mutation testing targets the compiled
 * `.js` that actually runs under `node --test` (per the CP-1 POC). Map a
 * changed `.ts` path to its build-output `.js` counterpart; pass through an
 * already-`.js` path unchanged (covers repos/configs where the build output
 * is tracked directly).
 */
function toRuntimePath(relPath) {
    if (relPath.endsWith('.ts') && !relPath.endsWith('.d.ts')) {
        return `${relPath.slice(0, -3)}.js`;
    }
    return relPath;
}
/** Compute the set of in-scope files changed between baseBranch and headRef, mapped to their runtime .js paths. */
function getChangedFiles(baseBranch, headRef = 'HEAD', options = {}) {
    const { gitFn = git_js_1.git, repoRoot = REPO_ROOT } = options;
    const result = gitFn(['-C', repoRoot, 'diff', '--name-only', '--diff-filter=ACMR', `${baseBranch}...${headRef}`]);
    if (result.status !== 0) {
        return [];
    }
    return Array.from(new Set(result.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(toRuntimePath)
        .filter(isInScope))).sort();
}
/** Resolve a single relative require/import specifier to a repo-relative .js path, if it exists in-scope. */
function resolveSpecifier(fromAbsFile, specifier, repoRoot, fsModule) {
    const fromDir = path.dirname(fromAbsFile);
    let candidate = path.resolve(fromDir, specifier);
    if (!candidate.endsWith('.js')) {
        candidate = `${candidate}.js`;
    }
    if (!fsModule.existsSync(candidate)) {
        return null;
    }
    const rel = path.relative(repoRoot, candidate).split(path.sep).join('/');
    return isInScope(rel) ? rel : null;
}
/** Scan a file's source for local require()/import specifiers, resolved to repo-relative paths. */
function extractLocalDependencies(relFile, options = {}) {
    const { repoRoot = REPO_ROOT, fsModule = fs } = options;
    const absFile = path.join(repoRoot, relFile);
    if (!fsModule.existsSync(absFile)) {
        return [];
    }
    const source = fsModule.readFileSync(absFile, 'utf8');
    const found = new Set();
    for (const re of [REQUIRE_RE, IMPORT_FROM_RE]) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(source)) !== null) {
            const resolved = resolveSpecifier(absFile, match[1], repoRoot, fsModule);
            if (resolved) {
                found.add(resolved);
            }
        }
    }
    return Array.from(found);
}
/** Resolve direct (depth-1) local callees of the given changed files. Full transitive closure is intentionally avoided to prevent hub-file blowup (e.g. a changed handoff.ts pulling in agents/*, review/*, tools/*) which can exceed the 60s mutation-testing budget — see docs/adr/adr-mutation-testing.md. */
function resolveCallees(changedFiles, options = {}) {
    const callees = new Set();
    for (const file of changedFiles) {
        const deps = extractLocalDependencies(file, options);
        for (const dep of deps) {
            callees.add(dep);
        }
    }
    return Array.from(callees).sort();
}
/** Compute the full diff-scoped mutation target set: changed files + their direct local callees. */
function scopeMutationTargets(baseBranch, headRef = 'HEAD', options = {}) {
    const changedFiles = getChangedFiles(baseBranch, headRef, options);
    const calleeFiles = resolveCallees(changedFiles, options);
    const targetFiles = Array.from(new Set([...changedFiles, ...calleeFiles])).sort();
    return { baseBranch, headRef, changedFiles, calleeFiles, targetFiles };
}
exports.default = scopeMutationTargets;
if (typeof module !== 'undefined') {
    module.exports = scopeMutationTargets;
    module.exports.scopeMutationTargets = scopeMutationTargets;
    module.exports.getChangedFiles = getChangedFiles;
    module.exports.resolveCallees = resolveCallees;
    module.exports.extractLocalDependencies = extractLocalDependencies;
    module.exports.isInScope = isInScope;
    module.exports.toRuntimePath = toRuntimePath;
}
