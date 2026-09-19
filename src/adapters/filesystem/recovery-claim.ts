import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * The cross-process claim on one mission's recovery (ADR 0059).
 *
 * Two local supervisor runs must never recover the same mission at once.
 *
 * One primitive carries the whole protocol: a directory becomes visible only
 * once it already contains its owner record (pid plus a random token), because
 * the record is written into a staging directory that is then `rename`d into
 * place. From that, three properties follow:
 *
 *  1. **No directory is ever observed without its owner**, so nobody has to
 *     guess who holds a half-initialized claim or lock.
 *  2. **Taking over a dead owner has exactly one winner.** The takeover is a
 *     `rename` of the dead directory out of the way: of two contenders, one
 *     succeeds and the other gets `ENOENT`. Liveness is decided by the recorded
 *     pid, never by age — an old directory is not a dead one.
 *  3. **A release removes only what the caller published**, because it checks
 *     that its own token is still the one on disk.
 *
 * Stealing a mission's claim additionally holds a takeover lock, so two runs
 * that saw the same corpse cannot both re-read and act on it. That lock is the
 * same kind of directory, with the same ownership rules, so recovering an
 * abandoned lock cannot be decided by age or displace a live holder.
 *
 * The lock is an optimization of that serialization, not the safety property.
 * A rare three-way interleaving — one run moving an abandoned lock aside while
 * a second publishes into the gap and a third restores over it — can still let
 * two runs believe they hold the *lock*. The mission itself stays single-owner
 * regardless, because taking the claim is the atomic move-aside in `takeOver`:
 * of any number of runs inside the lock, exactly one moves the corpse and
 * publishes, and the rest fail and return null.
 *
 * The claim is not durable state: it lives in the temporary directory and must
 * not outlive the machine.
 */

function claimsRoot(): string {
  return path.join(os.tmpdir(), 'parallix-recovery-claims');
}

function claimDir(mission: string): string {
  return path.join(claimsRoot(), mission.replace(/[^\w.-]/g, '_'));
}

interface Owner {
  readonly pid: number;
  readonly token: string;
}

