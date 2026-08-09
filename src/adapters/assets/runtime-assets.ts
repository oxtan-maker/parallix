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

export const RUNTIME_ASSET_KEYS = [
  'config/agents.json',
  'config/state-map.json',
  'prompts/act-on-review.md',
  'prompts/draft.md',
  'prompts/execute.md',
  'prompts/review.md',
  'templates/mission-scaffold.md',
] as const;
