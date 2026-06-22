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

'use strict';

// agents/
module.exports.agents = require('./agents/agents');
module.exports.claude = require('./agents/claude');
module.exports.claudeTelemetry = require('./agents/claude-telemetry');
module.exports.codex = require('./agents/codex');
module.exports.codexTelemetry = require('./agents/codex-telemetry');
module.exports.limitHit = require('./agents/limit-hit');
module.exports.mistral = require('./agents/mistral');
module.exports.opencode = require('./agents/opencode');

// commands/
module.exports.active = require('./commands/active');
module.exports.checkpoint = require('./commands/checkpoint');
module.exports.config = require('./commands/config');
module.exports.coverageGate = require('./commands/coverage-gate');
module.exports.diff = require('./commands/diff');
module.exports.draft = require('./commands/draft');
module.exports.handoff = require('./commands/handoff');
module.exports.integrate = require('./commands/integrate');
module.exports.missionStart = require('./commands/mission-start');
module.exports.rebase = require('./commands/rebase');
module.exports.repairHandoff = require('./commands/repair-handoff');
module.exports.resolveConflict = require('./commands/resolve-conflict');
module.exports.setup = require('./commands/setup');
module.exports.stats = require('./commands/stats');
module.exports.statsBackfill = require('./commands/stats-backfill');
module.exports.status = require('./commands/status');
module.exports.verify = require('./commands/verify');

// core/
module.exports.fmt = require('./core/fmt');
module.exports.git = require('./core/git');
module.exports.gitignore = require('./core/gitignore');
module.exports.missionUtils = require('./core/mission-utils');
module.exports.persistentDataMigration = require('./core/persistent-data-migration');
module.exports.productConfig = require('./core/product-config');
module.exports.runtimeMatrix = require('./core/runtime-matrix');
module.exports.spawnTee = require('./core/spawn-tee');
module.exports.stateMap = require('./core/state-map');
module.exports.storage = require('./core/storage');
module.exports.verification = require('./core/verification');

// review/
module.exports.review = require('./review/review');
module.exports.reviewArtifacts = require('./review/review-artifacts');
module.exports.reviewCommands = require('./review/review-commands');
module.exports.reviewEvents = require('./review/review-events');
module.exports.reviewLoop = require('./review/review-loop');
module.exports.reviewPolling = require('./review/review-polling');
module.exports.reviewPrompts = require('./review/review-prompts');
module.exports.reviewState = require('./review/review-state');

// tools/
module.exports.backlog = require('./tools/backlog');
module.exports.forgejo = require('./tools/forgejo');
module.exports.gatekeeper = require('./tools/gatekeeper');
module.exports.setupReview = require('./tools/setup-review');
module.exports.sessions = require('./tools/sessions');
