# Mission: Enforce local-only development — no GitHub pushes on mission branches (task-2237)

## Goal

Eliminate all Git pushes to the `origin` (GitHub) remote from the parallix workflow on mission branches. Only the `main` branch may be pushed to GitHub. Mission branches remain local-only, with the `review` (Forgejo) remote as the sole push target for code review. Add a hard git push rule and update agent instructions so the constraint is enforced automatically and documented for all agents.

## Why Now

Recent mission branches have been pushed to GitHub despite the intent that parallix operates as a local-only development tool. The `px checkpoint` command (`lib/commands/checkpoint.ts:70`) pushes every checkpoint commit to `origin`, creating unnecessary remote clutter and misleading agents into thinking GitHub is an active push target. The user has observed this pattern and wants it stopped immediately before more branches accumulate on GitHub.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one-line code removal in `lib/commands/checkpoint.ts:70`, one-line tracking ref update in `lib/tools/forgejo.ts:1005`, new AGENTS.md section, git push rule config, and optional GitHub branch cleanup

## Scope

- Remove `git push origin <branch>` from `lib/commands/checkpoint.ts:70` — the only code path that pushes mission branches to GitHub
- Update `resolveTrackingBranchSha` in `lib/tools/forgejo.ts:1005` to remove `refs/remotes/origin/` from candidate refs (or keep it as a read-only fallback but ensure no push path targets origin for mission branches)
- Add a new "Local-only development" section to `AGENTS.md` documenting that mission branches must never be pushed to `origin` (GitHub), and only `main` may be pushed to GitHub
- Configure a hard git push rule (`.git/info/exclude` or `receive.pushToCheck` or equivalent `.gitconfig` entry) that prevents non-main branches from being pushed to `origin`
- Clean up existing mission branch history on GitHub where possible (delete `mission/*` branches from the `origin` remote)

## Out of Scope

- Modifying the Forgejo review push logic (`pushReviewRef`, `createPr`, `syncPrimaryBaseline`) — these already push to the `review` remote correctly
- Changing the `origin` remote URL or removing the `origin` remote entirely
- Modifying `lib/commands/stats.ts:1416` branch history lookup — read-only reference, no push involved
- Changes to the `review` remote configuration or Forgejo Docker setup

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `lib/commands/checkpoint.ts` contains zero `git push origin` calls; the checkpoint flow stages, commits, and completes without pushing to any remote
- SC2: `resolveTrackingBranchSha` in `lib/tools/forgejo.ts` does not include `refs/remotes/origin/` in its candidate refs list for mission branch resolution, or if retained as a read-only fallback, no push path in `lib/` targets `origin` for non-main branches
- SC3: `AGENTS.md` contains a "Local-only development" section that explicitly states: (a) mission branches must not be pushed to `origin` (GitHub), (b) only `main` may be pushed to `origin`, (c) the `review` (Forgejo) remote is the sole push target for mission branches
- SC4: A hard git push restriction is configured that prevents `git push origin <non-main-branch>` from succeeding (verifiable by running `git push origin mission/test-branch` and observing rejection)
- SC5: Existing `mission/*` branches on the `origin` remote are deleted, or a documented rationale exists for any branches intentionally retained

## Risks and Assumptions

- Risk: Removing the push from `px checkpoint` may break existing workflows that depend on the origin remote having up-to-date mission branch state. Mitigation: `resolveTrackingBranchSha` fallback and `stats.ts` branch lookup are read-only and will adapt to the absence of origin mission branches
- Risk: The git push rule may interfere with manual `git push origin main` operations. Mitigation: the rule is scoped to non-main branches only; `main` push remains unrestricted
- Assumption: No external tooling or CI/CD pipeline depends on mission branches existing on the GitHub `origin` remote
- Assumption: The `origin` remote URL (`https://github.com/oxtan-maker/parallix.git`) remains configured; we are only restricting push behavior, not removing the remote

## Checkpoints

- CP 1: Remove `git push origin` from `lib/commands/checkpoint.ts` and update `resolveTrackingBranchSha` in `lib/tools/forgejo.ts` — verify with `./scripts/verify-local.sh static-analysis`
- CP 2: Add "Local-only development" section to `AGENTS.md` and configure the hard git push rule for `origin` — verify with `./scripts/verify-local.sh all`
- CP 3: Clean up existing `mission/*` branches on `origin` (GitHub) and perform end-to-end verification of the checkpoint command without origin push

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/checkpoint.ts:70` (must point to an existing file and line)
  2. **Test names** — e.g., `"checkpoint command stages and commits without pushing to origin"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/checkpoint.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0045` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `git push origin mission/task-2237` ``, or `` `node px.js checkpoint task-2237 "test" "next"` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Checkpoint no longer pushes to origin | `lib/commands/checkpoint.ts:70` — line removed | PASS |
| Tracking ref no longer checks origin | `lib/tools/forgejo.ts:1005` — `refs/remotes/origin/` removed from candidates | PASS |
| Verification gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates

- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `lib/tools/forgejo.ts` functions `pushReviewRef`, `createPr`, `syncPrimaryBaseline`, `ensureRemoteBaseBranch` — these push to the `review` remote and must not be modified
- `workflow.config.json` review adapter configuration — the Forgejo setup is working correctly and is out of scope
- `lib/core/git.ts` — the low-level git runner should not be modified; changes are at the command level
- `lib/commands/stats.ts:1416` — read-only branch history lookup, no push involved

## Stop Rules

- Do not modify any Forgejo review push logic; this mission only touches the `origin` push path
- Do not remove or rename the `origin` remote; only restrict what can be pushed to it
- If the git push rule cannot be configured as a hard restriction (e.g., no suitable `.gitconfig` or server-side rule), document the limitation in `AGENTS.md` and proceed with instruction-based enforcement only
- Do not create an ADR for this change; update `AGENTS.md` instead
- If existing `mission/*` branches on `origin` cannot be deleted (e.g., protected branches), document which ones are retained and why