/** The owner recorded in a directory. Throws when the record cannot be read. */
function readOwner(dir: string): Owner | null {
  const [pid, token] = fs.readFileSync(path.join(dir, 'owner'), 'utf8').split('\n');
  const parsed = Number(pid);
  if (!Number.isInteger(parsed) || parsed <= 0 || !token) { return null; }
  return { pid: parsed, token };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists and belongs to another user: still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Publish this process's ownership of `dir`; false when someone else has it. */
function publish(dir: string, token: string): boolean {
  const staging = fs.mkdtempSync(path.join(claimsRoot(), '.staging-'));
  fs.writeFileSync(path.join(staging, 'owner'), `${process.pid}\n${token}`, 'utf8');
  if (fs.existsSync(dir)) {
    fs.rmSync(staging, { recursive: true, force: true });
    return false;
  }
  try {
    fs.renameSync(staging, dir);
  } catch {
    fs.rmSync(staging, { recursive: true, force: true });
    return false;
  }
  // Confirm the published record is this call's: `rename` onto a directory that
  // appeared in the same instant can lose without failing on every platform.
  try {
    return readOwner(dir)?.token === token;
  } catch {
    return false;
  }
}

/** Remove `dir` only while this call's token is still the one recorded in it. */
function releaseOwned(dir: string, token: string): void {
  try {
    if (readOwner(dir)?.token !== token) { return; }
  } catch {
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * The occupant of `dir`: its live owner, `null` when the recorded owner is gone,
 * or `'unreadable'` when the record cannot be read at all. An unreadable
 * directory is never taken over — that is more likely a permissions or
 * filesystem problem than a corpse.
 */
function occupant(dir: string): Owner | null | 'unreadable' {
  let owner: Owner | null;
  try {
    owner = readOwner(dir);
  } catch {
    return fs.existsSync(dir) ? 'unreadable' : null;
  }
  if (!owner) { return 'unreadable'; }
  return processIsAlive(owner.pid) ? owner : null;
}

/**
 * Take `dir` over from the dead owner `observed`, then publish this call's own
 * ownership. The move-aside `rename` is the serialization point: only one
 * contender can move a given directory, so only one can go on to publish.
 */
function takeOver(dir: string, observed: Owner, token: string): boolean {
  const aside = path.join(claimsRoot(), `.dead-${process.pid}-${crypto.randomUUID()}`);
  try {
    fs.renameSync(dir, aside);
  } catch {
    return false;
  }
  // The mover is the only one who can read what it moved. If the record it
  // moved is not the corpse it observed, a live owner has been displaced: put
  // it back rather than replacing it.
  let moved: Owner | null = null;
  try {
    moved = readOwner(aside);
  } catch { /* unreadable; treated as not-the-observed-corpse below */ }
  if (!moved || moved.token !== observed.token) {
    try {
      fs.renameSync(aside, dir);
    } catch {
      fs.rmSync(aside, { recursive: true, force: true });
    }
    return false;
  }
  fs.rmSync(aside, { recursive: true, force: true });
  return publish(dir, token);
}

/** Hold the serialization lock for stealing one mission's claim. */
function lockTakeover(dir: string, token: string, hooks: RecoveryClaimTestHooks): (() => void) | null {
  const lock = `${dir}.takeover`;
  if (!publish(lock, token)) {
    const holder = occupant(lock);
    if (holder === 'unreadable' || holder !== null) { return null; }
    // The lock was abandoned by a run that died mid-takeover. Recovering it is
    // the same ownership-safe takeover as any other directory, so two
    // contenders that saw the same abandoned lock cannot both end up holding it.
    hooks.onAbandonedTakeoverLock?.();
    const abandoned = occupant(lock);
    if (abandoned !== null) { return null; }
    let dead: Owner | null;
    try {
      dead = readOwner(lock);
    } catch {
      return null;
    }
    if (!dead || !takeOver(lock, dead, token)) { return null; }
  }
  return () => releaseOwned(lock, token);
}

/** Test-only seams for the two moments where contenders can interleave. */
export interface RecoveryClaimTestHooks {
  /** After reading a dead claim owner, before the takeover is serialized. */
  readonly onDeadOwnerObserved?: () => void;
  /** After observing an abandoned takeover lock, before recovering it. */
  readonly onAbandonedTakeoverLock?: () => void;
}

/** Take the claim, or return null when another live run holds it. */
export function claimRecoveryLock(mission: string, hooks: RecoveryClaimTestHooks = {}): (() => Promise<void>) | null {
  const dir = claimDir(mission);
  const token = crypto.randomUUID();
  fs.mkdirSync(claimsRoot(), { recursive: true });
  const held = (): (() => Promise<void>) => async (): Promise<void> => { releaseOwned(dir, token); };

  if (publish(dir, token)) { return held(); }

  const holder = occupant(dir);
  if (holder === 'unreadable') { return null; }
  if (holder !== null) { return null; }
  let dead: Owner | null;
  try {
    dead = readOwner(dir);
  } catch {
    return null;
  }
  if (!dead) { return null; }
  hooks.onDeadOwnerObserved?.();

  const releaseTakeover = lockTakeover(dir, token, hooks);
  if (!releaseTakeover) { return null; }
  try {
    // Re-read under the lock: another run may have completed its own takeover
    // while this one was still holding a stale observation.
    const current = occupant(dir);
    if (current === 'unreadable' || current !== null) { return null; }
    const stillDead = readOwner(dir);
    if (!stillDead || stillDead.token !== dead.token) { return null; }
    return takeOver(dir, stillDead, token) ? held() : null;
  } catch {
    return null;
  } finally {
    releaseTakeover();
  }
}
