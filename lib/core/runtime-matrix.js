"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.launcherStatus = launcherStatus;
exports.buildAutonomousReviewMatrix = buildAutonomousReviewMatrix;
exports.formatMatrixSummary = formatMatrixSummary;
exports.runnableDifferentFamilyExists = runnableDifferentFamilyExists;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const agents_js_1 = require("../agents/agents.js");
const package_root_js_1 = require("./package-root.js");
const CONFIG_PATH = node_path_1.default.join((0, package_root_js_1.packageRoot)(__dirname), 'config', 'agents.json');
function launcherStatus(agent, options = {}) {
    const { workflowLauncherStatusFn = agents_js_1.workflowLauncherStatus } = options;
    return workflowLauncherStatusFn(agent);
}
function buildAutonomousReviewMatrix(options = {}) {
    const { step = 'review', eligibleAgentsForStepFn = agents_js_1.eligibleAgentsForStep, workflowLauncherStatusFn = agents_js_1.workflowLauncherStatus, configPath = CONFIG_PATH, existsSyncFn = node_fs_1.default.existsSync } = options;
    const agents = eligibleAgentsForStepFn(step);
    const launchers = Object.fromEntries(agents.map((agent) => [agent, workflowLauncherStatusFn(agent)]));
    return {
        step,
        agents,
        configPath,
        configPresent: existsSyncFn(configPath),
        launchers
    };
}
function formatMatrixSummary(matrix) {
    const lines = [];
    lines.push(`Agent eligibility config: ${matrix.configPresent ? 'present' : 'missing'} (${matrix.configPath})`);
    lines.push(`Launcher support matrix (step: ${matrix.step}):`);
    for (const agent of matrix.agents) {
        const launcher = matrix.launchers[agent];
        const status = launcher.supported ? 'supported' : 'blocked';
        const health = launcher.health ? `, ${launcher.health}` : '';
        const reason = launcher.reason ? `; ${launcher.reason}` : '';
        lines.push(`  - ${agent}: ${status} (${launcher.detail}${health}${reason})`);
    }
    lines.push('Reviewer is chosen at runtime from the eligible-and-supported pool, ' +
        'excluding the implementer (config-driven via agents.json; no hardcoded routing).');
    return lines;
}
function runnableDifferentFamilyExists(implementer, options = {}) {
    const { step = 'review', eligibleAgentsForStepFn = agents_js_1.eligibleAgentsForStep, workflowLauncherStatusFn = agents_js_1.workflowLauncherStatus } = options;
    const agents = eligibleAgentsForStepFn(step);
    return agents.some((a) => a !== implementer && workflowLauncherStatusFn(a).supported);
}
