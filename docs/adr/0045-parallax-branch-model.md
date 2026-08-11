# ADR 0045: parallix branch model and integration modes

Status: Proposed
Date: 2026-06-14

## Context

The parallix workflow manages mission branches (`mission/<slug>`) that agents create, develop on, and integrate back into a target branch. ADR 0043 established that local primary branches are the ancestry authority for workflow operations, but did not document the full branch lifecycle (draft → push → review → integrate → cleanup).

Two distinct integration modes coexist in the codebase:
1. Trunk-based: the mission branch integrates back into the repository's primary branch (`main` or `master`).
2. Feature-branch: the mission branch integrates back into a recorded feature branch, with the base branch detected and persisted at draft time.

Forgejo serves as a PR viewer and publication surface. The workflow does not require Forgejo to be configured as an upstream remote — all local branch operations (rebase, merge-base, integration) run against local branches. A dedicated `review` remote provides the push/fetch target for Forgejo synchronization.

## Decision

### Branch naming convention

Mission branches use the prefix `mission/` followed by the task slug:

```
mission/<slug>   (e.g., mission/task-1280)
```

The prefix is configurable via the `missions.branchPrefix` adapter setting, defaulting to `mission/`. The naming is produced by `missionBranchName(slug)` and referenced throughout the workflow as the canonical mission branch identifier.


### Base worktree naming convention

Base feature-branch worktrees use a conventional path derived from the same `worktreePattern` used for mission worktrees. The base branch name is slug-sanitised (`/` → `-`) and prefixed with `base-`:

```
../<repo>-base-<sanitized-branch>
```

This ensures base worktrees are discoverable and removable with existing worktree tooling, and never collide with mission worktrees.


### Integration mode 1: Trunk-based

In trunk-based mode, the mission branch integrates back into the repository's primary branch (`main` or `master`). This is the default mode and covers every pre-existing mission.

Lifecycle:

1. **Draft**: `mission/<slug>` is created from the primary branch (`main`/`master`). No `Base-Branch:` line is written to MISSION.md because the base equals the primary.
2. **Development**: Agents work on the mission branch in the mission worktree.
3. **Rebase**: The mission branch is rebased onto the local primary branch (ADR 0043 local-first rule). The workflow may fetch `review/<primary>` for remote visibility but the rebase target is the local primary ref.
4. **Integration**: The mission branch is squash-merged into the primary worktree on `main`/`master`. A Forgejo PR already marked merged fails preflight; the workflow only lands through Variant B (local squash-merge).

Branch flow:

```
main ──────■──────────────────■── main (after squash-merge)
           \                /
            ■── mission/<slug> ─■
```


### Integration mode 2: Feature-branch

In feature-branch mode, the mission branch integrates back into a recorded feature branch. The base branch is detected at draft time, persisted in MISSION.md, and used throughout the mission lifecycle.

Lifecycle:

1. **Detect**: At draft time, `detectLaunchBaseBranch()` reads `git branch --show-current` to determine which branch HEAD is on. It refuses to nest missions on a `mission/*` branch and returns `null` when HEAD is detached (falling back to primary).
2. **Record**: `ensureMissionBaseBranchRecorded()` writes a single `Base-Branch: <branch>` line into MISSION.md. This line is idempotent — a no-op when the base equals the primary, and re-asserted after the draft agent runs.
3. **Create**: The mission branch `mission/<slug>` is created from the recorded base branch as its start point.
4. **Development**: Agents work on the mission branch in the mission worktree.
5. **Resolve**: `resolveMissionBaseBranch()` returns the recorded `Base-Branch:` value. `resolveBaseWorktree()` resolves or auto-creates the base worktree on the recorded branch.
6. **Integration**: The mission branch is squash-merged into the **base worktree** on the recorded base branch (not the primary worktree). A Forgejo PR already marked merged fails preflight here too; the workflow only lands through Variant B.

Branch flow:

```
feature ─■────────────────■── feature (after squash-merge)
         \              /
          ■── mission/<slug> ─■
```


### Forgejo role: PR viewer, not branch authority

Forgejo is strictly a PR viewer and publication surface. The workflow does not require Forgejo to be configured as `origin` or any upstream remote.

Key behaviors:

- **`syncPrimaryBaseline()`**: Before PR creation, the workflow pushes the local primary branch to Forgejo's copy of `main`/`master` via an authenticated URL. This keeps the Forgejo review surface current.
- **PR creation**: `createPr()` resolves the PR base (recorded feature base, else primary), syncs the primary baseline, pushes the mission branch via an authenticated one-off URL, and POSTs the PR with the resolved base.
- **Bypassable**: When `isForgejoReviewEnabled` is `false`, all Forgejo sync paths in `integrate` and `rebase` are skipped. The workflow operates entirely on local branches and worktrees.


