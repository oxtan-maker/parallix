/**
 * Base-worktree preflight repair: heal integration-owned poison left by an
 * interrupted `px integrate` before the next run's stash/rebase steps.
 *
 * Integration assumes the resolved base worktree is clean at entry (ADR 0043
 * resolves the base branch and immediately stashes + rebases). An abort that
 * fires after `stashMainCheckoutIfNeeded` creates its marker stash but before
 * `restoreMainCheckoutStash` runs — or after a shared rebase dead-ends mid-replay
 * — leaves two independent poisons in the base worktree:
 *
 *   1. A marker-tagged stash (`integrate:<slug>: temporary integration checkout
 *      stash`) that never gets popped. Every later integrate stashes again and
 *      the list grows until a `stash pop` collides with the landed squash commit.
 *   2. A live `rebase-merge/` / `rebase-apply/` directory with an unmerged index,
 *      which the preflight bails on as `rebase-in-progress` / `main-index-conflicts`.
 *
 * This routine is read-only-to-safety: it only ever drops integration-owned
 * marker stashes and only ever aborts a rebase when a live rebase directory is
 * present. It acts solely in the resolved base worktree (`context.baseWorktree`),
 * never in a mission worktree or the caller's cwd.
 */
import * as fmt from '../presentation/cli-format.js';
import type { IntegrateGitRunner } from '../ports/integrate-workflow.js';

/**
 * The trailing, slug-agnostic half of the integration-stash marker. This is the
 * single source of truth for the marker literal: `stashMainCheckoutIfNeeded`
 * (the push) builds `integrate:<slug>:` + this suffix, and the sweep (below)
 * matches against it, so the two can never disagree on the identifier.
 */
export const INTEGRATION_STASH_MARKER_SUFFIX = ' temporary integration checkout stash';

/** Build the full integration-stash marker for a slug. Shared by the push and the sweep. */
export function integrationStashMarker(slug: string): string {
  return `integrate:${slug}:${INTEGRATION_STASH_MARKER_SUFFIX}`;
}

/**
 * True when a stash message is an integration marker stash for *any* slug.
 *
 * Marker stashes are always integration-owned regardless of which mission
 * created them, so the sweep drops one left by a previous mission while a later
 * mission integrates. The match is anchored on both ends — it must start with
 * `integrate:` and end with the shared marker suffix — so a real (non-marker)
 * stash is never dropped.
 */
export function isIntegrationMarkerStash(message: string): boolean {
  return message.startsWith('integrate:') && message.endsWith(INTEGRATION_STASH_MARKER_SUFFIX);
}

/** Extract the message half of a `git stash list` reflog line. */
function markerStashMessage(reflogLine: string): string | null {
  // Format: `stash@{N}: On <branch>: <message>`. Branch names cannot contain `:`,
  // so `[^:]+` captures the branch and the rest is the message.
  const match = /^stash@\{\d+\}: On [^:]*: (.*)$/.exec(reflogLine);
  return match ? match[1] : null;
}

function stashRef(reflogLine: string): string {
  // `stash@{0}: On ...` -> `stash@{0}` (drop the trailing colon).
  return reflogLine.slice(0, reflogLine.indexOf(':'));
}

/**
 * Parse the marker-tagged stashes out of a `git stash list` output, each with
 * its positional index. The index is captured up front because every
 * `git stash drop` renumbers the stack below it (see `repairBaseWorktree`).
 */
function listMarkerStashes(stdout: string): { index: number; ref: string }[] {
  const out: { index: number; ref: string }[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) { continue; }
    const message = markerStashMessage(trimmed);
    if (message === null || !isIntegrationMarkerStash(message)) { continue; }
    const refMatch = /^stash@\{(\d+)\}:/.exec(trimmed);
    out.push({ index: refMatch ? parseInt(refMatch[1], 10) : 0, ref: stashRef(trimmed) });
  }
  return out;
}

/**
 * True when a live rebase is in progress in the given worktree.
 *
 * Uses `git rebase --show-current` — the canonical in-progress signal that
 * covers both the rebase-merge and rebase-apply formats — rather than stat-ing
 * the `.git/rebase-*` directory: the application layer is forbidden from
 * importing `node:fs` (boundary guard), and this is git's own answer to the
 * same question. Non-empty stdout means a rebase is replaying; empty means the
 * worktree is clean. The exit code is irrelevant here — only stdout is read.
 */
function liveRebaseInProgress(baseWorktree: string, git: IntegrateGitRunner): boolean {
  const showCurrent = git(['-C', baseWorktree, 'rebase', '--show-current']);
  return showCurrent.status === 0 && showCurrent.stdout.trim().length > 0;
}

/**
 * Sweep the base worktree for integration-owned poison and drop/abort it.
 *
 * - Drops every marker-tagged stash (`integrate:<slug>: temporary integration
 *   checkout stash`), sharing the marker literal with `stashMainCheckoutIfNeeded`.
 * - When a live `rebase-merge/` / `rebase-apply/` directory is present, runs
 *   `git rebase --abort` then `git reset --hard HEAD` to clear the dead replay
 *   and its unmerged index. The reset target is always valid: a rebase in
 *   progress leaves HEAD on the original branch tip.
 *
 * Only ever touches the resolved base worktree. Returns a small report so tests
 * can assert exactly what changed.
 *
 * @param {{ baseWorktree: string, git: IntegrateGitRunner, dryRun?: boolean }} params
 *
 * @remarks F3 (task-2532 round 2): the git stash stack is shared across every
 * worktree of the repository, so a marker stash left by one mission can be the
 * live temporary checkout of another. The guard tried to protect a concurrent
 * run by skipping a stash whose owning mission was still in the `integration`
 * lane — but that status is not a liveness signal: `approve` moves a mission to
 * `integration` and the only exit is `integrate` → `done`, so an interrupted
 * run stays `integration` forever and its poison is never swept (the SC1
 * incident). `restoreMainCheckoutStash` pops `stash@{0}`, so concurrent
 * integrates on the same base worktree were never supported and are out of
 * scope. The sweep therefore drops every marker stash unconditionally, which is
 * exactly what SC1 requires. See `src/application/integrate-workflow.ts`.
 */
