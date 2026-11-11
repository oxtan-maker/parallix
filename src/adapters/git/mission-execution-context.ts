import fs from 'node:fs';
import path from 'node:path';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import type { LandedProofReader, MissionExecutionContextResolution } from '../../application/ports/mission-execution-context.js';
import { missionBranchName } from '../filesystem/mission-paths.js';
import * as gitModule from './git.js';
import { resolvePrimaryCheckout } from './repository-identity.js';
import { assertLocalBaseBranch, checkOutBaseWorktree, conventionalWorktreePath, getPrimaryBranch, getPrimaryWorktree,
  readRepositoryWorktrees, registeredWorktreeAt, resolveMissionBaseBranch, worktreeForBranch,
  type GitReader, type RepositoryWorktree } from './worktree.js';

/**
 * Resolve where one Mission operation executes from its identity. `root` is
 * any checkout of the repository (a web host passes its own); it only locates
 * the repository and never stands in for the mission or base checkout.
 *
 * Every checkout the resolver can return is one registered by that repository,
 * so a configured primary checkout in another repository never answers for
 * `root`. The only Git mutation is the feature-branch base worktree auto-creation
 * of ADR 0045, and it runs only once the mission identity is established — a
 * live mission checkout, or a proven landing — so a failed resolution leaves the
 * repository exactly as it was.
 *
 * `landedProof` separates the two facts a missing mission checkout can mean.
 * With it, a checkout that integration closeout already removed still resolves
 * — the squash on the receiving base is the durable evidence — while a checkout
 * that was never created or was deleted without landing stays a failure that
 * names the missing path. Without it, every missing checkout fails.
 */
export function resolveMissionExecutionContext(slug: string, root: string, configuration: ParallixConfiguration,
  gitFn: GitReader = gitModule.git, landedProof?: LandedProofReader): MissionExecutionContextResolution {
  const observed = observeMission(slug, root, configuration, gitFn, landedProof);
  if (!observed.ok) { return observed; }
  const { missionWorktree, missionBranch, base, baseAnchor } = observed;
  let baseWorktree = base.worktree;
  if (!baseWorktree) {
    try { baseWorktree = checkOutBaseWorktree(slug, base.branch, baseAnchor, gitFn); }
    catch (error) { return { ok: false, reason: `Mission ${slug}: ${unresolvedBase(base.branch, (error as Error).message)}` }; }
  }
  return { ok: true, context: { missionId: slug, missionWorktree, missionBranch, baseWorktree: path.resolve(baseWorktree), baseBranch: base.branch } };
}

