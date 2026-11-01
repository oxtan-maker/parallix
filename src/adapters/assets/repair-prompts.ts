import type { RepairPromptReader } from '../../application/ports/repair-prompts.js';
import { runtimeAssetStore } from './runtime-assets.js';
import type { AssetStore } from './asset-store.js';

/** Read a named Markdown section through the existing packaged runtime asset store. */
export function createRepairPromptReader(assets: Pick<AssetStore, 'readText'> = runtimeAssetStore): RepairPromptReader {
  return section => {
    const source = assets.readText('prompts/repair.md');
    const heading = `## ${section}\n`;
    const start = source.indexOf(heading);
    if (start < 0) { throw new Error(`Missing repair prompt section: ${section}`); }
    const body = source.slice(start + heading.length);
    const end = body.indexOf('\n## ');
    return (end < 0 ? body : body.slice(0, end)).trim();
  };
}