export async function repairBaseWorktree(
  {
    baseWorktree,
    git,
    dryRun = false,
  }: {
    baseWorktree: string;
    git: IntegrateGitRunner;
    /**
     * Detect-only: report what would be repaired without mutating the base
     * worktree. `px integrate --dry-run` passes this so the non-mutating
     * dry-run contract is preserved (F2, task-2532 round 1) — the sweep logs
     * the poison it would drop/abort and returns a zeroed report.
     */
    dryRun?: boolean;
  },
): Promise<{ markerStashesDropped: number; rebaseAborted: boolean }> {
  let markerStashesDropped = 0;

  if (dryRun) {
    return detectOnlyReport({ baseWorktree, git });
  }

  const listResult = git(['-C', baseWorktree, 'stash', 'list']);
  if (listResult.status === 0) {
    // Drop in DESCENDING index order. Each `git stash drop` renumbers the stack
    // below the dropped ref, so dropping a higher index first leaves every
    // lower index pointing at the same stash it named at list time. Dropping
    // ascending (the naive top-down pass) would renumber the stack out from
    // under the remaining refs and drop the wrong stash — destroying a
    // non-marker stash (SC3) and leaving a marker behind. Two-or-more marker
    // stashes is exactly the compounding case the mission describes, so this
    // ordering is the bug fix, not decoration.
    for (const { ref } of listMarkerStashes(listResult.stdout).sort((a, b) => b.index - a.index)) {
      const drop = git(['-C', baseWorktree, 'stash', 'drop', ref]);
      if (drop.status === 0) {
        markerStashesDropped += 1;
        fmt.log.info(`[REPAIR] Dropped stale integration stash: ${ref}`);
      } else {
        fmt.log.warn(`[REPAIR] Could not drop stale integration stash ${ref}: ${[drop.stdout, drop.stderr].filter(Boolean).join(' ').trim()}`);
      }
    }
  }

  let rebaseAborted = false;
  // ponytail: the live-rebase check re-runs `git rebase --show-current`; it is
  // cheap and git's own in-progress signal, so a second call here is fine.
  if (liveRebaseInProgress(baseWorktree, git)) {
    fmt.log.info(`[REPAIR] Live rebase detected in ${baseWorktree}; aborting the interrupted integration rebase.`);
    const abort = git(['-C', baseWorktree, 'rebase', '--abort']);
    if (abort.status !== 0) {
      fmt.log.warn(`[REPAIR] git rebase --abort did not clear the rebase state; forcing git reset --hard HEAD.`);
    }
    // Clear any residual unmerged index entries the dead replay left behind. The
    // rebase directory's presence guarantees HEAD is a valid reset target.
    const reset = git(['-C', baseWorktree, 'reset', '--hard', 'HEAD']);
    if (reset.status !== 0) {
      fmt.log.warn(`[REPAIR] git reset --hard HEAD failed: ${[reset.stdout, reset.stderr].filter(Boolean).join(' ').trim()}`);
    }
    rebaseAborted = true;
  }

  return { markerStashesDropped, rebaseAborted };
}

/**
 * Detect-only sweep (dry-run): report what *would* be repaired without touching
 * the base worktree. Reuses the same marker-stash scan (descending order is a
 * no-op with no drops) and the same live-rebase signal, but mutates nothing —
 * this is what `px integrate --dry-run` exercises so the non-mutating contract
 * holds (F2, task-2532 round 1).
 */
async function detectOnlyReport({ baseWorktree, git }: { baseWorktree: string; git: IntegrateGitRunner }): Promise<{ markerStashesDropped: number; rebaseAborted: boolean }> {
  let detectedStashes = 0;
  const listResult = git(['-C', baseWorktree, 'stash', 'list']);
  if (listResult.status === 0) {
    for (const { ref } of listMarkerStashes(listResult.stdout)) {
      detectedStashes += 1;
      fmt.log.info(`[REPAIR:dry-run] Would drop stale integration stash: ${ref}`);
    }
  }

  let detectedRebase = false;
  if (liveRebaseInProgress(baseWorktree, git)) {
    detectedRebase = true;
    fmt.log.info(`[REPAIR:dry-run] Would abort live rebase in ${baseWorktree} and clear the unmerged index.`);
  }
  if (detectedStashes === 0 && !detectedRebase) {
    fmt.log.info(`[REPAIR:dry-run] No integration-owned poison detected in ${baseWorktree}.`);
  }
  return { markerStashesDropped: detectedStashes, rebaseAborted: detectedRebase };
}

/**
 * The injection seam `runIntegration` binds. Kept as a factory for consistency
 * with the other `create*` factories under `./integrate/`, though the repair
 * currently needs no ports.
 */
export function createBaseWorktreeRepair(_ports: unknown) {
  return { repairBaseWorktree };
}