/** What a read-only observation of one Mission's checkouts found. */
export type MissionCheckoutObservation =
  | { readonly ok: true; readonly missionWorktree: string | null; readonly baseBranch: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Observe the mission checkout and receiving base branch without changing the
 * repository. Admission-time callers (the board and its supervisor) use it to
 * refuse early; they hold no integration claim, so they never auto-create the
 * base worktree that `resolveMissionExecutionContext` may add once it is held.
 */
export function observeMissionCheckout(slug: string, root: string, configuration: ParallixConfiguration,
  gitFn: GitReader = gitModule.git, landedProof?: LandedProofReader): MissionCheckoutObservation {
  const observed = observeMission(slug, root, configuration, gitFn, landedProof);
  return observed.ok ? { ok: true, missionWorktree: observed.missionWorktree, baseBranch: observed.base.branch } : observed;
}

interface ObservedMission {
  readonly ok: true;
  readonly missionWorktree: string | null;
  readonly missionBranch: string;
  readonly base: { branch: string; worktree: string | null };
  /** The registered checkout a missing base worktree is created beside (ADR 0045). */
  readonly baseAnchor: string;
}

/** Read-only: every Git read and filesystem probe of a resolution, before any base worktree is added. */
function observeMission(slug: string, root: string, configuration: ParallixConfiguration, gitFn: GitReader, landedProof?: LandedProofReader): ObservedMission | { ok: false; reason: string } {
  const missionBranch = missionBranchName(slug, root);
  let checkouts: RepositoryWorktree[];
  try { checkouts = readRepositoryWorktrees(root, gitFn); }
  catch (error) { return { ok: false, reason: `Mission ${slug}: ${root} is not a readable git checkout: ${(error as Error).message}` }; }
  const located = locateMissionWorktree(slug, root, missionBranch, checkouts, configuration, gitFn);
  if ('fact' in located) {
    return observeLandedMission(slug, root, missionBranch, located.fact, checkouts, configuration, gitFn, landedProof);
  }
  const missionWorktree = located.path;
  const observedBranch = gitModule.getCurrentBranch(missionWorktree, gitFn);
  // Git detaches HEAD while a rebase is paused. The sequencer's head-name is
  // the authoritative branch identity in that state; accepting only a live
  // rebase for this exact mission keeps wrong-branch checkouts rejected.
  const pausedRebase = observedBranch === '' ? gitModule.detectRebaseState(missionWorktree, {
    gitRunner: args => ({ ...gitFn(args), signal: null }),
  }) : null;
  if (observedBranch !== missionBranch && !(pausedRebase?.inProgress && pausedRebase.branch === missionBranch)) {
    return { ok: false, reason: `Mission ${slug}: mission worktree ${missionWorktree} is on ${observedBranch || '(detached HEAD)'}, expected ${missionBranch}.` };
  }
  const base = observeReceivingBase(slug, missionWorktree, checkouts, gitFn);
  if ('fact' in base) { return { ok: false, reason: `Mission ${slug}: ${base.fact}` }; }
  const anchored = baseAnchorFor(slug, missionWorktree, base, checkouts, configuration, gitFn);
  if ('fact' in anchored) { return { ok: false, reason: `Mission ${slug}: ${anchored.fact}` }; }
  return { ok: true, missionWorktree: path.resolve(missionWorktree), missionBranch, base, baseAnchor: anchored.anchor };
}

/** Resolve a removed checkout only when durable landing evidence proves that removal is expected. */
function observeLandedMission(slug: string, root: string, missionBranch: string, missingFact: string,
  checkouts: RepositoryWorktree[], configuration: ParallixConfiguration, gitFn: GitReader,
  landedProof?: LandedProofReader): ObservedMission | { ok: false; reason: string } {
  // Read-only until the landing is proven: the probe reads the base branch from
  // any checkout of this repository, so an unproven removal adds nothing.
  const observed = observeReceivingBase(slug, root, checkouts, gitFn);
  if ('fact' in observed) { return { ok: false, reason: `Mission ${slug}: ${missingFact} Also, ${observed.fact}` }; }
  const landed = landedProof?.(observed.worktree ?? root, slug) ?? null;
  if (!landed) { return { ok: false, reason: `Mission ${slug}: ${missingFact}` }; }
  const anchored = baseAnchorFor(slug, root, observed, checkouts, configuration, gitFn);
  if ('fact' in anchored) { return { ok: false, reason: `Mission ${slug}: ${anchored.fact}` }; }
  return { ok: true, missionWorktree: null, missionBranch, base: observed, baseAnchor: anchored.anchor };
}

/** The live worktree registered on the mission branch, else the conventional path for the wrong-branch diagnosis. */
function locateMissionWorktree(slug: string, root: string, missionBranch: string, checkouts: RepositoryWorktree[], configuration: ParallixConfiguration, gitFn: GitReader): { path: string } | { fact: string } {
  const listed = worktreeForBranch(checkouts, missionBranch);
  if (listed && (listed.prunable || !fs.existsSync(listed.path))) {
    return { fact: `mission worktree ${listed.path} for ${missionBranch} is missing; restore it, or run git worktree prune and recreate it, before retrying.` };
  }
  if (listed) { return { path: listed.path }; }
  // A paused rebase detaches its registered checkout, so porcelain cannot map
  // it to the mission branch. Admit only the checkout the caller launched from,
  // and only when the sequencer names this exact mission branch. The ordinary
  // primary/web-host path therefore keeps the existing missing-checkout result.
  const launch = registeredLaunchWorktree(checkouts, root, gitFn);
  if (launch && !launch.prunable && fs.existsSync(launch.path) && gitModule.getCurrentBranch(launch.path, gitFn) === '') {
    const rebase = gitModule.detectRebaseState(launch.path, { gitRunner: args => ({ ...gitFn(args), signal: null }) });
    if (rebase.inProgress && rebase.branch === missionBranch) { return { path: launch.path }; }
  }
  let expected: string;
  try { expected = conventionalWorktreePath(slug, repositoryAnchor(root, checkouts, configuration, gitFn)); }
  catch (error) { return { fact: `mission worktree for ${missionBranch} cannot be located: ${(error as Error).message}` }; }
  // The conventional path counts only when it is a checkout of this repository:
  // a configured primary checkout in another repository never answers for root.
  const registered = registeredWorktreeAt(checkouts, expected);
  if (registered && !registered.prunable && fs.existsSync(registered.path)) { return { path: registered.path }; }
  return { fact: `no worktree is checked out on ${missionBranch} in the repository at ${root} (expected ${expected}).` };
}

/** The registered checkout that Git says owns the caller's launch path. */
function registeredLaunchWorktree(checkouts: RepositoryWorktree[], root: string, gitFn: GitReader): RepositoryWorktree | null {
  try {
    const topLevel = gitFn(['-C', root, 'rev-parse', '--show-toplevel']);
    const checkoutRoot = String(topLevel.stdout || '').trim();
    return topLevel.status === 0 && checkoutRoot ? registeredWorktreeAt(checkouts, checkoutRoot) : null;
  } catch {
    return null;
  }
}

/** The checkout this repository lays its conventional mission path out from. */
function repositoryAnchor(root: string, checkouts: RepositoryWorktree[], configuration: ParallixConfiguration, gitFn: GitReader): string {
  const primary = registeredWorktreeAt(checkouts, resolvePrimaryCheckout(root, gitFn));
  return primary && !primary.bare && !primary.prunable ? primary.path : getPrimaryWorktree(configuration);
}

/** Where the mission payload lands, observed from registered checkouts only; `worktree` is null when none is checked out. */
function observeReceivingBase(slug: string, configRoot: string, checkouts: RepositoryWorktree[], gitFn: GitReader): { branch: string; worktree: string | null } | { fact: string } {
  let branch: string;
  try { branch = resolveMissionBaseBranch(slug, configRoot, { gitFn }); }
  catch (error) { return { fact: `receiving base branch cannot be resolved: ${(error as Error).message}` }; }
  const listed = worktreeForBranch(checkouts, branch);
  if (listed?.bare || listed?.prunable || (listed && !fs.existsSync(listed.path))) { return { branch, worktree: null }; }
  if (listed) { return { branch, worktree: listed.path }; }
  // The primary branch is never labelled onto whichever checkout the repository
  // keeps as its main one: that checkout may sit on another branch, and landing
  // there would run closeout in the wrong tree. Only a checkout that has the base
  // branch checked out is a base worktree.
  if (branch === getPrimaryBranch(configRoot, gitFn)) {
    const main = registeredWorktreeAt(checkouts, resolvePrimaryCheckout(configRoot, gitFn))?.path;
    const current = main ? gitModule.getCurrentBranch(main, gitFn) : null;
    return { fact: `receiving base ${branch} is not checked out: the repository checkout${main ? ` ${main}` : ''} is on ${current || '(detached HEAD)'}. Check out ${branch} there before integrating.` };
  }
  return { branch, worktree: null };
}

const unresolvedBase = (branch: string, detail: string) => `receiving base worktree for ${branch} cannot be resolved: ${detail}`;

/**
 * Read-only: the checkout a base worktree ADR 0045 auto-creates is placed beside,
 * once the recorded base exists locally. The anchor is a checkout of this
 * repository, never a configured primary checkout that it does not register.
 */
function baseAnchorFor(slug: string, root: string, base: { branch: string; worktree: string | null }, checkouts: RepositoryWorktree[], configuration: ParallixConfiguration, gitFn: GitReader): { anchor: string } | { fact: string } {
  if (base.worktree) { return { anchor: base.worktree }; }
  let anchor: string;
  try { anchor = repositoryAnchor(root, checkouts, configuration, gitFn); }
  catch (error) { return { fact: unresolvedBase(base.branch, (error as Error).message) }; }
  if (!registeredWorktreeAt(checkouts, anchor)) {
    return { fact: unresolvedBase(base.branch, `no checkout of the repository at ${root} can anchor a base worktree; add it with git worktree add <path> ${base.branch} before integrating.`) };
  }
  try { assertLocalBaseBranch(slug, base.branch, anchor, gitFn); }
  catch (error) { return { fact: unresolvedBase(base.branch, (error as Error).message) }; }
  return { anchor };
}
