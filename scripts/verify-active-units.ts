/** Repository policy for uncovered active/review units; integration calls its
 * separate covered command directly. Unit inputs exclude Backlog bookkeeping;
 * the product's publication proof continues to certify the entire exact tree. */
import { resolveConfiguration } from '../src/composition/config.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  createActiveVerificationIdentity,
  readActiveVerificationProof,
  writeActiveVerificationProof,
} from '../src/adapters/verification/active-verification-proof.js';

export const ACTIVE_UNIT_COMMAND = 'PARALLIX_FAST_UNIT=1 PARALLIX_TEST_COVERAGE=0 npm test -- --unit-test-headroom';

export function verifyActiveUnits(options: {
  root?: string;
  proofPath?: string;
  env?: NodeJS.ProcessEnv;
  log?: (_message: string) => void;
  runUnits?: (_command: string, _env: NodeJS.ProcessEnv) => number;
} = {}): number {
  const root = fs.realpathSync(options.root ?? process.cwd());
  const log = options.log ?? console.log;
  const configuration = resolveConfiguration(options.env ?? process.env);
  const proofOptions = { configuration, ...(options.proofPath ? { proofPath: options.proofPath } : {}) };
  const cached = readActiveVerificationProof(ACTIVE_UNIT_COMMAND, root, proofOptions);
  if (cached.ok) {
    log('Active/review units: reused successful uncovered proof.');
    return 0;
  }
  if ('blocked' in cached) { log(cached.error); return 1; }
  const before = createActiveVerificationIdentity(ACTIVE_UNIT_COMMAND, root, proofOptions);
  const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env), PARALLIX_FAST_UNIT: '1', PARALLIX_TEST_COVERAGE: '0' };
  // Native V8 reporting and NODE_OPTIONS may enable coverage independently of
  // the repository reporting flag. Strip both before launching npm or workers.
  delete env.NODE_V8_COVERAGE;
  delete env.NODE_OPTIONS;
  const status = options.runUnits
    ? options.runUnits(ACTIVE_UNIT_COMMAND, env)
    : spawnSync('bash', ['-c', ACTIVE_UNIT_COMMAND], { cwd: root, env, stdio: 'inherit' }).status ?? 1;
  if (status !== 0) { return status; }
  if (before.ok === true) {
    const written = writeActiveVerificationProof(ACTIVE_UNIT_COMMAND, root, { ...proofOptions, expectedIdentity: before.identity });
    if (written.ok === false) { log(`Active/review units: proof unavailable: ${written.error}`); return 1; }
  } else {
    log(`Active/review units: passed without reusable proof: ${before.error}; commit the candidate before final verification.`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = verifyActiveUnits();
}
