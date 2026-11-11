import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { resolvePxEntryLoader, SOURCE_PX_ENTRY, type PxEntryLoader } from '../lib/px-entry.js';

/** Bundle the current checkout once when a focused lane has no canonical prebuild. */
export async function resolveFixturePxEntry(root: string): Promise<PxEntryLoader> {
  const selected = resolvePxEntryLoader();
  if (!selected.loader) { return selected; }
  const checkout = process.cwd();
  const packageRoot = path.join(root, 'px-runtime');
  const entry = path.join(packageRoot, 'px.mjs');
  fs.mkdirSync(packageRoot, { recursive: true });
  await build({
    absWorkingDir: checkout,
    entryPoints: [SOURCE_PX_ENTRY],
    outfile: entry,
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: `import { createRequire as fixtureRequire } from 'node:module'; const require = fixtureRequire(${JSON.stringify(path.join(checkout, 'package.json'))});` },
    nodePaths: [path.join(checkout, 'node_modules')],
  });
  // The bundle remains a real package-rooted CLI with the production assets and
  // external dependencies it would resolve from a canonical build.
  for (const name of ['node_modules', 'config', 'prompts', 'templates', 'data', 'scripts', 'package.json']) {
    fs.symlinkSync(path.join(checkout, name), path.join(packageRoot, name));
  }
  fs.symlinkSync(path.join(checkout, 'src/adapters/sqlite/migrations'), path.join(packageRoot, 'migrations'), 'dir');
  return { entry, loader: '' };
}
