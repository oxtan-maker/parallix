import path from 'node:path';
import { build } from 'esbuild';
import { caseRoot } from './case-root.js';

/** Immutable test-only entry; never added to the production CLI bundle. */
export async function bundleWorkflowChild() {
  const owned = caseRoot('workflow-child-bundle-');
  const entry = path.join(owned.root, 'workflow-child.mjs');
  try {
    await build({ entryPoints: [path.resolve('test/fixtures/workflow-owner-child.ts')], outdir: owned.root, outExtension: { '.js': '.mjs' }, entryNames: 'workflow-child',
      // Each real owner/observer loads this entry independently. Compact the
      // immutable fixture to avoid repeatedly parsing the full source graph.
      // Lazy host chunks keep Fastify out of observer and worker startup.
      bundle: true, splitting: true, minify: true, platform: 'node', format: 'esm', packages: 'external',
      banner: { js: `import { createRequire as fixtureRequire } from 'node:module'; const require = fixtureRequire(${JSON.stringify(path.resolve('package.json'))});` },
      nodePaths: [path.resolve('node_modules')],
    });
    // External dependencies resolve from the checkout rather than the private temp root.
    const fs = await import('node:fs');
    for (const name of ['node_modules', 'config', 'prompts', 'templates', 'data', 'scripts', 'package.json']) {
      fs.symlinkSync(path.resolve(name), path.join(owned.root, name));
    }
    fs.symlinkSync(path.resolve('src/adapters/sqlite/migrations'), path.join(owned.root, 'migrations'), 'dir');
    return { cli: { command: process.execPath, args: [entry] }, close: () => owned.dispose() };
  } catch (error) { owned.dispose(); throw error; }
}
