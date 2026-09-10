# Mission: make the missing-files commit handle all files (task-2480)

## Goal
Relax the missing-files auto-commit path in `repairHandoff` (`src/adapters/cli/commands/repair-handoff.ts`) so that, when a mission worktree has uncommitted (dirty) files at handoff, it stages and commits **every** dirty file in **any** git status — not only mission artifacts and the narrow `isRepoLocalImplementationPath` allowlist. Remove the restrictive allowlist filter (`isSafeToCommit`) that currently rejects files under `src/`, `docs/`, `graphify-out/`, `backlog/completed/`, and any other path, and replace it with a single "stage all non-conflicted dirty files" step. Conflicted / unmerged files (`DD, AU, UD, UA, DU, AA, UU`) remain excluded and still surface a blocker.

## Why Now
`repair-handoff` is the narrow auto-repair path described in ADR 0048. It currently auto-commits only (a) mission artifacts via `missionUtils.isMissionArtifact` and (b) files the `isRepoLocalImplementationPath` allowlist permits (`lib, test, scripts, config, prompts, templates, examples, data` dirs plus `px.ts, px.js, index.js, package.json, package-lock.json, tsconfig.json, eslint.config.js`). Any dirty file outside that allowlist hits the `dirty files include non-mission paths` blocker and the handoff strands for human intervention. Agents forget to commit any file, in any directory and any git state, so the allowlist is a hallucinated guard: it excludes real work files (e.g. `src/`, `docs/`, `graphify-out/`) that must be captured. Making the commit handle all files removes the manual catch-up the operator otherwise has to do.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single-file behavior gap in the auto-repair path; direct follow-on to ADR 0048's fail-closed harness policy; low blast radius because it is scoped to an isolated mission worktree.

