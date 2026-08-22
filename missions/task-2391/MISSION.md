# Mission: Make Bubblewrap support linked-worktree Git mutations (task-2391)

Base-Branch: friday-08-21

## Goal

Make the shared Bubblewrap profile (`src/adapters/process/bubblewrap.ts`) resolve
and authorize every Git metadata location an implementer needs to mutate its
mission branch inside a **linked** Git worktree, without assuming `.git` is a
directory inside the checkout.

Parallix mounts the mission worktree writable over a read-only host root. In a
linked worktree, `git rev-parse --git-dir` / `--git-common-dir` resolve *outside*
the checkout — to `<repo>/.git/worktrees/<name>` (per-worktree dir holding
`index.lock`, refs, `rebase-merge`, etc.) and to the shared `<repo>/.git` — while
`--git-toplevel` resolves to the **parent** repo root, which stays under the
read-only `--ro-bind /`. The current guard only binds the worktree, so an
implementer-side `git add`/`commit`/`rebase` fails with
`index.lock: Read-only filesystem` and cannot lock `<repo>/.git/config`.

The fix derives the writable Git metadata mounts from Git itself and adds them to
the implementer (`active`/`draft`/`execute`/`act-on-review`) profile only, so a
confined implementer can stage, commit, and continue a rebase in a linked
worktree. Reviewer profiles stay read-only for reviewed source **and** Git state.

## Why Now

TASK-2386 and TASK-2387 independently hit the same wall: a Bubblewrap-confined
implementer can edit files but cannot `git add`/`commit`/`rebase` because the
guard never grants the worktree-scoped Git metadata. The checkpoint repair loop
relaunches agents that write more files but still cannot commit them, so the
blocked TASK-2386 (prompt/watchdog) and TASK-2387 (board publication) worktrees
cannot be rebased or resumed. This is a hard infrastructure block on the shared
launch boundary established by TASK-2374 (bubblewrap guard) and extended by
TASK-2383 (review launcher state homes).

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: regression block on linked-worktree Git mutations; shared
  Bubblewrap launch boundary; fail-closed sandbox invariant

## Scope

Do the work inside these boundaries:

- `src/adapters/process/bubblewrap.ts` — the single Bubblewrap decision point.
  Add Git-metadata resolution and mounting for the implementer profile. This is
  the only production file that changes behavior.
- `src/adapters/git/` — read-only reference for how Git paths are already
  resolved (`git.ts`, `agent-worktree.ts` use `git rev-parse
  --absolute-git-dir`, `--git-common-dir`, `--path-format=absolute`). Reuse the
  same invocation style; do not introduce a new Git abstraction.
- `test/bubblewrap-guard.test.ts` and a new regression test — focused, hermetic
  coverage that never invokes a real agent CLI or Forgejo.

Constrain the writable grant to:
- the mission worktree (already granted for implementer steps), and
- the exact per-worktree Git dir and shared Git common dir that `git` resolves
  for **this** worktree.

Do not grant the checkout parent, home directory, or any unrelated host path.

## Out of Scope

- TASK-2386 prompt/watchdog work and TASK-2387 board publication work.
- Handoff retry / classification changes.
- Any change to `src/adapters/agents/agents.ts` beyond what the single shared
  launch seam already does (the profile is resolved there; the fix lives in the
  guard, not the caller).
- New dependencies, new Git adapter methods, or new ADRs.
- Changing the unavailable-vs-broken-guard distinction, the
  `PARALLIX_NO_BUBBLEWRAP` escape hatch, or the argument-array / fail-closed
  contract from TASK-2374.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no
> unmetriced adjectives or vague quantifiers.

- SC1 A deterministic regression under `test/` creates a real temporary linked
  Git worktree and fails (red) at the mission parent commit when an implementer
  step runs `git add`/`git commit` inside the constructed Bubblewrap command,
  then passes (green) after the fix. Falsified if the test passes at the parent
  commit or does not exercise a real linked worktree.
- SC2 Every implementer-capable step (`draft`, `execute`, `act-on-review`,
  `active`) can run a real `git add` + `git commit`, and continue a real
  `git rebase --continue`, inside a linked worktree under the confined command.
  Falsified if any implementer step's mutation exits non-zero under the guard.
- SC3 Git metadata mounts are derived from Git-resolved absolute paths
  (`git rev-parse --absolute-git-dir` and `--git-common-dir`) and are present in
  the built argument array for a linked worktree whose `.git` is a file under
  `<repo>/.git/worktrees/<name>`, not from an assumption that `.git` is a
  directory inside the checkout. Falsified if the built args omit the resolved
  common dir or per-worktree git dir, or if the test relies on `.git` being a
  directory.
- SC4 Mount construction remains argument-array based, dedupe-safe, and correctly
  ordered for nested paths (the per-worktree git dir lives beneath the common
  dir, which lives beneath the read-only parent). Falsified if a broader bind
  shadows a nested git mount, if a duplicate/nested bind widens a permitted
  host path, or if paths are shell-concatenated instead of passed as argv
  entries.
