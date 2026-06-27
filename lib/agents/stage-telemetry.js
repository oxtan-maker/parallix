'use strict';

// Shared resolution of the most faithful telemetry for a recorded workflow
// stage (execute/review). Codex's authoritative usage is the windowed sum read
// from its on-disk rollout — `sinceMs` bounds the read to just this stage — so
// prefer it when present. For non-Codex agents (e.g. Claude, whose usage the
// launcher parses from stdout via claude-telemetry.js) no codex rollout exists
// and extractCodexTelemetry returns null *without throwing*, so we fall back to
// the telemetry the launcher already attached.
//
// This lives in one place so the execute hook (commands/active.js) and the
// review-loop hook (review/review-loop.js) cannot drift apart — the bug this
// fixes was active.js computing `sinceMs` and then discarding it, recording
// cumulative Codex usage for the execute phase instead of the windowed delta
// (task-1285 review F1/F6).

const { codexHomeRoot, extractCodexTelemetry } = require('./codex');

/**
 * @param {object} opts
 * @param {string} opts.worktree - worktree root used to locate the codex home.
 * @param {object} opts.result - launcher result; `result.telemetry` is the
 *   launcher-attached fallback and `result.startedAt` bounds the codex window.
 * @param {number} [opts.sinceMs] - epoch ms marking the start of this stage.
 * @returns {object|null} normalized telemetry, or null when none is available.
 */
function resolveStageTelemetry({ worktree, result, sinceMs = 0 } = {}) {
  if (!result || !result.telemetry) {return null;}
  try {
    const codexT = extractCodexTelemetry(codexHomeRoot(worktree), { sinceMs: sinceMs || 0 });
    // Guard against stale Codex rollouts bleeding into non-Codex stages:
    // if the launcher attached telemetry with a provider that differs from
    // what Codex would produce (e.g. anthropic vs openai), discard the Codex
    // read and use the launcher-attached telemetry instead.
    if (codexT && codexT.provider && result.telemetry.provider
        && codexT.provider.toLowerCase() !== result.telemetry.provider.toLowerCase()) {
      return result.telemetry;
    }
    return codexT || result.telemetry;
  } catch (_) {
    // Codex rollout unreadable: fall back to this stage's launcher telemetry.
    return result.telemetry;
  }
}

module.exports = { resolveStageTelemetry };
