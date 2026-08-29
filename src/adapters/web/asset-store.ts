/**
 * asset-store.ts — load the packaged Vite-built browser assets (adapter).
 *
 * The web host (interfaces layer) owns the security policy and the transport;
 * this adapter owns the one file-IO concern: locating the packaged asset
 * directory, reading the build manifest, verifying each asset's sha256 and
 * size, and loading the allowlisted files into memory once per launch. It
 * reads only package-owned build output — never operator state (ADR 0053) —
 * so no ADR 0053 inventory entry is needed.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WebAssetFile {
  readonly size: number;
  readonly sha256: string;
  readonly contentType: string;
}

export type WebAssetManifest = Record<string, WebAssetFile>;

export interface LoadedWebAssets {
  /** Allowlist of relative paths (the manifest keys) with serving metadata. */
  readonly manifest: Record<string, { size: number; contentType: string }>;
  /** Relative path → in-memory asset body, integrity-verified at load. */
  readonly assets: ReadonlyMap<string, { contentType: string; body: Buffer }>;
  /** The raw shell HTML, before per-launch CSRF meta injection. */
  readonly shellHtml: string;
}

/**
 * Locate the packaged asset directory relative to a package root. The
 * manifest is the presence marker: a directory without one is not a built
 * asset root. Lookup order matches where the package root lands: `web/`
 * when running from the canonical bundle (checkout, npm install, or
 * extracted tarball — build/ re-asserts the package name), and `build/web`
 * at the checkout root when running from source.
 */
export function resolveWebAssetRoot(packageRootDir: string): string {
  for (const candidate of [path.join(packageRootDir, 'web'), path.join(packageRootDir, 'build', 'web')]) {
    if (fs.existsSync(path.join(candidate, 'manifest.json'))) { return candidate; }
  }
  // The serving manifest is written by the bundle step (which runs the Vite
  // build itself under the build lock), so `npm run build` is the
  // remediation, not `build:web` alone, which only emits the Vite artifacts.
  throw new Error('web assets unavailable: no web manifest found (run `npm run build` first)');
}

export function loadWebAssets(assetRoot: string): LoadedWebAssets {
  const manifestPath = path.join(assetRoot, 'manifest.json');
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { files?: WebAssetManifest };
  if (!raw.files || typeof raw.files !== 'object') {
    throw new Error(`web asset manifest is malformed: ${manifestPath}`);
  }
  const rootResolved = path.resolve(assetRoot);
  const manifest: Record<string, { size: number; contentType: string }> = {};
  const assets = new Map<string, { contentType: string; body: Buffer }>();
  for (const [relativePath, entry] of Object.entries(raw.files)) {
    const filePath = path.resolve(rootResolved, relativePath);
    if (!filePath.startsWith(rootResolved + path.sep)) {
      throw new Error(`web asset manifest entry escapes the asset root: ${relativePath}`);
    }
    const body = fs.readFileSync(filePath);
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    if (sha256 !== entry.sha256 || body.length !== entry.size) {
      throw new Error(`web asset failed integrity check at startup: ${relativePath}`);
    }
    manifest[relativePath] = { size: entry.size, contentType: entry.contentType };
    assets.set(relativePath, { contentType: entry.contentType, body });
  }
  if (!assets.has('index.html')) {
    throw new Error('web asset manifest has no index.html entry');
  }
  return {
    manifest,
    assets,
    shellHtml: assets.get('index.html')!.body.toString('utf8'),
  };
}
