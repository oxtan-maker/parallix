import * as fs from 'node:fs';
import path from 'node:path';

export type AssetKey = `${string}/${string}` | string;

export interface AssetStore {
  readText(_key: AssetKey): string;
  readBytes(_key: AssetKey): Uint8Array;
  has(_key: AssetKey): boolean;
}

function assetPath(rootDir: string, key: AssetKey): string {
  const normalized = path.posix.normalize(key).replace(/^\/+/, '');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Invalid asset key: ${key}`);
  }
  return path.join(rootDir, normalized);
}

/** Source-development adapter; callers receive logical keys rather than paths. */
export class FilesystemAssetStore implements AssetStore {
  constructor(private readonly _rootDir: string) {}

  readText(key: AssetKey): string {
    return fs.readFileSync(assetPath(this._rootDir, key), 'utf8');
  }

  readBytes(key: AssetKey): Uint8Array {
    return fs.readFileSync(assetPath(this._rootDir, key));
  }

  has(key: AssetKey): boolean {
    return fs.existsSync(assetPath(this._rootDir, key));
  }
}
