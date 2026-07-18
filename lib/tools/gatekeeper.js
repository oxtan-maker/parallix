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
exports.DEFAULT_GATEKEEPER_USER = void 0;
exports.checkMandatoryFiles = checkMandatoryFiles;
exports.buildPushbackBody = buildPushbackBody;
exports.runGatekeeper = runGatekeeper;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const fmt = __importStar(require("../core/fmt.js"));
const mission_utils_js_1 = require("../core/mission-utils.js");
const backlog_js_1 = require("./backlog.js");
const forgejo_js_1 = require("./forgejo.js");
const DEFAULT_GATEKEEPER_USER = 'forgejo-gatekeeper';
exports.DEFAULT_GATEKEEPER_USER = DEFAULT_GATEKEEPER_USER;
// Pre-review pushback bot. Runs after performHandoff has created/updated the
// PR and before the human/agent reviewer engages, so missing mandatory
// artifacts surface as a request-changes review instead of consuming a
// reviewer cycle. Returns { ok, missing, skipped, posted } so callers can
// surface a clear log line without needing to re-derive state.
/**
 * @param {string} slug
 * @param {{rootDir?: string, findMissionDirFn?: Function, findCheckpointsFn?: Function, resolveTaskFileFn?: Function}} [options]
 * @returns {{ok: boolean, missing: string[]}}
 */
function checkMandatoryFiles(slug, options = {}) {
    const { rootDir = process.cwd(), findMissionDirFn = mission_utils_js_1.findMissionDir, findCheckpointsFn = mission_utils_js_1.findCheckpoints, resolveTaskFileFn = backlog_js_1.resolveTaskFile } = options;
    const missing = [];
    const expectedMissionDir = (0, mission_utils_js_1.missionDirForSlug)(rootDir, slug);
    const expectedMissionRel = path_1.default.relative(rootDir, expectedMissionDir).split(path_1.default.sep).join('/');
    const missionDir = findMissionDirFn(slug, rootDir);
    const missionPath = missionDir ? path_1.default.join(missionDir, 'MISSION.md') : null;
    if (!missionPath || !fs_1.default.existsSync(missionPath)) {
        missing.push(`${expectedMissionRel}/MISSION.md`);
    }
    if (missionDir) {
        const checkpoints = findCheckpointsFn(missionDir);
        if (!checkpoints || checkpoints.length === 0) {
            missing.push(`${expectedMissionRel}/CP-*.md (at least one checkpoint document)`);
        }
    }
    else {
        missing.push(`${expectedMissionRel}/CP-*.md (at least one checkpoint document)`);
    }
    const taskResolution = resolveTaskFileFn(slug, rootDir);
    const missionArtifactsPresent = Boolean(missionPath && fs_1.default.existsSync(missionPath) && missionDir && findCheckpointsFn(missionDir).length > 0);
    if ((!taskResolution || !taskResolution.ok) && !missionArtifactsPresent) {
        const { tasksDir } = (0, backlog_js_1.getTaskStorage)(rootDir);
        const taskDirRel = path_1.default.relative(rootDir, tasksDir).split(path_1.default.sep).join('/');
        missing.push(`${taskDirRel}/${slug} - *.md`);
    }
    return { ok: missing.length === 0, missing };
}
/**
 * @param {string} slug
 * @param {string[]} missing
 * @returns {string}
 */
function buildPushbackBody(slug, missing) {
    const bullets = missing.map(item => `- ${item}`).join('\n');
    // Detect artifact types and generate creation instructions
    const hasMissionMd = missing.some(item => item.includes('MISSION.md'));
    const hasCheckpoints = missing.some(item => item.includes('CP-'));
    const hasTaskFile = missing.some(item => item.includes('backlog/tasks') || item.includes('backlog/task'));
    const instructions = [];
    if (hasMissionMd) {
        instructions.push('- **create** `MISSION.md` with the standard mission contract template (title, goal, scope, checkpoints, gates).');
    }
    if (hasCheckpoints) {
        instructions.push('- **create** at least one checkpoint document (e.g. `CP-1.md`) with a `## Goal Check` table containing real evidence (file:line, test names).');
    }
    if (hasTaskFile) {
        instructions.push('- **create** a backlog task file at `backlog/tasks/<slug> - <title>.md` with YAML frontmatter (id, title, status, labels) and a description section.');
    }
    const instructionsBlock = instructions.length > 0
        ? ['', '**Suggested artifact-creation steps:**', '', ...instructions, ''].join('\n')
        : '';
    return [
        `**Pre-review gatekeeper: missing mandatory artifacts for \`${slug}\`.**`,
        '',
        'The following files are required before a reviewer engages but were not found on this branch:',
        '',
        bullets,
        instructionsBlock,
        'Push the missing artifacts and re-request review. This comment is automated; once the artifacts are present the gatekeeper will not block again.'
    ].join('\n');
}
/**
 * @param {string} slug
 * @param {{rootDir?: string, branch?: string, user?: string, log?: Function, readTokenFn?: Function, postReviewFn?: Function, checkFn?: Function}} [options]
 * @returns {{ok: boolean, missing: string[], skipped: boolean, posted: boolean}}
 */
function runGatekeeper(slug, options = {}) {
    const { rootDir = process.cwd(), user = process.env.FORGEJO_GATEKEEPER_USER || DEFAULT_GATEKEEPER_USER, log = fmt.log.plain, readTokenFn = forgejo_js_1.readToken, postReviewFn = forgejo_js_1.postReview, checkFn = checkMandatoryFiles } = options;
    const branch = options.branch || (0, mission_utils_js_1.missionBranchName)(slug, rootDir);
    const check = checkFn(slug, { rootDir });
    if (check.ok) {
        log(fmt.status('INFO', `Gatekeeper: all mandatory artifacts present for ${fmt.slug(slug)}.`));
        return { ok: true, missing: [], skipped: false, posted: false };
    }
    const token = readTokenFn(user);
    if (!token) {
        log(fmt.status('WARN', `Gatekeeper: no Forgejo token for "${fmt.agent(user)}"; skipping pushback for ${fmt.slug(slug)}. Missing: ${check.missing.join(', ')}.`));
        return { ok: false, missing: check.missing, skipped: true, posted: false };
    }
    const body = buildPushbackBody(slug, check.missing);
    log(fmt.status('INFO', `Gatekeeper: posting request-changes pushback on ${fmt.branch(branch)} as ${fmt.agent(user)}. Missing: ${check.missing.join(', ')}.`));
    const result = postReviewFn(branch, token, 'request-changes', body);
    if (!result || !result.ok) {
        const detail = result && result.error ? result.error : 'unknown postReview failure';
        log(fmt.status('WARN', `Gatekeeper: pushback post failed for ${fmt.slug(slug)}: ${detail}.`));
        return { ok: false, missing: check.missing, skipped: false, posted: false };
    }
    return { ok: false, missing: check.missing, skipped: false, posted: true };
}
;
