# ADR 0043: Git target resolution strategy for workflow branch operations

Status: Proposed
Date: 2026-05-24

## Context

`node workflow rebase` and `node workflow integrate` must reason about the same primary-branch target or they can compute different merge bases for the same mission branch. That drift is active in the current repo state: local `main` is at `7f0db085c`, while the local remote-tracking ref `review/main` is still at `f6318aa6f`, so the local branch is one commit ahead of the Forgejo-tracking copy.

Before this change, `workflow/lib/rebase.js` fetched `review/<primary>` but then rebased the mission branch onto `review/<primary>`. `workflow/lib/integrate.js`, by contrast, performs integration decisions from the local primary checkout. The result is a split-brain workflow:

- Rebase can move a mission branch onto stale Forgejo state.
- Integrate can then compare or merge against newer local state.
- The same mission can therefore produce different ancestry answers between rebase and integrate, including "unrelated histories" failures during later integration steps.

Forgejo PRs are remote objects, so Forgejo itself cannot literally target an unpublished local branch. The actual decision is therefore two separate questions:

1. Which git ref is authoritative for local branch-to-branch ancestry decisions inside the workflow CLI?
2. How should the workflow keep Forgejo's remote `main` aligned enough that PR diffs and review UI reflect the same baseline?

## Decision

Adopt a **local-first git target resolution rule** for workflow branch operations:

- Fetch `review/<primary>` when the workflow needs to refresh remote visibility.
- Use the local primary branch ref (`main` or `master`, via `getPrimaryBranch()`) as the authoritative target for `git rebase`, merge-base reasoning, and manual recovery instructions executed inside a local worktree.

## Invariants

Invariant 1: Any workflow command that performs a local branch-to-branch ancestry operation MUST target the local primary branch ref, not `review/<primary>`.

Invariant 2: Fetching `review/<primary>` MAY refresh remote state, but fetch success MUST NOT change the authoritative rebase or merge-base target away from the local primary branch.

Invariant 3: User-facing workflow instructions for manual recovery MUST name the same local primary branch target that the automated workflow path uses.

Invariant 4: Tests for workflow branch operations MUST encode the local-primary-target rule so remote-tracking refs cannot silently re-enter rebase-target expectations.

## Options considered

| Option | Branch authority | Publication surface | Human diff viewer | Review-round state owner | Benefits | Risks / Costs | Decision |
|--------|------------------|---------------------|-------------------|--------------------------|----------|---------------|----------|
| A | Local `main` | Forgejo-hosted repo | Forgejo PR UI | Workflow + repo artifacts | Preserves trunk-based worktree flow; keeps the current local-first PR UI; cleanly separates ancestry authority from publication; smallest migration cost | Workflow must implement explicit round semantics because Forgejo does not appear to provide strong per-revision reviewed-state tracking on its own | **Current baseline, but under-specified** |
| B | Local `main` | Forgejo-hosted repo | Forgejo PR UI | Forgejo comments/status only | Minimal new implementation; preserves current tooling | Leaves the known review-round gap unresolved; repeated review cycles still depend on comment discipline and rereading large PRs | Reject |
| A2 | Local `main` | Forgejo-hosted repo | Forgejo PR UI | Workflow as authoritative PR-handling owner; Forgejo mirrors workflow outcomes | Keeps the current Forgejo setup unchanged; lets workflow own round number, current side, disposition, and comment governance explicitly; resolves the known round-state gap without changing branch authority | Requires new workflow infrastructure and a transition period where workflow authority is introduced while Forgejo remains the published mirror | **Preferred implementation path** |
| C | Local `main` | GitHub mirror | Reviewable on top of GitHub PRs | Reviewable | Strongest documented revision-aware PR review surface; per-file/per-revision reviewed state; better handling of rebases and round-to-round diffs | Requires external-hosted mirror and GitHub coupling; moves away from the repo's current local-first review appliance model | Acceptable alternative if Forgejo + workflow-native rounds proves insufficient |
| D | Local `main` | GitHub mirror | Graphite on top of GitHub PRs | Graphite | Strong PR version comparison and reviewer workflow; explicit "hide reviewed changes" flow; likely better than vanilla PR UI for iterative review | GitHub-only; pushes the repo toward Graphite's stacked-review/product model; more product coupling than "viewer only" | Acceptable alternative if the repo wants stronger product-managed review rounds without leaving PRs |
| E | Local `main` | GitLab-hosted repo | GitLab merge request UI | GitLab MR versions | Built-in MR diff versions on each push; stronger built-in iteration model than baseline Forgejo/Gitea PRs | Platform migration cost; replaces a working local review surface; not clearly better than Reviewable for revision-aware review | Acceptable but lower-priority alternative |
| F | Hosted review repo | Gerrit-hosted repo | Gerrit UI | Gerrit patch sets | First-class patch-set review rounds and patch-set-to-patch-set diffs; strongest web-native review-round model in the research set | Requires workflow redesign around Gerrit semantics; changes branch/publication authority assumptions materially; larger migration than a viewer augmentation | Reject for this mission; candidate only for a deliberate review-system redesign |
| G | Local Git repo / patch series | Patch/email + Patchwork + `b4` | Patchwork web UI plus `b4` local tools | Patch series revisions | Most Git-native explicit round model; strong revision semantics via v1/v2/range-diff | Major cultural/tooling shift away from PR review; weaker fit if the repo wants a central visual PR surface | Reject for this repo's current operating style |
| H | Local `main` | None or minimal publication | Local tools only (`delta`, `difftastic`, scripts) | Workflow + local artifacts | Maximum authority clarity; no hosted-surface coupling; useful fallback if all hosted surfaces prove too weak | Loses centralized review UI and PR-status visibility; raises human coordination cost relative to current Forgejo workflow | Keep as fallback, not preferred primary model |
| I | `review/<primary>` or other hosted ref | Forgejo-hosted repo | Any | Any | Remote-tracking branch is explicit and visible | Diverges from local integration target; stale remote state can produce incorrect ancestry and "unrelated histories" errors | Reject |
| J | Conditional target (local only when remote lags) | Mixed | Mixed | Mixed | Attempts to preserve some remote-first behavior while avoiding obvious drift | Adds branching logic and ambiguity; still leaves the workflow without one invariant ancestry source | Reject |

