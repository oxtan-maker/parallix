// Recovery claim contract: one supervisor run owns a mission's recovery claim; takeover of a dead owner is
// race-free, and a release removes only the claim the caller published.
//
// Behavior-owned suite (TASK-2622.12), split from the recovery supervisor suite to stay under the test
// file cap. Case names are unchanged; provenance TASK-2489 (ADR 0059).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claimRecoveryLock } from '../src/adapters/filesystem/recovery-claim.js';

test('only one supervisor run holds a mission claim, and a released claim is available again', async () => {
  const mission = `task-2489-claim-${process.pid}`;

  const held = claimRecoveryLock(mission);
  assert.ok(held, 'the first run takes the claim');
  assert.equal(claimRecoveryLock(mission), null, 'a second run is refused while the first holds it');
  await held();

  const again = claimRecoveryLock(mission);
  assert.ok(again, 'a released claim is available');
  await again();
});


test('a claim is never visible without its owner, and only a readable dead owner is taken over', async () => {
  const mission = `task-2489-race-${process.pid}`;
  const dir = path.join(os.tmpdir(), 'parallix-recovery-claims', mission);

  const held = claimRecoveryLock(mission);
  assert.ok(held, 'the claim is taken');
  assert.equal(fs.readFileSync(path.join(dir, 'owner'), 'utf8').split('\n')[0], String(process.pid),
    'the owner is published before the claim directory exists, so no racing run can read an ownerless claim');
  assert.equal(claimRecoveryLock(mission), null, 'a live claim is refused');
  await held();

  // A claim with no readable owner is not a corpse to be stolen.
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(claimRecoveryLock(mission), null, 'an unreadable claim is left alone');

  // A claim whose recorded owner is gone is taken over.
  fs.writeFileSync(path.join(dir, 'owner'), '2147483646\ndead-token', 'utf8');
  const takenOver = claimRecoveryLock(mission);
  assert.ok(takenOver, 'a dead owner is taken over');
  assert.equal(fs.readFileSync(path.join(dir, 'owner'), 'utf8').split('\n')[0], String(process.pid));
  await takenOver();
  assert.equal(fs.existsSync(dir), false, 'releasing removes the claim');
});


test('two runs that saw the same dead owner cannot both take the claim', async () => {
  const mission = `task-2489-interleave-${process.pid}`;
  const dir = path.join(os.tmpdir(), 'parallix-recovery-claims', mission);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'owner'), '2147483646\ndead-token', 'utf8');

  // B reads the dead owner, and A completes its whole takeover inside that
  // window. B must then find A's live claim and give up rather than delete it.
  let winner: (() => Promise<void>) | null = null;
  const loser = claimRecoveryLock(mission, {
    onDeadOwnerObserved: () => { winner = claimRecoveryLock(mission); },
  });

  assert.ok(winner, 'the run that got there first holds the claim');
  assert.equal(loser, null, 'the run holding a stale observation does not steal it back');
  assert.equal(fs.readFileSync(path.join(dir, 'owner'), 'utf8').split('\n')[0], String(process.pid),
    'and the live claim was not deleted underneath its owner');
  await winner!();
  assert.equal(fs.existsSync(dir), false);
});

test('a release removes only the claim the caller published', async () => {
  const mission = `task-2489-release-${process.pid}`;
  const dir = path.join(os.tmpdir(), 'parallix-recovery-claims', mission);

  const taken = claimRecoveryLock(mission);
  assert.ok(taken, 'the claim is taken');
  // A successor took it over while this run was still holding its release.
  fs.writeFileSync(path.join(dir, 'owner'), `${process.pid}\nsomeone-elses-token`, 'utf8');
  await taken();

  assert.equal(fs.existsSync(dir), true, 'the successor\'s claim survives the predecessor\'s release');
  fs.rmSync(dir, { recursive: true, force: true });
});


test('a contender that recovers the abandoned takeover lock first is not displaced', async () => {
  const mission = `task-2489-abandoned-${process.pid}`;
  const dir = path.join(os.tmpdir(), 'parallix-recovery-claims', mission);
  const lock = `${dir}.takeover`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(lock, { recursive: true, force: true });
  // A dead claim, plus the takeover lock a run died holding.
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'owner'), '2147483646\ndead-claim', 'utf8');
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner'), '2147483645\ndead-lock', 'utf8');
  const long = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lock, long, long);

  // Both contenders see the same abandoned lock. The other one recovers it
  // while this one still holds its stale view; deleting it from here would put
  // two runs inside the takeover the lock exists to serialize.
  const loser = claimRecoveryLock(mission, {
    onAbandonedTakeoverLock: () => {
      fs.rmSync(lock, { recursive: true, force: true });
      fs.mkdirSync(lock, { recursive: true });
      fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwinners-lock`, 'utf8');
      // The winner's lock is no younger than the corpse it replaced: age is not
      // evidence of death, so only ownership may decide this.
      fs.utimesSync(lock, long, long);
    },
  });

  assert.equal(loser, null, 'the contender holding a stale view of the lock does not enter behind it');
  assert.equal(fs.readFileSync(path.join(lock, 'owner'), 'utf8').split('\n')[1], 'winners-lock',
    "and it does not delete the winner's lock");
  assert.equal(fs.readFileSync(path.join(dir, 'owner'), 'utf8').split('\n')[1], 'dead-claim',
    'the claim is left for the run that holds the lock');

  fs.rmSync(lock, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an abandoned takeover lock whose holder is alive is left alone', async () => {
  const mission = `task-2489-livelock-${process.pid}`;
  const dir = path.join(os.tmpdir(), 'parallix-recovery-claims', mission);
  const lock = `${dir}.takeover`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'owner'), '2147483646\ndead-claim', 'utf8');
  // Age is not evidence of death: this lock is old and its holder is running.
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nlive-lock`, 'utf8');
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lock, old, old);

  assert.equal(claimRecoveryLock(mission), null, 'a live takeover holder is never displaced');
  assert.equal(fs.readFileSync(path.join(lock, 'owner'), 'utf8').split('\n')[1], 'live-lock');

  fs.rmSync(lock, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});
