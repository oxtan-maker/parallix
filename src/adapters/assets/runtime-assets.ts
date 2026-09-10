import fs from 'node:fs';
import { FilesystemAssetStore, type AssetStore } from './asset-store.js';
import { packageRoot } from '../filesystem/package-root.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Package-owned runtime assets are addressed by logical keys at their callers.
 * The filesystem adapter is intentionally confined here so the canonical bundle
 * and the bundled executable share one asset boundary.
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const runtimeAssetStore: AssetStore = new FilesystemAssetStore(packageRoot(MODULE_DIR));

/** The wired stage prompts whose core half is always assembled in. */
export type PromptStage = 'draft' | 'execute' | 'review' | 'act-on-review' | 'portfolio';

/**
 * Assemble a stage prompt from the mandatory Parallix core file plus either the
 * shipped default-opinion file or one repo-local override selected by the single
 * `adapters.prompts.override` configuration key (resolved by the config package).
 *
 * Shape is load-two-files-and-concatenate: the core half is always assembled in
 * and cannot be dropped by an override, so no core instruction is removable. No
 * templating, registry, resolver hierarchy, plugin interface, factory, or new
 * dependency (mission-2465 guardrail 4).
 *
 * @param stage Stage slug selecting the `prompts/<stage>-core.md` /
 *   `prompts/<stage>.md` pair.
 * @param overridePath Absolute path to a repo-local opinion half, or null for
 *   the shipped default. An unset/absent path keeps today's prompts byte for
 *   byte.
 */
export function assembleStagePrompt(stage: PromptStage, { overridePath, assets = runtimeAssetStore }: { overridePath?: string | null; assets?: AssetStore } = {}): string {
  const core = assets.readText(`prompts/${stage}-core.md`);
  const opinion = overridePath
    ? readOverride(stage, overridePath)
    : assets.readText(`prompts/${stage}.md`);
  // Strip the file-naming heading from the core before assembly so a no-override
  // launch reproduces the pre-split prompt byte-for-byte (one added heading per
  // file is required for the split but is not part of the original prompt).
  const coreBody = core.startsWith('#') ? core.slice(core.indexOf('\n') + 1) : core;
  if (!opinion) {return coreBody;}
  // Join with exactly one blank line: strip trailing blanks from the core and
  // leading blanks from the opinion so a boundary cut at a section separator
  // reproduces the pre-split prompt's single separating blank line.
  return `${coreBody.replace(/\n+$/, '')}\n\n${opinion.replace(/^\n+/, '')}`;
}

/**
 * Read a repo-local opinion override. A configured override path that points at
 * a missing file is a configuration error, not a silent no-op: surface it so the
 * operator's override is never dropped without notice (F4).
 */
function readOverride(stage: PromptStage, overridePath: string): string {
  if (!fs.existsSync(overridePath)) {
    throw new Error(`prompt override for "${stage}" is configured but the file is missing: ${overridePath}`);
  }
  return fs.readFileSync(overridePath, 'utf8');
}

export const RUNTIME_ASSET_KEYS = [
  'config/agents.json',
  'config/state-map.json',
  'prompts/act-on-review-core.md',
  'prompts/act-on-review.md',
  'prompts/draft-core.md',
  'prompts/draft.md',
  'prompts/execute-core.md',
  'prompts/execute.md',
  'prompts/review-core.md',
  'prompts/review.md',
  'templates/mission-scaffold.md',
] as const;