### Option notes

- **Option A** intentionally splits responsibility:
  - local `main` remains the ancestry authority for `rebase`, merge-base reasoning, and integration preflight
  - Forgejo remains the hosted publication/review surface
  - workflow-owned state carries round number, current phase (`implementer` vs `reviewer`), and round-resolution summary
- **Option A2** is the concrete hardening of the current baseline:
  - workflow becomes the authoritative owner of PR round handling
  - Forgejo remains unchanged as the mirrored review surface
  - workflow publishes mirrored outcomes to Forgejo rather than reading Forgejo as the authority for PR-round state
  - the follow-up task tree for this path is `TASK-1143`, `TASK-1143.01`, `TASK-1143.02`, `TASK-1143.03`, `TASK-1143.04`, and `TASK-1143.05`
- **Option B** is the status-quo review model after the `rebase` fix. It is included because it is the cheapest path, but the repo already has evidence that comment-only round tracking is too weak for multi-round review ergonomics.
- **Options C/D/E** are "better hosted diff/review layers while keeping local branch authority." They should be compared on review-round quality, operational complexity, and whether the repo is willing to leave the current local-first review appliance model.
- **Options F/G** are "change the review model itself," not just the viewer.

## Consequences

### Positive

- Rebase and integrate use the same branch target for local ancestry operations.
- Manual recovery instructions become consistent with the automated path.
- Future regressions are easier to spot because the rule is explicit and testable.

### Negative

- Existing tests that hardcode `review/master` or `review/main` as the rebase target must be updated.
- Forgejo PR views can still lag behind local `main` until humans or later workflow steps push updated state to the remote.

## Alternatives and evidence

The active divergence data in this mission is already enough to reject the remote-tracking target as the workflow authority:

- Local `main`: `7f0db085c`
- `review/main`: `f6318aa6f`
- Divergence: local primary is 1 commit ahead

Option D was corrected during ADR review to mean: do not use `review/main` as a workflow authority at all; instead, keep Forgejo PRs based on Forgejo `main`, and sync that Forgejo `main` from the local `main` checkout before PR creation.

That model matches the existing implementation shape:

- `workflow/lib/forgejo.js:createPr()` resolves `primaryBranch`, calls `syncPrimaryBaseline()`, and creates the PR with `base: primaryBranch`.
- `syncPrimaryBaseline()` pushes local `main` to Forgejo `main` before PR creation, so the Forgejo review surface is refreshed from the local baseline.

Option D is therefore compatible with this ADR, but only as a review-surface rule. It does not replace the ancestry decision in Option A because:

- A PR base in Forgejo is still a remote branch, never an unpublished local commit.
- Local rebase and merge-base calculations must still rely on the local primary branch because they run before, during, or independently of remote sync.
- A failed sync can make the PR surface stale again, but it must not be allowed to change the local ancestry authority.

The resulting split of responsibility is deliberate:

- Local `main` is the authority for ancestry.
- Forgejo `main` is the published review baseline that should be synchronized from local `main` before PR creation or refresh.

### Source-backed review-surface comparison

This mission widened from "what should `rebase` target?" to "what combination of review surface, diff viewer, and round-state owner best fits the repo's trunk-based, worktree-heavy workflow?"

#### Forgejo / Gitea PR UI

Official docs show standard pull-request review capabilities: branch-based PRs, line comments, reviewer assignment, approvals / request changes, and reviewing a single commit inside a larger PR.

Inference: Forgejo is a capable **human diff viewer** and publication surface. The docs reviewed here do not show first-class per-revision reviewed-state tracking comparable to Reviewable, Gerrit patch sets, or GitLab MR diff versions. That makes it a good viewer but a weak sole owner of multi-round review state.

#### Reviewable

Official docs describe revision-aware review mechanics beyond standard PR UIs:

- diff any two revisions
- hide or ignore rebase-only / whitespace-only changes
- map comments across revisions
- track who reviewed which revision of each file

Inference: Reviewable is the strongest researched candidate if the repo wants a **PR-based review layer that natively owns revision-aware round tracking**.

#### Graphite

Official docs describe PR versions, explicit version-to-version comparison, and "hide reviewed changes" workflows for updates pushed after an earlier review.

Inference: Graphite is a strong candidate if the repo wants a more product-managed PR-round experience than Forgejo, but it comes with stronger workflow/product coupling than a pure viewer swap.

#### GitLab merge request versions

Official docs state that each push to an MR branch creates a new diff version and that versions can be compared.

Inference: GitLab has better built-in revision slicing than baseline Forgejo/Gitea PRs, but the migration cost is materially higher than retaining Forgejo and filling the round-state gap in workflow.

#### Gerrit patch sets

Official docs make patch sets first-class review-round objects and support comparing one patch set against another.

Inference: Gerrit is the strongest **web-native review-round model**, but adopting it would be a workflow redesign, not a diff-viewer improvement.

#### Patchwork + `b4`

Official docs show explicit patch-series state, revision tracking, delegates/action-required states, and local reviewer tooling with range-diff and "waiting on new revision" support.

Inference: this is the strongest **Git-native** review-round model but a major cultural and tooling shift away from PR-centric review.

#### Local diff tools: `delta` and `difftastic`

Both are valuable, but they solve a different problem:

- `delta` improves readability of line-based diffs
- `difftastic` improves structural/semantic readability

Inference: they are excellent complements to any review model and remain useful as local fallback tools, but they do not themselves solve hosted review-round state.

### Comparative conclusion

The current evidence supports three distinct conclusions:

1. **Local `main` should remain the ancestry authority.** No researched hosted diff/review layer changes the fact that local rebase and merge-base calculations must not depend on a stale hosted tracking ref.
2. **Forgejo remains viable as a human diff viewer.** The repo's current dissatisfaction is not with raw diff readability but with round-state semantics.
3. **The missing capability is review-round ownership.** The preferred path is therefore Option A2: keep the current Forgejo setup as the viewer/publication surface, but move PR-handling authority into workflow so workflow owns round number, active side, disposition, and comment governance. Stronger external products (Reviewable, Graphite, GitLab, Gerrit) remain valid alternatives if that workflow-owned state proves too custom or too weak in practice.

### Follow-up path

This ADR does not attempt to implement the new PR-handling authority model inside the current mission. The selected follow-up path is the workflow-owned authority task tree created from this mission:

- `TASK-1143` — workflow-owned PR handling authority with Forgejo as mirrored review surface
- `TASK-1143.01` — workflow PR authority model and round-state transitions
- `TASK-1143.02` — workflow comment governance and mirrored PR comment contract
- `TASK-1143.03` — workflow-to-Forgejo mirror contract for PR state publication
- `TASK-1143.04` — workflow command to launch the primary local diff tool for branch-vs-main review
- `TASK-1143.05` — transition plan from Forgejo-led PR history to workflow-owned PR authority

## Links

- `workflow/lib/rebase.js`
- `workflow/lib/integrate.js`
- `docs/missions/2026/task-1140/MISSION.md`