## Scope
- Modify `src/adapters/cli/commands/repair-handoff.ts`: replace the `isSafeToCommit` allowlist decision with a stage-all step that `git add`s every dirty file from the `git status --porcelain` output (after the existing conflicted/unmerged exclusion), then commits once.
- Keep the existing conflicted/unmerged exclusion (`DD, AU, UD, UA, DU, AA, UU`) and the existing `isBehind` auto-rebase step intact.
- Preserve the commit message shape `workflow(<slug>): auto-commit mission artifacts before handoff` and the `{ repaired, blocker }` return contract.
- Update the existing bounded-commit test `test/task-2202-repair-handoff-autocommit.test.ts` only if its fixture now commits more than it asserted; add a new test that asserts files previously rejected (`src/`, `docs/`, `graphify-out/`, `backlog/completed/...`) are now committed.
- Update authored documentation/ADR only if user-visible handoff behavior changes (ADR 0048 inventory row #6/#9 scope).

## Out of Scope
- Changing which failure classes are auto-repairable (ADR 0048 classification stays as-is; `InfraBlocker`/Forgejo blockers still require human intervention).
- Adding new commit message formats, new CLI flags, or new configuration.
- Touching the rebase path, the relaunch-prompt path, or `failure-classification.ts`.
- Any change to `src/domain/`, `src/composition/`, or the web/TUI interfaces.
- Persisting a global allowlist/denylist; the point of this task is to have no per-file allowlist.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no subjective adjectives or vague quantifiers.

- After the change, `repairHandoff('task-2480', <worktree>, <gitBlockerMsg>)` on a worktree whose `git status --porcelain` contains dirty files under `src/`, `docs/`, `graphify-out/`, and `backlog/completed/` returns `{ repaired: true, blocker: null }` and produces exactly one commit whose message matches `^workflow\(task-2480\): auto-commit mission artifacts before handoff$`.
- On the same worktree, if any dirty file is in a conflicted/unmerged status (`DD, AU, UD, UA, DU, AA, UU`), the call returns `{ repaired: false, blocker: <string containing "Conflicted files"> }` and stages zero files (no commit).
- The existing test `repairHandoff auto-commits bounded implementation files for active-step handoff repair` in `test/task-2202-repair-handoff-autocommit.test.ts` still passes unchanged in expectation (its fixture files are a subset of all files and are still committed).
- `npm test` passes with no new failures and no `.only`/bare `.skip` introduced (test-hygiene clean).
- `./scripts/verify-local.sh all` passes on the final tree with captured proof.

## Risks and Assumptions
- Committing all dirty files could capture unintended files. Mitigation: this runs only inside an isolated mission worktree on a git blocker, and conflicted/unmerged files are still excluded. Do not add a broad allowlist back — that is the bug being fixed.
- Assumption: the operator's intent (per backlog task) is that agents never need human interruption for a forgotten commit, so no per-file approval step is added.
- Assumption: `git status --porcelain` porcelain format is the source of truth; renames (`->`) are already parsed by the existing `parsePorcelainPath`.

## Checkpoints
- CP 1: Author a failing test under `test/` that asserts a previously-rejected path (e.g. `src/adapters/cli/commands/repair-handoff.ts` or `graphify-out/graph.json`) is auto-committed at a git-blocker handoff; it must fail (red) against the current code and pass after the fix.
- CP 2: Relax the guard in `src/adapters/cli/commands/repair-handoff.ts` — remove the `isSafeToCommit`/`isRepoLocalImplementationPath` allowlist branch and stage all non-conflicted dirty files in one `git add` + single commit; the CP-1 test turns green.
- CP 3: Run `./scripts/verify-local.sh all`, confirm the existing `task-2202` test still passes, and update ADR 0048 / docs only if handoff behavior changed.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2202-repair-handoff-autocommit.test.ts` ``, `` `./scripts/verify-local.sh all` ``, or `` `node --import tsx test/e2e-mission-lifecycle.test.ts` ``
  2. **Test names** — must match a real test name in the repo, e.g. `"repairHandoff auto-commits bounded implementation files for active-step handoff repair"`
  3. **Test file paths** — must be an existing test file, e.g. `test/task-2202-repair-handoff-autocommit.test.ts`
  4. **ADR references** — must correspond to an existing file under `docs/adr/`, e.g. `ADR 0048`
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. This is the weak-agent failure mode: raw `stat`/`ls` output or a prose claim like "the test passes" is NOT enough on its own — pair any shell output with one of the accepted references (a test name, test file path, ADR reference, or a backtick-wrapped `npm`/`node`/`git`/`px`/`./...` command).
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| All-file auto-commit covered by a failing-then-passing test | `test/task-2480-repair-handoff-all-files.test.ts`, `"repairHandoff commits src/docs/graphify-out files at git blocker"` | PASS |
| Previously-rejected paths now committed | `./scripts/verify-local.sh all` | PASS |
| Existing bounded-commit test not broken | `test/task-2202-repair-handoff-autocommit.test.ts`, `"repairHandoff auto-commits bounded implementation files for active-step handoff repair"` | PASS |
| Conflicted files still blocked | `test/task-2480-repair-handoff-all-files.test.ts`, `"repairHandoff blocks on conflicted files without committing"` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/domain/`, `src/composition/`, `src/interfaces/` (web + TUI)
- `src/application/failure-classification.ts` and `src/application/rebound-kernel.ts` (classification/relaunch behavior)
- Commit message format, CLI surface, and any new config/ADR gating beyond what this task changes.
- Do not push the mission branch to `origin` (main only); `review` remote is the sole review push target.

## Stop Rules
- Stop after CP 3 passes with `./scripts/verify-local.sh all` and the Goal Check table filled with accepted references.
- Do not add a global allowlist/denylist, new flags, or new failure-class handling — that re-introduces the bug.
- Do not implement beyond the mission: draft phase produces this contract only; do not edit source until execution begins.
- Stop and escalate if the existing `task-2202` test cannot pass without a scope change — that signals the out-of-scope boundary was crossed.
