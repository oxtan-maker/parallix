import fs from 'node:fs';
import path from 'node:path';
import * as storage from '../storage/storage.js';
import { runtimeAssetStore } from '../assets/runtime-assets.js';
import { CONFIG_PATH } from './agent-config.js';
import { workflowLauncherStatus, WORKFLOW_AGENT_NAMES } from './launcher-selection.js';

// Steps whose `eligible` arrays the first-run write filters. Kept explicit so a
// new workflow step must opt in rather than silently skip availability filtering.
const CONFIG_STEPS = Object.freeze(['draft', 'active', 'review']);

export interface FirstRunAgentConfigResult {
  /** True when a new working-tree config was written; false when one existed. */
  written: boolean;
  /** Absolute path of the working-tree config file. */
  configPath: string;
  /** Filtered eligible families per step, for diagnostics/tests. */
  eligibleByStep: { [step: string]: string[] };
  /** True when the write was skipped because no family probed available. */
  emptyDetection?: boolean;
}

export interface FirstRunAgentConfigOptions {
  rootDir?: string;
  /** Worktree passed to `workflowLauncherStatus` so `custom` resolves its runner. */
  worktree?: string;
  /**
   * Regenerate an existing working-tree config instead of leaving it. Only the
   * explicit `px config --write` path sets this; the implicit first-run hook
   * never does, so the implicit hook stays idempotent (user edits win).
   */
  force?: boolean;
}

/**
 * The shipped default is the full family list (ADR 0044). Filtering lives only
 * in the working-tree copy, so published builds keep advertising every family
 * to configured users. Read the bundled default directly rather than through
 * `readAgentConfig`, whose working-tree branch would read the very file we are
 * about to write.
 */
function bundledDefault(): { [key: string]: any } {
  const raw = runtimeAssetStore.readText(CONFIG_PATH);
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : { steps: {} };
}

/** Probe availability once per family, grouped by step (all steps share one probe). */
function filterEligible(worktree: string | undefined): { [step: string]: string[] } {
  const byStep: { [step: string]: string[] } = {};
  const available = WORKFLOW_AGENT_NAMES.filter((agent) => {
    try {
      return workflowLauncherStatus(agent, worktree).supported;
    } catch {
      // A probe that throws (unknown family, spawn failure) drops the family
      // rather than aborting the whole first-run write.
      return false;
    }
  });
  for (const step of CONFIG_STEPS) {
    byStep[step] = available.slice();
  }
  return byStep;
}

function buildFilteredConfig(eligibleByStep: { [step: string]: string[] }): { [key: string]: any } {
  const base = bundledDefault();
  const steps = base.steps && typeof base.steps === 'object' ? base.steps : {};
  const out: { [key: string]: any } = {};
  // Preserve every non-step key: `_comment`, `_weights_comment`, `overrides`.
  for (const [key, value] of Object.entries(base)) {
    if (key !== 'steps') { out[key] = value; }
  }
  out.steps = {};
  for (const step of CONFIG_STEPS) {
    const existing = steps[step] && typeof steps[step] === 'object' ? steps[step] : {};
    out.steps[step] = { ...existing, eligible: eligibleByStep[step] || [] };
  }
  return out;
}

/**
 * First-run agent-config autodetection. Writes a working-tree `config/agents.json`
 * whose `steps.*.eligible` lists only families whose launcher is available on
 * the host, then returns. Idempotent: once the working-tree file exists, every
 * subsequent call leaves it byte-for-byte untouched (user edits win).
 */
export function ensureFirstRunAgentConfig(options: FirstRunAgentConfigOptions = {}): FirstRunAgentConfigResult {
  const rootDir = options.rootDir ?? process.cwd();
  const worktree = options.worktree;
  const configPath = path.join(rootDir, CONFIG_PATH);
  const exists = fs.existsSync(configPath);

  const eligibleByStep = filterEligible(worktree);
  const anyAvailable = CONFIG_STEPS.some((step) => (eligibleByStep[step] || []).length > 0);

  // Idempotent implicit hook: never touch a pre-existing working-tree config.
  if (exists && !options.force) {
    return { written: false, configPath, eligibleByStep };
  }

  // Never persist a fully-empty detection. A host where every launcher probe
  // fails must not pin an empty eligible list that permanently bricks
  // selectAgent and defeats the WORKFLOW_AGENT escape hatch. Skip the write and
  // fall through to the shipped default (the pre-mission default-to-all).
  // ponytail: single anyAvailable scan over CONFIG_STEPS is O(steps); fine here.
  if (!anyAvailable) {
    return { written: false, configPath, eligibleByStep, emptyDetection: true };
  }

  const filtered = buildFilteredConfig(eligibleByStep);

  // Route through storage.writeJson (atomic mkdir + write) so the write lives in
  // the excluded storage boundary rather than raw fs tokens in this file.
  storage.writeJson(configPath, filtered);

  return { written: true, configPath, eligibleByStep };
}

/** Test/CLI alias: an explicit "write the autodetected config" entry point. */
export const writeAutodetectedAgentConfig = ensureFirstRunAgentConfig;
