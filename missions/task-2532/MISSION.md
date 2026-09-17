# Mission: Self-heal stale integration state in the base worktree before integrate (task-2532)

## Goal
Add one idempotent "repair the base worktree" step to the `px integrate` entry
chokepoint (`runIntegration` in `src/application/integrate-workflow.ts`, before
the stash/rebase steps) that scans the resolved base worktree for and safely
removes only integration-owned poison left by an interrupted integrate:

- integration-marked stashes whose message matches
  `integrate:<slug>: temporary integration checkout stash`
  (`stashMainCheckoutIfNeeded`, `src/adapters/cli/commands/integrate-conflict.ts`)
  → drop them with `git stash drop`. The sweep and the push must share the exact
  marker string (reuse the literal from `stashMainCheckoutIfNeeded`).
- a live `rebase-merge/` or `rebase-apply/` directory in the base worktree →
  `git rebase --abort` then `git reset --hard HEAD`, **only** when the directory
  is present.

So an interrupted integrate no longer poisons the base (primary) worktree: the
next `px integrate` for a *different* mission no longer aborts on the stale
marker stash or the dead-rebase "unmerged entries" preflight failure, and its
own abort no longer leaves more poison behind.

## Why Now
Interrupted `px integrate` runs leave poison in the base worktree. The next
`px integrate` for a different mission aborts on that stale state, and its own
abort leaves more of it behind — a compounding failure loop. In one incident a
mission was unblocked only by manually dropping a dead stash, aborting a dead
`rebase-merge`, and `git reset --hard`. Integration currently assumes the base
worktree is clean at entry (ADR 0043 resolves the base branch and immediately
stashes + rebases) and has no idempotent repair step.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: compounding integration aborts from leftover integration-owned
  stash + dead-rebase state; single chokepoint fix; reuse existing markers/ports.

## Scope
- New recovery routine that scans the resolved base worktree and drops only
  marker-tagged integration stashes and aborts only live `rebase-merge/` /
  `rebase-apply/` directories with an unmerged index.
- Wire the routine into `runIntegration` (`src/application/integrate-workflow.ts`)
  before the stash (`stashMainCheckoutIfNeeded`) and rebase
  (`runIntegrationRebase`) steps — the single `px integrate` entry chokepoint,
  not a per-mission-branch path.
- Share the marker literal with `stashMainCheckoutIfNeeded` so sweep and push
  agree on the identifier.
- A failing reproduction test under `test/` that locks both failure modes
  (red at the parent commit, green once the fix lands).
- Docs updated for the new preflight repair behavior.

## Out of Scope
- The agent-smoke gate and `RUN_TIMEOUT_MS`; the local-model timeout gate is
  operator environment, out of scope.
- Weakening or restructuring the existing stash/restore pair
  (`stashMainCheckoutIfNeeded` / `restoreMainCheckoutStash`) or the
  probe-merge conflict path (`probeMerge`, `src/application/integrate/landing.ts`).
- Any recovery that acts outside the resolved base worktree.
- Fixing the root abort ordering that leaves the poison behind; this mission
  heals the consequence at entry so later missions are not blocked.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** each criterion is falsifiable; no
> unmetriced adjectives, no vague quantifiers.

- SC1 An interrupted integrate that left a marker-tagged stash in the base
  worktree no longer blocks a later `px integrate` for a different mission: the
  stale marker stash is dropped and preflight proceeds with zero failures.
- SC2 An interrupted integrate that left a live `rebase-merge/` or
  `rebase-apply/` directory plus an unmerged index is repaired on the next
  integrate (rebase aborted, index cleared) and preflight no longer reports the
  `main-index-conflicts` / `rebase-in-progress` failure.
- SC3 A stash whose message does not match the integration marker
  `integrate:<slug>: temporary integration checkout stash` is never dropped by
  the sweep (assert the non-marker stash is still present after the sweep).
- SC4 A base worktree that is already clean is unaffected: no stash is created,
  no `git reset` runs, no rebase is started (assert the stash list, the set of
  `rebase-*` directories, and `git log -1` are unchanged by the sweep).
