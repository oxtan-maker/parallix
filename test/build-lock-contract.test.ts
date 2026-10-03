// No existing suite owns canonical-build lock liveness. These hermetic cases
// cover recovery and exclusion using a process-probe double.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { isBuildLockAbandoned } from '../scripts/build-lock.js';

test('canonical builder retries immediately after reclaiming a dead owner (TASK-2622.08)', () => {
  const source = fs.readFileSync(new URL('../scripts/build-canonical-bundle.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function acquireBuildLock(): void {');
  const end = source.indexOf('\nacquireBuildLock();', start);
  const acquire = source.slice(start, end)
    .replace(': void', '').replace(/let heldSince: number;/, 'let heldSince;')
    .replace(/let owner: string \| undefined;/, 'let owner;')
    .replace(/ as NodeJS\.ErrnoException/g, '');
  let reclaimed = false;
  vm.runInNewContext(`${acquire}\nacquireBuildLock();`, {
    lockDir: '/isolated-build-lock', LOCK_WAIT_MS: 300_000, LOCK_STALE_MS: 600_000,
    isBuildLockAbandoned,
    path: { join: (...parts: string[]) => parts.join('/') },
    fs: {
      mkdirSync: () => {
        if (!reclaimed) { throw Object.assign(new Error('locked'), { code: 'EEXIST' }); }
      },
      writeFileSync: () => {}, existsSync: () => true,
      statSync: () => ({ mtimeMs: Date.now() - 50_000 }),
      readFileSync: () => '123\n', rmSync: () => { reclaimed = true; },
    },
    process: { pid: 456, kill: () => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); } },
    Atomics: { wait: () => { throw new Error('waited on a dead build owner'); } },
  });
  assert.equal(reclaimed, true);
});

test('reclaims a dead build owner before the wait timeout (TASK-2622.08)', () => {
  assert.equal(isBuildLockAbandoned('123\n', 50_000, () => {
    throw Object.assign(new Error('dead'), { code: 'ESRCH' });
  }), true);
});

test('keeps live and inaccessible owners even beyond the stale age', () => {
  assert.equal(isBuildLockAbandoned('123', 700_000, () => {}), false);
  assert.equal(isBuildLockAbandoned('123', 700_000, () => {
    throw Object.assign(new Error('denied'), { code: 'EPERM' });
  }), false);
});

test('allows owner publication and bounds recovery of malformed owners', () => {
  const unexpectedProbe = () => { throw new Error('must not probe malformed owner'); };
  for (const owner of [undefined, '', '0', '-1', 'garbage', '9007199254740992']) {
    assert.equal(isBuildLockAbandoned(owner, 50_000, unexpectedProbe), false);
    assert.equal(isBuildLockAbandoned(owner, 600_001, unexpectedProbe), true);
  }
});
