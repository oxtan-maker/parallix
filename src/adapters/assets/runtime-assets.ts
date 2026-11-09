import fs from 'node:fs';
import { renderPromptContextPolicy } from '../../application/prompt-context-policy.js';
import type { PromptConfiguration } from '../../application/ports/configuration.js';
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
let packagedStore: AssetStore | undefined;
function packagedAssets(): AssetStore {
  return packagedStore ??= new FilesystemAssetStore(packageRoot(MODULE_DIR));
}

// Importing a bootstrap must not require a package tree. Resolve it only when
// a caller actually reads an asset (including bundled isolated runner fixtures).
export const runtimeAssetStore: AssetStore = {
  readText: key => packagedAssets().readText(key),
  readBytes: key => packagedAssets().readBytes(key),
  has: key => packagedAssets().has(key),
};

/** The wired stage prompts whose core half is always assembled in. */
export type PromptStage = 'draft' | 'execute' | 'review' | 'act-on-review' | 'portfolio';

/**
 * Assemble a stage prompt from the mandatory Parallix core file plus either the
 * shipped default-opinion file or a repo-local override resolved by the config
 * package. The legacy `adapters.prompts.override` applies to every stage;
 * `adapters.prompts.reviewOverride` applies only to review and takes precedence
 * there so repository review policy cannot displace other stage opinions.
 *
 * Shape is load-two-files-and-concatenate: the core half is always assembled in
 * and cannot be dropped by an override, so no core instruction is removable.
 * A non-empty review default-opinion half is retained before a distinct local
 * override. The distributed review opinion is intentionally empty; a repository
 * opts into its own review policy through the same override boundary. No
 * registry, resolver hierarchy, plugin interface, factory, or new dependency.
 * Context actions in the core are rendered from the typed repository policy;
 * opinion content cannot remove those obligations.
 *
 * @param stage Stage slug selecting the `prompts/<stage>-core.md` /
 *   `prompts/<stage>.md` pair.
 * @param overridePath Absolute path to the legacy all-stage opinion half, or
 *   null for the shipped default.
 * @param reviewOverridePath Absolute path to a review-only opinion half. It is
 *   ignored for every other stage and takes precedence over overridePath for
 *   review.
 */
export function assembleStagePrompt(stage: PromptStage, { overridePath, reviewOverridePath, contextCompaction = true, assets = runtimeAssetStore }: Partial<PromptConfiguration> & { assets?: AssetStore } = {}): string {
  const core = assets.readText(`prompts/${stage}-core.md`);
  const defaultOpinion = assets.readText(`prompts/${stage}.md`);
  const effectiveOverridePath = stage === 'review' ? reviewOverridePath || overridePath : overridePath;
  const overrideOpinion = effectiveOverridePath ? readOverride(stage, effectiveOverridePath) : null;
  const opinion = overrideOpinion !== null
    ? stage === 'review' && defaultOpinion.trim() && defaultOpinion !== overrideOpinion
      ? `${defaultOpinion.replace(/\n+$/, '')}\n\n${overrideOpinion.replace(/^\n+/, '')}`
      : overrideOpinion
    : defaultOpinion;
  // Strip the file-naming heading from the core before assembly so a no-override
  // launch reproduces the pre-split prompt byte-for-byte (one added heading per
  // file is required for the split but is not part of the original prompt).
  const coreBody = renderPromptContextPolicy(core.startsWith('#') ? core.slice(core.indexOf('\n') + 1) : core, contextCompaction);
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
  'prompts/repair.md',
  'templates/mission-scaffold.md',
] as const;