- SC5 Recovery runs **before** the stash/rebase steps at the single integration
  entry chokepoint (`runIntegration`), not in a per-mission branch.
- SC6 The existing stash/restore pair and the probe-merge conflict path
  (`probeMerge`, `src/application/integrate/landing.ts`) are unchanged; the
  existing integrate suites still pass.
- SC7 Lint and static analysis report clean on every changed file
  (`./scripts/verify-local.sh static-analysis`).

## Risks and Assumptions
- The sweep must match the marker **exactly**, including the `integrate:<slug>:`
  prefix; a loose match risks dropping another agent's real stash. Assumption:
  `git stash list` messages are stable enough to match against.
- `git reset --hard HEAD` is only safe inside a base worktree that actually
  contains a live `rebase-merge/` / `rebase-apply/` directory. Assumption: the
  presence of that directory means HEAD is a valid reset target (it always is,
  because a rebase in progress leaves HEAD on the original branch tip).
- Recovery acts only in the resolved base worktree (`context.baseWorktree`),
  never in a mission worktree or the caller's cwd.
- The recovery is read-only-to-safety: it only ever touches integration-owned
  markers and integration-owned rebase state.

## Checkpoints
- CP 1: Author the failing reproduction test that locks both failure modes
  (red at the parent commit) — the first checkpoint, before any fix.
- CP 2: Implement the base-worktree recovery routine and share the marker with
  `stashMainCheckoutIfNeeded`.
- CP 3: Wire the routine into `runIntegration` before the stash/rebase steps.
- CP 4: Verify — reproduction test goes green, existing integrate suites and
  static analysis stay clean, docs updated.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references.
  Parallix verifies today using these forms (use them first):
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2532-stale-integration-state-repro.test.ts` ``, `` `px integrate <slug> --dry-run` ``, `` `./scripts/verify-local.sh all` ``, `` `git -C <baseWorktree> stash list` ``, `` `node --test test/...` ``
  2. **Test names** — the exact `test(...)` name in the repo, e.g. the reproduction
     test's own case names (must match a real test name in the repo)
  3. **Test file paths** — e.g., `test/task-2532-stale-integration-state-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0043` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually
     rot; prefer the forms above
- **Weak-agent failure mode (call this out explicitly):** raw `stat` / `ls`
  output or generic prose such as "the stash is dropped" or "the rebase is
  aborted" is **not** enough. Pair every claim with one of the accepted
  references above — e.g. capture the actual `` `git stash list` `` output **and**
  cite the reproduction test name that asserts the marker stash is gone; capture
  `` `git rebase --show-current` `` / `` `git ls-files -u` `` output **and** cite the
  test file path that asserts the index is cleared. A shell snippet standing alone
  is a claim, not evidence.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Never drop a stash whose message does **not** match
  `integrate:<slug>: temporary integration checkout stash`; other agents' real
  stashes must be untouched.
- Never `git reset --hard` or `git rebase --abort` outside a base worktree that
  actually contains a live `rebase-merge/` or `rebase-apply/` directory.
- Do not weaken the existing stash/restore pair
  (`stashMainCheckoutIfNeeded` / `restoreMainCheckoutStash`) or the
  probe-merge conflict path (`probeMerge`, `src/application/integrate/landing.ts`).
- Do not touch the agent-smoke gate or `RUN_TIMEOUT_MS`.
- Do not act outside the resolved base worktree (`context.baseWorktree`).

## Stop Rules
- Stop once CP 4 passes: reproduction test green, existing integrate suites
  pass, `./scripts/verify-local.sh all` and `./scripts/verify-local.sh
  static-analysis` clean, docs updated.
- Do not expand scope to fix the abort-ordering that leaves the poison behind.
- Do not push the mission branch to `origin`; only `main` goes to `origin` and
  only the `review` (Forgejo) remote is a push target for mission branches.
- Do not introduce focused or unannotated skipped tests (no `.only`, no bare
  `.skip`).
- Do not leave the reproduction test unregistered: if it crosses a real git
  boundary (it builds throwaway repos in a temp dir), register it in
  `test/lib/test-categories.ts` under the CI-safe list with a reason.

Reproduction-Test: test/task-2532-stale-integration-state-repro.test.ts
