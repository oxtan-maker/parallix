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
exports.graphifyAvailable = graphifyAvailable;
exports.graphifyCommandCandidates = graphifyCommandCandidates;
exports.probeGraphifyAvailability = probeGraphifyAvailability;
exports.updateGraphifyKnowledgeGraph = updateGraphifyKnowledgeGraph;
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const fmt = __importStar(require("../fmt.js"));
const gitModule = __importStar(require("../git.js"));
/** @param {{commandRunner?: Function}} [options] */
function graphifyAvailable(options = {}) {
    const commandRunner = options.commandRunner ?? null;
    const cmdRunner = commandRunner || gitModule.run;
    return probeGraphifyAvailability({ commandRunner: cmdRunner }).available;
}
/** @returns {string[]} */
function graphifyCommandCandidates() {
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (candidate) => {
        if (!candidate || seen.has(candidate)) {
            return;
        }
        seen.add(candidate);
        candidates.push(candidate);
    };
    if (process.env.GRAPHIFY_BIN) {
        pushCandidate(process.env.GRAPHIFY_BIN);
    }
    pushCandidate('graphify');
    pushCandidate(node_path_1.default.join(node_os_1.default.homedir(), '.local', 'bin', 'graphify'));
    return candidates;
}
/** @param {{commandRunner?: Function}} [options] */
function probeGraphifyAvailability(options = {}) {
    const commandRunner = options.commandRunner ?? null;
    const cmdRunner = commandRunner || gitModule.run;
    for (const command of graphifyCommandCandidates()) {
        try {
            const result = cmdRunner(command, ['--help']);
            return {
                available: result.status !== null && result.status !== undefined,
                command,
                status: result.status ?? null
            };
        }
        catch (error) {
            const e = error;
            if (e && e.code === 'ENOENT') {
                continue;
            }
            return {
                available: false,
                reason: 'probe-failed',
                command,
                error
            };
        }
    }
    return { available: false, reason: 'missing-command' };
}
/**
 * @param {{rootDir?: string, commandRunner?: Function, log?: Function, startMessage?: string, failureHint?: string}} [options]
 */
/** @param {{rootDir?: string, commandRunner?: Function, log?: Function, startMessage?: string, failureHint?: string}} [options] */
function updateGraphifyKnowledgeGraph(options = {}) {
    const rootDir = options.rootDir || process.cwd();
    const commandRunner = options.commandRunner;
    const logFn = options.log || fmt.log.plain;
    const startMessage = options.startMessage || 'Updating graphify knowledge graph...';
    const failureHint = options.failureHint || 'Continuing without blocking workflow.';
    const cmdRunner = commandRunner || gitModule.run;
    const probe = probeGraphifyAvailability({ commandRunner: cmdRunner });
    if (!probe.available) {
        if (probe.reason === 'missing-command') {
            logFn(fmt.status('WARN', 'graphify not found in PATH. Skipping knowledge graph update.'));
            return { updated: false, skipped: true, reason: 'missing-command' };
        }
        const probeError = probe.error && typeof probe.error === 'object' && 'message' in probe.error ? probe.error.message : 'unknown probe failure';
        logFn(fmt.status('WARN', `graphify probe failed (${probeError}). Skipping knowledge graph update.`));
        return { updated: false, skipped: true, reason: 'probe-failed' };
    }
    logFn(fmt.status('INFO', startMessage));
    const result = cmdRunner(probe.command, ['update', '.'], {
        cwd: rootDir,
        stdio: 'inherit'
    });
    if (result.status !== 0) {
        logFn(fmt.status('WARN', `graphify update failed with status ${result.status}. ${failureHint}`));
        return { updated: false, skipped: true, reason: 'update-failed', status: result.status };
    }
    return { updated: true, skipped: false };
}
