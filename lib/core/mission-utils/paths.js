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
exports.SUPPORTED_VERIFY_AREAS = void 0;
exports.missionAdapterDefaults = missionAdapterDefaults;
exports.resolveMissionAdapter = resolveMissionAdapter;
exports.missionBaseDir = missionBaseDir;
exports.missionUsesYearTier = missionUsesYearTier;
exports.missionBranchPrefix = missionBranchPrefix;
exports.missionBranchName = missionBranchName;
exports.missionBranchRef = missionBranchRef;
exports.isMissionSlugCandidate = isMissionSlugCandidate;
exports.extractSlugFromBranch = extractSlugFromBranch;
exports.getMissionYear = getMissionYear;
exports.missionDirForSlug = missionDirForSlug;
exports.missionPathForSlug = missionPathForSlug;
exports.findMissionDir = findMissionDir;
exports.inferSlug = inferSlug;
exports.findCheckpoints = findCheckpoints;
exports.compareCheckpointFiles = compareCheckpointFiles;
exports.checkpointOrder = checkpointOrder;
exports.getFirstLine = getFirstLine;
exports.missionTitle = missionTitle;
exports.normalizeVerifyArea = normalizeVerifyArea;
exports.detectMissionAreaFromContent = detectMissionAreaFromContent;
exports.findMissionArea = findMissionArea;
const fs = __importStar(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const product_config_js_1 = require("../product-config.js");
const gitModule = __importStar(require("../git.js"));
/** @param {string} prefix */
function normalizeBranchPrefix(prefix) {
    if (typeof prefix !== 'string' || !prefix.trim()) {
        return 'mission/';
    }
    return prefix.endsWith('/') ? prefix : prefix + '/';
}
function missionAdapterDefaults() {
    return {
        baseDir: 'missions',
        branchPrefix: 'mission/',
        worktreePattern: '../<repo>-<slug>',
    };
}
function resolveMissionAdapter(rootDir = process.cwd()) {
    const adapters = (0, product_config_js_1.loadAdapterConfig)(rootDir);
    const missions = adapters.missions || {};
    const defaults = missionAdapterDefaults();
    return {
        baseDir: typeof missions.baseDir === 'string' && missions.baseDir.trim()
            ? missions.baseDir
            : defaults.baseDir,
        branchPrefix: normalizeBranchPrefix(missions.branchPrefix || defaults.branchPrefix),
        worktreePattern: typeof missions.worktreePattern === 'string' && missions.worktreePattern.trim()
            ? missions.worktreePattern
            : defaults.worktreePattern,
    };
}
function missionBaseDir(rootDir = process.cwd()) {
    return node_path_1.default.resolve(rootDir, resolveMissionAdapter(rootDir).baseDir);
}
function missionUsesYearTier(rootDir = process.cwd()) {
    return resolveMissionAdapter(rootDir).baseDir !== missionAdapterDefaults().baseDir;
}
function missionBranchPrefix(rootDir = process.cwd()) {
    return resolveMissionAdapter(rootDir).branchPrefix;
}
/** @param {string} slug @param {string} [rootDir] */
function missionBranchName(slug, rootDir = process.cwd()) {
    return missionBranchPrefix(rootDir) + slug;
}
/** @param {string} slug @param {string} [rootDir] */
function missionBranchRef(slug, rootDir = process.cwd()) {
    return 'refs/heads/' + missionBranchName(slug, rootDir);
}
/** @param {unknown} value */
function isMissionSlugCandidate(value) {
    return typeof value === 'string' && /^(task|adhoc)-[a-z0-9][a-z0-9-]*$/i.test(value.trim());
}
/** @param {string} branch @param {string} [rootDir] */
function extractSlugFromBranch(branch, rootDir = process.cwd()) {
    const prefix = missionBranchPrefix(rootDir);
    if (!branch || !branch.startsWith(prefix)) {
        return null;
    }
    return branch.slice(prefix.length).toLowerCase();
}
/** @param {string|undefined} [slug] @param {string} [rootDir] */
function getMissionYear(slug = undefined, rootDir = process.cwd()) {
    if (process.env.MISSION_YEAR_OVERRIDE) {
        return process.env.MISSION_YEAR_OVERRIDE;
    }
    const hasExplicitConfig = fs.existsSync(node_path_1.default.join(rootDir, 'workflow.config.json'));
    if (slug && (missionUsesYearTier(rootDir) || (!hasExplicitConfig && fs.existsSync(node_path_1.default.join(rootDir, 'docs', 'missions'))))) {
        const baseDir = missionUsesYearTier(rootDir)
            ? missionBaseDir(rootDir)
            : node_path_1.default.join(rootDir, 'docs', 'missions');
        if (fs.existsSync(baseDir)) {
            try {
                const stat = fs.statSync(baseDir);
                if (!stat.isDirectory()) {
                    return new Date().getFullYear().toString();
                }
            }
            catch (_) {
                return new Date().getFullYear().toString();
            }
            const years = fs.readdirSync(baseDir)
                .filter(d => /^\d{4}$/.test(d))
                .sort((a, b) => b.localeCompare(a));
            const slugStr = slug;
            const candidateSlugs = [slugStr.toLowerCase()];
            const baseTaskMatch = slugStr.match(/^(task-\d+)/i);
            if (baseTaskMatch) {
                candidateSlugs.push(baseTaskMatch[1].toLowerCase());
            }
            for (const year of years) {
                for (const s of candidateSlugs) {
                    const missionDir = node_path_1.default.join(baseDir, year, s);
                    if (fs.existsSync(missionDir)) {
                        return year;
                    }
                }
            }
        }
    }
    return new Date().getFullYear().toString();
}
/** @param {string} rootDir @param {string} slug */
function missionDirForSlug(rootDir, slug) {
    const parts = [missionBaseDir(rootDir)];
    if (missionUsesYearTier(rootDir)) {
        parts.push(getMissionYear(slug, rootDir));
    }
    parts.push(slug);
    return node_path_1.default.join(...parts);
}
/** @param {string} rootDir @param {string} slug */
function missionPathForSlug(rootDir, slug) {
    return node_path_1.default.join(missionDirForSlug(rootDir, slug), 'MISSION.md');
}
/** @param {string} slug @param {string} [rootDir] @param {{missionPath?: string}} options */
function findMissionDir(slug, rootDir = process.cwd(), options = {}) {
    const opts = options;
    if (opts.missionPath && fs.existsSync(opts.missionPath)) {
        return fs.statSync(opts.missionPath).isDirectory() ? opts.missionPath : node_path_1.default.dirname(opts.missionPath);
    }
    if (!slug) {
        return null;
    }
    const missionDir = missionDirForSlug(rootDir, slug);
    if (fs.existsSync(missionDir)) {
        return missionDir;
    }
    const baseTaskMatch = slug.match(/^(task-\d+)/i);
    if (baseTaskMatch) {
        const baseSlug = baseTaskMatch[1].toLowerCase();
        const baseMissionDir = missionDirForSlug(rootDir, baseSlug);
        if (fs.existsSync(baseMissionDir)) {
            return baseMissionDir;
        }
    }
    const legacyBaseDir = node_path_1.default.join(rootDir, 'docs', 'missions');
    if (!missionUsesYearTier(rootDir) && !fs.existsSync(node_path_1.default.join(rootDir, 'workflow.config.json')) && fs.existsSync(legacyBaseDir)) {
        const year = getMissionYear(slug, rootDir);
        const legacyMissionDir = node_path_1.default.join(legacyBaseDir, year, slug);
        if (fs.existsSync(legacyMissionDir)) {
            return legacyMissionDir;
        }
        if (baseTaskMatch) {
            const legacyBaseMissionDir = node_path_1.default.join(legacyBaseDir, year, baseTaskMatch[1].toLowerCase());
            if (fs.existsSync(legacyBaseMissionDir)) {
                return legacyBaseMissionDir;
            }
        }
    }
    return null;
}
/**
 * Infer mission slug from current context:
 * 1. Explicit slugCandidate (task-NNN)
 * 2. Current branch (mission/slug)
 * 3. Current directory name (mission-task-slug)
 * 4. Registered worktree branch for current directory
 *
 * @param {string} [slugCandidate]
 * @returns {string|null}
 */
/** @param {string} [slugCandidate] */
function inferSlug(slugCandidate) {
    if (slugCandidate && isMissionSlugCandidate(slugCandidate)) {
        return slugCandidate.toLowerCase();
    }
    // 1. Check branch
    try {
        const branch = gitModule.getCurrentBranch();
        const fromBranch = extractSlugFromBranch(branch);
        if (fromBranch) {
            return fromBranch;
        }
    }
    catch (_) {
        // ignore
    }
    // 3. Check directory name
    const cwd = process.cwd();
    const dirName = node_path_1.default.basename(cwd);
    const dirSlugMatch = dirName.match(/((?:task|adhoc)-[a-z0-9][a-z0-9-]*)$/i);
    if (dirSlugMatch) {
        return dirSlugMatch[1].toLowerCase();
    }
    // 3. Check worktree registry
    try {
        const lines = gitModule.git(['worktree', 'list', '--porcelain']).stdout.split('\n');
        let currentPath = null;
        for (const line of lines) {
            if (line.startsWith('worktree ')) {
                currentPath = line.slice('worktree '.length).trim();
            }
            else if (line.startsWith('branch ') && currentPath === cwd) {
                const branch = line.slice('branch '.length).trim();
                const shortBranch = branch.replace(/^refs\/heads\//, '');
                const fromBranch = extractSlugFromBranch(shortBranch, cwd);
                if (fromBranch) {
                    return fromBranch;
                }
            }
            else if (line === '') {
                currentPath = null;
            }
        }
    }
    catch (_) {
        // ignore
    }
    return null;
}
/** @param {string} missionDir */
function findCheckpoints(missionDir) {
    const files = fs.readdirSync(missionDir);
    return files
        .filter(f => /^(CHECKPOINT_|CP-\d+).*\.md$/i.test(f))
        .sort(compareCheckpointFiles)
        .map(f => node_path_1.default.join(missionDir, f));
}
/** @param {string} a @param {string} b */
function compareCheckpointFiles(a, b) {
    const aOrder = checkpointOrder(a);
    const bOrder = checkpointOrder(b);
    if (aOrder !== bOrder) {
        return aOrder - bOrder;
    }
    return a.localeCompare(b);
}
/** @param {string} filename */
function checkpointOrder(filename) {
    const numericMatch = filename.match(/(?:CP-|CHECKPOINT_)(\d+)/i);
    if (numericMatch) {
        return Number(numericMatch[1]);
    }
    return Number.MAX_SAFE_INTEGER;
}
/** @param {string} filePath */
function getFirstLine(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n')[0].replace(/^#+\s*/, '').trim();
}
/** @param {string} [slug] */
function missionTitle(slug) {
    if (!slug) {
        return null;
    }
    const missionDir = findMissionDir(slug);
    if (!missionDir) {
        return null;
    }
    const missionPath = node_path_1.default.join(missionDir, 'MISSION.md');
    if (!fs.existsSync(missionPath)) {
        return null;
    }
    const firstLine = fs.readFileSync(missionPath, 'utf8').split('\n')[0] || '';
    return firstLine.replace(/^#\s*Mission:\s*/i, '').trim() || null;
}
exports.SUPPORTED_VERIFY_AREAS = new Set(['docs', 'workflow', 'web', 'server', 'auth', 'android', 'k8s', 'deps', 'all']);
/** @param {string} [area] */
function normalizeVerifyArea(area) {
    if (!area) {
        return 'docs';
    }
    if (area === 'auth-server') {
        return 'auth';
    }
    return exports.SUPPORTED_VERIFY_AREAS.has(area) ? area : area;
}
/** @param {string} content */
function detectMissionAreaFromContent(content) {
    const gateMatch = content.match(/(?:^|\s)(?:\.{1,2}\/[\w.\/-]+\.(?:sh|bash|py|rb)|\.{1,2}\/[a-z][\w-]*)\s+([a-zA-Z0-9_-]+)\s*(?:$|\n)/m);
    return normalizeVerifyArea(gateMatch ? gateMatch[1] : 'docs');
}
function findMissionArea(missionDir) {
    const missionPath = node_path_1.default.join(missionDir, 'MISSION.md');
    if (!fs.existsSync(missionPath)) {
        return 'docs';
    }
    const content = fs.readFileSync(missionPath, 'utf8');
    return detectMissionAreaFromContent(content);
}
