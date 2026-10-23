import { stopCoverage } from 'node:v8';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Native coverage cannot attribute the minified bundle to src/ (ADR 0062).
// Its raw reports add no source ranges, but each CLI launch writes megabytes.
// execArgv can forward this preload to another entry. Stop only this bundle's
// collector and retain the environment so source-loaded descendants stay covered.
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(new URL('../../build/px.mjs', import.meta.url))) {
  stopCoverage();
}
