"use strict";
/**
 * Barrel re-export for parallix/lib/.
 *
 * Re-exports all grouped modules under named properties (e.g.
 * `require('../lib').commands.setup`). This file does NOT restore
 * flat subpath imports (e.g. `require('../lib/setup')`) — those
 * entrypoints were removed during the restructure and any remaining
 * consumers should be updated to use the new grouped paths.
 *
 * Directory layout:
 *   agents/   — AI agent launchers and session management
 *   commands/ — Workflow command handlers (dispatcher entry points)
 *   core/     — Shared infrastructure (no command-handler imports)
 *   review/   — Review subsystem (artifacts, commands, loop, polling, prompts, state)
 *   tools/    — External integrations and supporting workflow libraries
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessions = exports.setupReview = exports.gatekeeper = exports.forgejo = exports.backlog = exports.reviewState = exports.reviewPrompts = exports.reviewPolling = exports.reviewLoop = exports.reviewEvents = exports.reviewCommands = exports.reviewArtifacts = exports.review = exports.verification = exports.storage = exports.stateMap = exports.spawnTee = exports.runtimeMatrix = exports.productConfig = exports.persistentDataMigration = exports.missionUtils = exports.gitignore = exports.git = exports.fmt = exports.verify = exports.status = exports.statsBackfill = exports.stats = exports.setup = exports.resolveConflict = exports.repairHandoff = exports.rebase = exports.missionStart = exports.integrate = exports.handoff = exports.draft = exports.diff = exports.coverageGate = exports.config = exports.checkpoint = exports.active = exports.opencode = exports.vibe = exports.limitHit = exports.codexTelemetry = exports.codex = exports.claudeTelemetry = exports.claude = exports.agents = void 0;
// agents/ — all use named exports
const agentsMod = __importStar(require("./agents/agents.js"));
const claudeMod = __importStar(require("./agents/claude.js"));
const claudeTelemetryMod = __importStar(require("./agents/claude-telemetry.js"));
const codexMod = __importStar(require("./agents/codex.js"));
const codexTelemetryMod = __importStar(require("./agents/codex-telemetry.js"));
const limitHitMod = __importStar(require("./agents/limit-hit.js"));
const vibeMod = __importStar(require("./agents/vibe.js"));
const opencodeMod = __importStar(require("./agents/opencode.js"));
// commands/ — mixed export styles
const active_js_1 = __importDefault(require("./commands/active.js"));
exports.active = active_js_1.default;
const checkpoint_js_1 = __importDefault(require("./commands/checkpoint.js"));
exports.checkpoint = checkpoint_js_1.default;
const config_js_1 = __importDefault(require("./commands/config.js"));
exports.config = config_js_1.default;
const coverage_gate_js_1 = __importDefault(require("./commands/coverage-gate.js"));
exports.coverageGate = coverage_gate_js_1.default;
const diff_js_1 = __importDefault(require("./commands/diff.js"));
exports.diff = diff_js_1.default;
const draft_js_1 = __importDefault(require("./commands/draft.js"));
exports.draft = draft_js_1.default;
const handoff_js_1 = __importDefault(require("./commands/handoff.js"));
exports.handoff = handoff_js_1.default;
const integrate_js_1 = __importDefault(require("./commands/integrate.js"));
exports.integrate = integrate_js_1.default;
const mission_start_js_1 = __importDefault(require("./commands/mission-start.js"));
exports.missionStart = mission_start_js_1.default;
const rebase_js_1 = __importDefault(require("./commands/rebase.js"));
exports.rebase = rebase_js_1.default;
const repair_handoff_js_1 = __importDefault(require("./commands/repair-handoff.js"));
exports.repairHandoff = repair_handoff_js_1.default;
const resolve_conflict_js_1 = __importDefault(require("./commands/resolve-conflict.js"));
exports.resolveConflict = resolve_conflict_js_1.default;
const setup_js_1 = __importDefault(require("./commands/setup.js"));
exports.setup = setup_js_1.default;
const stats_js_1 = __importDefault(require("./commands/stats.js"));
exports.stats = stats_js_1.default;
const stats_backfill_js_1 = __importDefault(require("./commands/stats-backfill.js"));
exports.statsBackfill = stats_backfill_js_1.default;
const status_js_1 = __importDefault(require("./commands/status.js"));
exports.status = status_js_1.default;
const verify_js_1 = __importDefault(require("./commands/verify.js"));
exports.verify = verify_js_1.default;
// core/ — mixed export styles
const fmtMod = __importStar(require("./core/fmt.js"));
exports.fmt = fmtMod;
const gitMod = __importStar(require("./core/git.js"));
const gitignore_js_1 = __importDefault(require("./core/gitignore.js"));
exports.gitignore = gitignore_js_1.default;
const missionUtilsMod = __importStar(require("./core/mission-utils.js"));
const persistentDataMigrationMod = __importStar(require("./core/persistent-data-migration.js"));
const productConfigMod = __importStar(require("./core/product-config.js"));
const runtimeMatrixMod = __importStar(require("./core/runtime-matrix.js"));
const spawnTeeMod = __importStar(require("./core/spawn-tee.js"));
const stateMapMod = __importStar(require("./core/state-map.js"));
const storageMod = __importStar(require("./core/storage.js"));
const verificationMod = __importStar(require("./core/verification.js"));
// review/ — mixed export styles
const review_js_1 = __importDefault(require("./review/review.js"));
exports.review = review_js_1.default;
const reviewArtifactsMod = __importStar(require("./review/review-artifacts.js"));
const reviewCommandsMod = __importStar(require("./review/review-commands.js"));
const reviewEventsMod = __importStar(require("./review/review-events.js"));
const reviewLoopMod = __importStar(require("./review/review-loop.js"));
const reviewPollingMod = __importStar(require("./review/review-polling.js"));
const reviewPromptsMod = __importStar(require("./review/review-prompts.js"));
const reviewStateMod = __importStar(require("./review/review-state.js"));
// tools/ — all use named exports
const backlogMod = __importStar(require("./tools/backlog.js"));
const forgejoMod = __importStar(require("./tools/forgejo.js"));
const gatekeeperMod = __importStar(require("./tools/gatekeeper.js"));
const setupReviewMod = __importStar(require("./tools/setup-review.js"));
const sessionsMod = __importStar(require("./tools/sessions.js"));
// agents/
exports.agents = agentsMod;
exports.claude = claudeMod;
exports.claudeTelemetry = claudeTelemetryMod;
exports.codex = codexMod;
exports.codexTelemetry = codexTelemetryMod;
exports.limitHit = limitHitMod;
exports.vibe = vibeMod;
exports.opencode = opencodeMod;
exports.git = gitMod;
exports.missionUtils = missionUtilsMod;
exports.persistentDataMigration = persistentDataMigrationMod;
exports.productConfig = productConfigMod;
exports.runtimeMatrix = runtimeMatrixMod;
exports.spawnTee = spawnTeeMod;
exports.stateMap = stateMapMod;
exports.storage = storageMod;
exports.verification = verificationMod;
exports.reviewArtifacts = reviewArtifactsMod;
exports.reviewCommands = reviewCommandsMod;
exports.reviewEvents = reviewEventsMod;
exports.reviewLoop = reviewLoopMod;
exports.reviewPolling = reviewPollingMod;
exports.reviewPrompts = reviewPromptsMod;
exports.reviewState = reviewStateMod;
// tools/
exports.backlog = backlogMod;
exports.forgejo = forgejoMod;
exports.gatekeeper = gatekeeperMod;
exports.setupReview = setupReviewMod;
exports.sessions = sessionsMod;
