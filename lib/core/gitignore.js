"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKFLOW_ENTRIES = void 0;
exports.ensureWorkflowGitignore = ensureWorkflowGitignore;
exports.ensureWorkflowGitignoreFn = ensureWorkflowGitignore;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const WORKFLOW_ENTRIES = [
    '.workflow/',
    '.sessions/',
    '.forgejo-local/',
    'workflow/.cache/',
    'workflow/.sessions/',
    'workflow/config/agents.local.json',
    'agents.local.json',
];
exports.WORKFLOW_ENTRIES = WORKFLOW_ENTRIES;
function ensureWorkflowGitignore(rootDir, options = {}) {
    const { existsSyncFn = node_fs_1.default.existsSync, lstatSyncFn = node_fs_1.default.lstatSync, readFileSyncFn = node_fs_1.default.readFileSync, writeFileSyncFn = node_fs_1.default.writeFileSync, logFn = () => { }, } = options;
    const gitignorePath = node_path_1.default.join(rootDir, '.gitignore');
    const gitDirPath = node_path_1.default.join(rootDir, '.git');
    if (!existsSyncFn(gitDirPath)) {
        logFn(`[gitignore] Skipping ${rootDir}: not a git repository (no .git directory)`);
        return { ok: true, created: false, appended: 0, skipped: true, reason: 'not-a-git-repo' };
    }
    if (!existsSyncFn(gitignorePath)) {
        const content = [...WORKFLOW_ENTRIES].join('\n') + '\n';
        writeFileSyncFn(gitignorePath, content, 'utf8');
        logFn(`[gitignore] Created ${gitignorePath} with ${WORKFLOW_ENTRIES.length} entries`);
        return { ok: true, created: true, appended: WORKFLOW_ENTRIES.length, skipped: false };
    }
    try {
        const stat = lstatSyncFn(gitignorePath);
        if (stat.isSymbolicLink()) {
            logFn(`[gitignore] Skipping ${gitignorePath}: symbolic link, not modifying`);
            return { ok: true, created: false, appended: 0, skipped: true, reason: 'symlink' };
        }
    }
    catch (_err) {
        // If we can't stat, fall through to read
    }
    let existingContent;
    try {
        existingContent = readFileSyncFn(gitignorePath, 'utf8');
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logFn(`[gitignore] Could not read ${gitignorePath}: ${message}`);
        return { ok: false, created: false, appended: 0, skipped: false, reason: `read-error: ${message}` };
    }
    const existingLines = existingContent.split(/\r?\n/);
    const existingEntries = new Set(existingLines
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#')));
    const missingEntries = WORKFLOW_ENTRIES.filter(entry => !existingEntries.has(entry));
    if (missingEntries.length === 0) {
        logFn(`[gitignore] ${gitignorePath} already contains all ${WORKFLOW_ENTRIES.length} workflow entries`);
        return { ok: true, created: false, appended: 0, skipped: false };
    }
    const newContent = existingContent + '\n' + [...missingEntries].join('\n') + '\n';
    writeFileSyncFn(gitignorePath, newContent, 'utf8');
    logFn(`[gitignore] Appended ${missingEntries.length} missing entries to ${gitignorePath}`);
    return { ok: true, created: false, appended: missingEntries.length, skipped: false };
}
ensureWorkflowGitignore.WORKFLOW_ENTRIES = WORKFLOW_ENTRIES;
ensureWorkflowGitignore.ensureWorkflowGitignore = ensureWorkflowGitignore;
exports.default = ensureWorkflowGitignore;
if (typeof module !== 'undefined') {
    module.exports = ensureWorkflowGitignore;
}