- SC5 The writable grant is limited to the mission worktree and the Git metadata
  of the current mission worktree; it does not make the checkout parent or
  unrelated host paths writable. Falsified if the built implementer args bind a
  path outside the worktree's resolved git dir / common dir / worktree.
- SC6 Reviewer profiles remain read-only for reviewed source **and** Git state:
  a focused test proves a reviewer step cannot stage or commit (the built
  reviewer args do not grant the common dir or per-worktree git dir writable, and
  a reviewer `git add`/`git commit` under the guard fails). Falsified if any
  reviewer writable bind covers the git common dir or per-worktree git dir, or if
  a reviewer mutation succeeds.
- SC7 All agent families continue through the single shared Bubblewrap launch
  seam; the unavailable, explicitly disabled (`PARALLIX_NO_BUBBLEWRAP`), and
  broken-guard behaviors are unchanged. Falsified if a family bypasses the seam
  or if the broken-guard no longer fails the launch.
- SC8 Focused Bubblewrap tests and `./scripts/verify-local.sh static-analysis`
  pass on the final tree. Falsified if the gate reports errors or if a focused or
  unannotated skipped test is introduced.

## Risks and Assumptions
- The mission worktree may be a linked worktree (`.git` is a file) or the main
  checkout (`.git` is a directory). The guard must handle both without assuming
  one layout. Assumption: `git rev-parse --absolute-git-dir` /
  `--git-common-dir` always resolve under the primary repository when a worktree
  is in use.
- `--git-toplevel` resolves to the **parent** repo root, not the worktree, so the
  worktree bind alone never covers the metadata. This is the root cause, not a
  symptom.
- Resolving Git paths spawns `git`; keep it bounded, cached per common dir, and
  fail closed (bubble the resolution error into `BubblewrapGuardError`) rather
  than widening the mount set on a lookup miss.
- The writable grant must not leak to sibling worktrees or the shared storage of
  an unrelated repository. Assumption: the resolved common dir always belongs to
  the current mission repository.
- Reviewer isolation must survive even when a reviewer launcher writes state
  under the worktree's `.workflow/` (TASK-2383): those binds stay writable, but
  the Git metadata stays read-only.

## Checkpoints
- CP 1: Author the failing reproduction test that locks the bug (red), before any
  fix. Real linked worktree + confined `git add`/`git commit`.
- CP 2: Resolve and grant the Git metadata mounts for the implementer profile via
  Git-resolved absolute paths, keeping the argument-array / dedupe / ordering
  contract.
- CP 3: Prove reviewer isolation (read-only Git state) and confirm the shared
  launch seam, unavailable/disabled/broken-guard behaviors are unchanged.
- CP 4: Integrate — run the verification gate, capture proof, and write the final
  Goal Check table with durable evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references.
  Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/bubblewrap-worktree-git.test.ts` ``, `` `./scripts/verify-local.sh static-analysis` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — must match a real test name in the repo (e.g. the
     regression test you add under `test/`)
  3. **Test file paths** — e.g., `test/bubblewrap-worktree-git.test.ts`,
     `test/bubblewrap-guard.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file
     under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually
     rot; prefer the forms above
- Weak-agent failure mode: raw `stat`/`ls` output or generic prose alone is NOT
  enough. A screenshot of `git worktree list` or a paragraph saying "git now
  works" does not prove the fix. Pair any shell output with one of the accepted
  references above — quote the exact command you ran and its result, e.g.
  `` `bwrap --ro-bind / / --bind <commonDir> <commonDir> --bind <gitDir> <gitDir> --chdir <worktree> -- git commit -qm x` ``
  succeeding, or the exact `` `npm test -- test/...` `` line that went from red to
  green.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Regression test locks the linked-worktree git failure | `test/bubblewrap-worktree-git.test.ts`, `"implementer git add/commit succeeds in a linked worktree under bubblewrap"` | PASS |
| Static-analysis gate clean | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify any file outside `src/adapters/process/bubblewrap.ts`, the new
  regression test under `test/`, and `test/bubblewrap-guard.test.ts`.
- Do not touch `src/adapters/agents/agents.ts`, `src/adapters/process/spawn-tee.ts`,
  handoff/retry/classification code, board publication, or prompt/watchdog code.
- Do not add dependencies, new Git adapter methods, or new ADRs.
- Do not push the mission branch to `origin`; only `main` may go to `origin`.

## Stop Rules
- Stop before implementing; this draft phase produces the contract only.
- Do not author the fix during draft — the reproduction test and its
  `Reproduction-Test:` declaration are the only bug-specific drafting outputs.
- Do not run anything beyond the single `./scripts/verify-local.sh all` gate.
- Do not start a review, execute, or integrate phase.
- Do not spawn more than 2 parallel subagents; pause and wait if more are needed.
- Do not transition the task to `ready` yourself; the harness does that after a
  clean draft.

Reproduction-Test: test/bubblewrap-worktree-git.test.ts
