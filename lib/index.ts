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

// agents/ — all use named exports
import * as agentsMod from './agents/agents.js';
import * as claudeMod from './agents/claude.js';
import * as claudeTelemetryMod from './agents/claude-telemetry.js';
import * as codexMod from './agents/codex.js';
import * as codexTelemetryMod from './agents/codex-telemetry.js';
import * as limitHitMod from './agents/limit-hit.js';
import * as mistralMod from './agents/mistral.js';
import * as opencodeMod from './agents/opencode.js';

// commands/ — mixed export styles
import active = require('./commands/active.js');
import checkpoint from './commands/checkpoint.js';
import config = require('./commands/config.js');
import coverageGate = require('./commands/coverage-gate.js');
import diff = require('./commands/diff.js');
import draft = require('./commands/draft.js');
import handoff = require('./commands/handoff.js');
import integrate = require('./commands/integrate.js');
import missionStart = require('./commands/mission-start.js');
import rebase = require('./commands/rebase.js');
import repairHandoff = require('./commands/repair-handoff.js');
import resolveConflict = require('./commands/resolve-conflict.js');
import setup = require('./commands/setup.js');
import stats = require('./commands/stats.js');
import statsBackfill = require('./commands/stats-backfill.js');
import status = require('./commands/status.js');
import verify = require('./commands/verify.js');

// core/ — mixed export styles
import * as fmtMod from './core/fmt.js';
import * as gitMod from './core/git.js';
import gitignore = require('./core/gitignore.js');
import * as missionUtilsMod from './core/mission-utils.js';
import * as persistentDataMigrationMod from './core/persistent-data-migration.js';
import * as productConfigMod from './core/product-config.js';
import * as runtimeMatrixMod from './core/runtime-matrix.js';
import * as spawnTeeMod from './core/spawn-tee.js';
import * as stateMapMod from './core/state-map.js';
import * as storageMod from './core/storage.js';
import * as verificationMod from './core/verification.js';

// review/ — mixed export styles
import review = require('./review/review.js');
import * as reviewArtifactsMod from './review/review-artifacts.js';
import * as reviewCommandsMod from './review/review-commands.js';
import * as reviewEventsMod from './review/review-events.js';
import * as reviewLoopMod from './review/review-loop.js';
import * as reviewPollingMod from './review/review-polling.js';
import * as reviewPromptsMod from './review/review-prompts.js';
import * as reviewStateMod from './review/review-state.js';

// tools/ — all use named exports
import * as backlogMod from './tools/backlog.js';
import * as forgejoMod from './tools/forgejo.js';
import * as gatekeeperMod from './tools/gatekeeper.js';
import * as setupReviewMod from './tools/setup-review.js';
import * as sessionsMod from './tools/sessions.js';

// agents/
export const agents = agentsMod;
export const claude = claudeMod;
export const claudeTelemetry = claudeTelemetryMod;
export const codex = codexMod;
export const codexTelemetry = codexTelemetryMod;
export const limitHit = limitHitMod;
export const mistral = mistralMod;
export const opencode = opencodeMod;

// commands/
export { active };
export { checkpoint };
export { config };
export { coverageGate };
export { diff };
export { draft };
export { handoff };
export { integrate };
export { missionStart };
export { rebase };
export { repairHandoff };
export { resolveConflict };
export { setup };
export { stats };
export { statsBackfill };
export { status };
export { verify };

// core/
export { fmtMod as fmt };
export const git = gitMod;
export { gitignore };
export const missionUtils = missionUtilsMod;
export const persistentDataMigration = persistentDataMigrationMod;
export const productConfig = productConfigMod;
export const runtimeMatrix = runtimeMatrixMod;
export const spawnTee = spawnTeeMod;
export const stateMap = stateMapMod;
export const storage = storageMod;
export const verification = verificationMod;

// review/
export { review };
export const reviewArtifacts = reviewArtifactsMod;
export const reviewCommands = reviewCommandsMod;
export const reviewEvents = reviewEventsMod;
export const reviewLoop = reviewLoopMod;
export const reviewPolling = reviewPollingMod;
export const reviewPrompts = reviewPromptsMod;
export const reviewState = reviewStateMod;

// tools/
export const backlog = backlogMod;
export const forgejo = forgejoMod;
export const gatekeeper = gatekeeperMod;
export const setupReview = setupReviewMod;
export const sessions = sessionsMod;
