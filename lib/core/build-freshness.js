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
exports.findStaleBuildArtifacts = findStaleBuildArtifacts;
exports.formatBuildFreshnessMessage = formatBuildFreshnessMessage;
exports.getBuildFreshnessStatus = getBuildFreshnessStatus;
exports.assertBuildFreshness = assertBuildFreshness;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const fmt = __importStar(require("./fmt.js"));
function collectBuildArtifactPairs(rootDir) {
    const pairs = [];
    pairs.push([node_path_1.default.join(rootDir, 'px.ts'), node_path_1.default.join(rootDir, 'px.js')]);
    pairs.push([node_path_1.default.join(rootDir, 'index.ts'), node_path_1.default.join(rootDir, 'index.js')]);
    const commandsDir = node_path_1.default.join(rootDir, 'lib', 'commands');
    if (node_fs_1.default.existsSync(commandsDir)) {
        for (const entry of node_fs_1.default.readdirSync(commandsDir)) {
            if (!entry.endsWith('.ts')) {
                continue;
            }
            const tsPath = node_path_1.default.join(commandsDir, entry);
            const jsPath = node_path_1.default.join(commandsDir, entry.replace(/\.ts$/, '.js'));
            pairs.push([tsPath, jsPath]);
        }
    }
    return pairs;
}
function findStaleBuildArtifacts(rootDir) {
    const stale = [];
    for (const [tsPath, jsPath] of collectBuildArtifactPairs(rootDir)) {
        if (!node_fs_1.default.existsSync(tsPath)) {
            continue;
        }
        if (!node_fs_1.default.existsSync(jsPath)) {
            stale.push(`${tsPath} (no compiled sibling)`);
            continue;
        }
        const tsStat = node_fs_1.default.statSync(tsPath);
        const jsStat = node_fs_1.default.statSync(jsPath);
        if (jsStat.mtimeMs < tsStat.mtimeMs) {
            stale.push(`${jsPath} (mtime ${jsStat.mtimeMs} < ${tsPath} mtime ${tsStat.mtimeMs})`);
        }
    }
    return stale;
}
function formatBuildFreshnessMessage(stale) {
    return '[parallix] Stale build detected. One or more compiled artifacts are older than their TypeScript source:\n'
        + stale.map((entry) => `  - ${entry}`).join('\n')
        + '\nRun `npm run build:cjs` to regenerate, or set PARALLIX_SKIP_BUILD_CHECK=1 to bypass.\n';
}
function getBuildFreshnessStatus(rootDir) {
    if (process.env.PARALLIX_SKIP_BUILD_CHECK === '1') {
        return { ok: true, stale: [], message: null };
    }
    const stale = findStaleBuildArtifacts(rootDir);
    if (stale.length === 0) {
        return { ok: true, stale, message: null };
    }
    return {
        ok: false,
        stale,
        message: formatBuildFreshnessMessage(stale),
    };
}
/**
 * Verify that compiled JavaScript artifacts are fresh relative to their
 * TypeScript sources.  Skips when PARALLIX_SKIP_BUILD_CHECK=1.
 *
 * Checks:
 *   - Root entrypoints: px.ts <-> px.js, index.ts <-> index.js
 *   - All lib/commands/*.ts <-> lib/commands/*.js pairs
 *
 * Returns true when all pairs are fresh (or source has no sibling JS).
 * Prints a clear error with the `npm run build:cjs` instruction and
 * exits non-zero on any staleness detected.
 *
 * This check is only meaningful against a source checkout: `.ts` sources are
 * excluded from the published npm package (see package.json's "files" entry
 * `!lib/**\/*.ts`), so an installed package has no `.ts` files to compare
 * against and every pair is skipped via findStaleBuildArtifacts' `!fs.existsSync(tsPath)`
 * branch, always ok. That's intentional (task-1424): tarball extraction
 * assigns each file its own extraction-time mtime in directory-sorted order,
 * and "<name>.ts" always sorts after "<name>.js", so a packaged-and-installed
 * `.ts`/`.js` pair would otherwise always look stale regardless of actual
 * build freshness. The checkout-side guard (npm run prepack/publish:guard)
 * still runs against the full source tree before packing, so a genuinely
 * stale checkout is still caught before it is ever shipped.
 */
function assertBuildFreshness(rootDir, exitFn = process.exit, errorFn = fmt.log.plainError) {
    const status = getBuildFreshnessStatus(rootDir);
    if (!status.ok) {
        errorFn(status.message || formatBuildFreshnessMessage(status.stale));
        exitFn(1);
    }
}