### The `review` remote

The `review` remote is a named git remote that serves as the push/fetch target for Forgejo synchronization. It is configured via `workflow.config.json` → `adapters.review.remote` (value `"review"` by default).

Operations:

- **Push**: `pushReviewRef()` executes `git push review <src>:<dst>` to push refs to the Forgejo-hosted repo.
- **Fetch**: `fetchReviewBranch()` executes `git fetch review +refs/heads/<branch>:refs/remotes/review/<branch>`, or uses an authenticated URL when a token is supplied.
- **Delete**: `deleteReviewRef()` removes refs from the review remote.
- **Setup**: `setup-review.js` creates or updates the remote via `git remote add/set-url <remote> <url>`.

The remote name is resolved from `adapters.review.remote || 'review'` via `resolveReviewAdapter()`.


### Rebase target (ADR 0043 invariant)

The `rebase` command fetches `review/<primary>` for remote visibility updates but rebases the mission branch onto the **local** primary branch. This is the ADR 0043 local-first invariant, ensuring rebase and integrate use the same ancestry target.


## Decision matrix

| Aspect | Trunk-based mode | Feature-branch mode |
|--------|------------------|---------------------|
| Mission branch | `mission/<slug>` | `mission/<slug>` |
| Integration target | Primary `main`/`master` | Recorded `Base-Branch` |
| Integration worktree | Primary worktree | Base worktree (`<repo>-base-<branch>`) |
| Base detection | Implicit (primary) | Explicit (`detectLaunchBaseBranch`) |
| Base persistence | No `Base-Branch:` line | `Base-Branch:` line in MISSION.md |
| Default mode | Yes (all pre-existing missions) | No (opt-in via draft context) |
| Preflight check | N/A | Verifies base branch exists locally |
| Code path overlap | 80%+ (same integrate/rebase commands) | Branch resolution differs at `resolveMissionBaseBranch` |

## Consequences

### Positive

- **Single source of truth**: The branch model is documented as a durable lifecycle, rather than as an implementation index.
- **Forgejo is not a hard dependency**: The workflow can operate entirely offline (local rebase, local squash-merge) when Forgejo is unavailable or disabled.
- **Feature-branch mode is explicit**: The documented flow clarifies how missions on feature branches integrate back, including the auto-creation of base worktrees.
- **Backward compatible**: Every pre-existing mission follows the trunk-based path byte-identically, since `resolveMissionBaseBranch` falls back to `getPrimaryBranch()` when no `Base-Branch:` line exists.
- **Preflight safety**: Mission-start verifies the base branch exists locally, preventing late integration failures.

### Negative

- **Base worktree management**: Feature-branch mode introduces a second worktree per mission (mission worktree + base worktree), increasing storage and checkout overhead.
- **Stale base risk**: If the base branch is deleted or the base worktree becomes stale, `resolveBaseWorktree` throws an error rather than recovering gracefully.
- **Documentation coupling**: Changes to this lifecycle's supported behavior must update this ADR.

### Open questions

- What happens when the base worktree is removed externally (e.g., manual `git worktree remove`)? The current code auto-recreates it on the next integration attempt.
- Does the workflow need a cleanup command for base worktrees, analogous to mission worktree removal?
- Should `Base-Branch:` be cleared when a mission transitions from feature-branch to trunk-based mode?

## Alternatives considered

| Alternative | Description | Why rejected |
|-------------|-------------|--------------|
| Forgejo as upstream | Configure Forgejo as `origin` and derive all branch operations from it | Adds unnecessary network dependency; local-first model is simpler and more resilient |
| Single integration mode | Support only trunk-based integration | Feature-branch mode is actively used and works correctly in code; documenting it prevents future confusion |
| Remote-tracking as authority | Use `review/<primary>` as the rebase/integrate target | Causes split-brain between rebase and integrate (ADR 0043); stale remote refs produce incorrect ancestry |
| Separate workflow for feature branches | Maintain a distinct workflow path for feature-branch missions | 80%+ code overlap; a unified flow with conditional base resolution is simpler and more maintainable |
| Forgejo as PR author | Have Forgejo create PRs programmatically | Forgejo is sufficient as a viewer; PR creation via authenticated push + API POST achieves the same outcome without platform dependency |

## Links

- `docs/adr/0043-git-target-resolution-strategy.md` — ADR 0043: local-first git target resolution
