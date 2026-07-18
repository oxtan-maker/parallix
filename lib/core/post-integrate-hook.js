"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePostIntegrateCommand = resolvePostIntegrateCommand;
exports.buildPostIntegrateHookEnv = buildPostIntegrateHookEnv;
exports.runPostIntegrateHook = runPostIntegrateHook;
const node_child_process_1 = __importDefault(require("node:child_process"));
const product_config_js_1 = require("./product-config.js");
function resolvePostIntegrateCommand(rootDir = process.cwd()) {
    const config = (0, product_config_js_1.loadAdapterConfig)(rootDir);
    const integrateAdapter = config.integrate || {};
    const command = typeof integrateAdapter.postIntegrateCommand === 'string' && integrateAdapter.postIntegrateCommand.trim()
        ? integrateAdapter.postIntegrateCommand.trim()
        : null;
    return command;
}
function buildPostIntegrateHookEnv(params) {
    return {
        ...(params.processEnv || process.env),
        INTEGRATE_HOOK_SLUG: params.slug,
        INTEGRATE_HOOK_BASE_WORKTREE: params.baseWorktree,
        INTEGRATE_HOOK_BASE_BRANCH: params.baseBranch,
        INTEGRATE_HOOK_VARIANT: params.variant,
    };
}
// Runs at most once per call site. Callers are responsible for invoking this
// exactly once per successful integrate path (Variant B and the resumed-from-
// existing-squash-commit path each call it from their own single success seam,
// so no shared invocation counter is needed).
function runPostIntegrateHook(params) {
    const resolveCommandFn = params.resolveCommandFn || resolvePostIntegrateCommand;
    const command = resolveCommandFn(params.baseWorktree);
    if (!command) {
        return { ran: false, ok: true };
    }
    const runFn = params.runFn || ((cmd, args, options) => node_child_process_1.default.spawnSync(cmd, args, options));
    const env = buildPostIntegrateHookEnv(params);
    const result = runFn('bash', ['-lc', command], {
        cwd: params.baseWorktree,
        env,
        encoding: 'utf8'
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const exitCode = result.status;
    return { ran: true, ok: exitCode === 0, command, output, exitCode };
}
