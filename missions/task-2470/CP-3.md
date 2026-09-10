# CP-3 — Repair bounce 1/2: "Rebase failed before handoff"

## Summary

Handoff bounced this mission with `Rebase failed before handoff. Ensure the mission branch can be rebased onto the latest primary branch.`, classified `GateFailure — AutoSendBack`, retry 1/2. The rebase blocker is now cleared and verified. One pre-existing failure remains in `./scripts/verify-local.sh all`, and it is provably `main`'s, not this mission's; the exact diagnostic is recorded at the end.

### Root cause: a dirty non-mission file, not the 632-commit drift

CP-2 predicted the rebase would be the hard part and deliberately left `package-lock.json` unstaged to keep success criterion 6 clean. That decision was the actual cause of this bounce. The handoff rebase path (`Step 1.5`) begins with `commitSafeMissionArtifacts` in `src/adapters/review/rebase.ts`, which parses `git status --porcelain=v1 -z` and rejects the whole rebase when any dirty path fails its safety predicate:

```ts
const isSafeToCommit = (file: string) =>
  isWorkflowGeneratedArtifactFn(file)
  || isMissionArtifactFn(file, slug, rootDir)
  || !!(resolvedTaskFile && file === resolvedTaskFile);
```

`package-lock.json` is none of the three, so it landed in `unsafeFiles` and the function returned `{ ok: false, dirty: true, unsafe: true }`. Because that return carries `sharedFileConflicts: false`, `performHandoff` took the *generic* branch — `Rebase failed before handoff…` — rather than the `Rebase encountered shared-file conflicts` branch. That is why the diagnostic named the rebase rather than the dirty file: the message is a wrapper, and the real subject was one unstaged lockfile line.

The line itself was npm bin-path normalization inside the `pi-ai` package entry — `"pi-ai": "dist/cli.js"` → `"pi-ai": "./dist/cli.js"` — produced by a local `npm install`, not by any authored change.

### State found on reload

The reflog showed the rebase had in fact already completed before this repair turn: `rebase (start): checkout main` → one `rebase (continue)` on the first pick → `rebase (finish): returning to refs/heads/mission/task-2470` at `24f1a62a7`. The mission lineage was replayed onto `main` (`c37d13b02`), taking the branch from 632 commits behind to **0 behind / 8 ahead**, and the harness's `execute(task-2470): capture agent output` commit had absorbed the dirty lockfile, leaving the worktree clean.

Two consequences worth recording:

- **The inherited red gate from CP-2 is cured.** The rebase adopted `main`'s `docs/metric-contract.md`, which carries the `Throughput / weekly throughput` row that `395015b45 mission/task-2469` had dropped from this branch's old base. `npm test -- test/metric-contract.test.ts` now exits 0 (`✔ statistics metric contract names every board and CLI decision metric with its semantic inputs`, 1 pass / 0 fail). CP-2's preferred resolution — let the lifecycle rebase onto primary — is exactly what happened, and it needed no edit from this mission.
- **The README change survived intact.** `git diff main..HEAD -- README.md` is precisely the intended 19 insertions / 2 deletions: the `## Defence in depth` section (18 lines, 9 numbered items), the removed `## Current status` "**Review coverage**" bullet, and the extended `docs/adr/` documentation entry. No conflict touched it, `## Use cases` still reads `+57%` / `an order of magnitude`, and the reviewer-difference limitation now appears in `## What it does` and the new section only — the duplicate is still gone.

### Repair performed

Restored `package-lock.json` to `main`'s authoritative form (`git checkout main -- package-lock.json`) and committed it as `57d5c2475`. This does two things at once: it removes the dirty non-mission file so `commitSafeMissionArtifacts` cannot report an unsafe worktree again, and it puts success criterion 6 back to a README-only net change. `npm test` is `tsx test/run-default-tests.ts` and runs no install step, so the gate will not re-dirty the lockfile.

No file under `src/`, `test/`, `scripts/`, `prompts/`, `config/`, `docs/`, or `workflow.config.json` was modified. `backlog/tasks/task-2470 - Update-the-README-with-a-Defence-in-depth-section.md` is untouched and still reads `status: active`, `assignee: [qwen]`.

### Verification of the repair

| Check | Command | Result |
|---|---|---|
| Branch sits on the latest primary | `git merge-base --is-ancestor main HEAD` | **YES**; `git rev-list --left-right --count main...HEAD` → `0 9` (0 behind) |
| Rebase re-runs as a clean no-op | `git rebase main` | `Current branch mission/task-2470 is up to date.` — HEAD unchanged at `57d5c2475` |
| No rebase left in progress | `test -d .git/rebase-merge -o -d .git/rebase-apply` | absent |
| Worktree clean (the actual blocker) | `git status --porcelain \| wc -l` | **0** |
| Criterion 6 restored | `git diff --name-only 5f5f2645d..HEAD -- . ':!missions/'` | `README.md` only |
| Documentation gate | `./scripts/verify-local.sh docs` | exit **0** |
| General gate | `./scripts/verify-local.sh all` | exit **1** — 2455 tests, 2454 pass, 1 fail (a *different* failure than CP-2's; see below) |

### Remaining exact failure — inherited from `main`, not repairable in scope

```
test at test/task-2284-catalog-round-trip.test.ts
✖ round trip is lossless across every task record in backlog/tasks, backlog/completed, and backlog/archive/tasks
  AssertionError [ERR_ASSERTION]: every stored task record must survive the round trip
  + actual   [ 'backlog/tasks/task-2473 -Wire-resumeReview-into-a-CLI-command-so-stopped-reviews-can-recover.md: re-serialization is not byte-identical' ]
  - expected []
```

The offending record belongs to **task-2473**, not this mission. Four independent checks place it on `main`:

1. `git diff --stat main..HEAD -- 'backlog/tasks/task-2473 -Wire-resumeReview-into-a-CLI-command-so-stopped-reviews-can-recover.md'` → empty (byte-identical to `main`).
2. `git diff --stat main..HEAD -- test/task-2284-catalog-round-trip.test.ts` → empty, and `git diff --stat main..HEAD -- src/` → empty, so the test and all catalog code are `main`'s.
3. `git log --oneline -1 -- <that file>` → `6e7282060 backlog(task-2473): wire resumeReview into a CLI command so stopped reviews can recover`; `git cat-file -e main:<that file>` succeeds.
4. **Empirical:** a detached temporary worktree at `main` (`git worktree add --detach /tmp/main-red-check main`, HEAD `c37d13b02`) running `npm test -- test/task-2284-catalog-round-trip.test.ts` gives **4 pass / 1 fail** with the same test name. `main` is red. The temporary worktree and its `node_modules` symlink were removed afterwards (`git worktree remove --force` + `git worktree prune`); `git worktree list` is back to the operator's 10 and this worktree has 0 dirty files.

Its frontmatter uses column-0 block items under `labels:` (`- ai_sdlc` rather than two-space indent), which is the same shape the earlier `fix(task-2465): parse column-0 block items so catalog round-trip passes` addressed on the parse side; the re-serialization side still is not byte-identical for that record.

**Why this mission does not fix it.** Repairing it means editing either `src/` catalog serialization or `test/`, both Restricted Areas, or rewriting another mission's Backlog record (task-2473, `status: backlog`, `assignee: [codex]`) — and any of the three breaks success criterion 6, which confines the net change to `README.md`. The mission's stop rule is explicit: "Do not repair unrelated source or tests under this mission; report the failing check and the fact that the mission diff is README-only." This is also not a case where a code change would make a README claim true, so the second stop rule does not apply.

**What unblocks it:** repair `main` — either make the catalog re-serialize column-0 block items byte-identically, or normalize `task-2473`'s frontmatter indentation — under its own mission, then re-run handoff here. This branch needs no further change; it is already rebased, clean, and green on `docs`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Bounce diagnostic cleared: mission branch rebases onto the latest primary | `git rebase main` → `Current branch mission/task-2470 is up to date.`; `git merge-base --is-ancestor main HEAD` → YES; `git rev-list --left-right --count main...HEAD` → `0 9` | PASS |
| Underlying cause removed: no dirty non-mission file for `commitSafeMissionArtifacts` to reject | `git status --porcelain \| wc -l` → `0`; `src/adapters/review/rebase.ts` `isSafeToCommit` predicate; commit `57d5c2475 chore(task-2470): drop npm bin-path normalization from the lockfile` | PASS |
| CP-2's inherited red gate is cured by the rebase | `npm test -- test/metric-contract.test.ts` → 1 pass / 0 fail, test name "statistics metric contract names every board and CLI decision metric with its semantic inputs"; `grep -c 'Throughput / weekly throughput' docs/metric-contract.md` → 1 | PASS |
| 1. One `##` section headed `Defence in depth` | `README.md` heading `## Defence in depth`; `git diff main..HEAD -- README.md` shows it inserted between `## The core workflow` and `## Example` | PASS |
| 2. All nine layers named | `README.md` `## Defence in depth` items 1–9 (**Isolation**, **Confinement**, **Repository-owned verification**, **Checkpoint evidence validation**, **Mandatory-artifact gatekeeper**, **Separate review, blocked self-approval**, **Classified failure handling**, **Integration gates**, **Operator decision**); `grep -cE '^[0-9]+\. \*\*' README.md` → 9; mapping in `CP-1.md` | PASS |
| 3. Three conditional caveats present | `README.md` `## Defence in depth` item 2 ("If Bubblewrap is unavailable, Parallix warns explicitly that the agent is running unsandboxed"), item 6 ("A *different* agent family is guaranteed only when one is runnable"), closing paragraph ("C4 and C5 … are scheduled rather than implemented"); `ADR 0048` `## Implementation Status` transcribed in `CP-1.md` | PASS |
| 4. Claims traceable to criterion-4 artifacts | `CP-1.md` § "The nine defence layers, in lifecycle order" bolded evidence column: `docs/use-cases.md`, `src/adapters/process/bubblewrap.ts`, `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md`, `src/adapters/review/review-commands.ts`, `src/adapters/verification/gatekeeper.ts`, `src/application/failure-classification.ts` | PASS |
| 5. No new numeric claim; `## Use cases` byte-identical | `git diff main..HEAD -- README.md` contains no `+`/`-` line matching `+57%` or `order of magnitude`; `grep -nE '\+57%\|order of magnitude' README.md` still returns the single original sentence; figures used ("eight failure classes", "two attempts", "23 check points") are quoted from `ADR 0048` | PASS |
| 6. Net change confined to `README.md` | `git diff --name-only 5f5f2645d..HEAD -- . ':!missions/'` → `README.md` only, after `57d5c2475` restored `package-lock.json` to `main`'s form | PASS |
| 7. Removed bullet accounted for; no §2 differentiator lost | `CP-2.md` § "Deduplication performed (criterion 7)"; post-rebase `grep -nE "different review\|Review coverage" README.md` returns only the `## What it does` bullet, confirming the `## Current status` duplicate stayed removed through the rebase | PASS |
| 8a. `./scripts/verify-local.sh docs` exits 0 | Run on the rebased tree at `57d5c2475` → exit **0**, `PASS: authored documentation contains no volatile implementation evidence and relative links resolve` | PASS |
| 8b. `./scripts/verify-local.sh all` exits 0 | Exit **1**, 2455 tests / 2454 pass / 1 fail: `test/task-2284-catalog-round-trip.test.ts` "round trip is lossless across every task record in backlog/tasks, backlog/completed, and backlog/archive/tasks", on `backlog/tasks/task-2473 -Wire-resumeReview-into-a-CLI-command-so-stopped-reviews-can-recover.md`. Proven red on `main` itself via a detached worktree at `c37d13b02` (4 pass / 1 fail, same test); file, test, and all of `src/` byte-identical to `main`. Outside this mission's Scope and Restricted Areas | **BLOCKED — inherited from `main`** |
| 9. No `file.ext:123` reference in `README.md` | `./scripts/verify-local.sh docs` exit 0 (`scripts/verify-docs.mjs` rejects `src/`/`lib/` paths and `test/*.ts` inventories in `README.md`); the section names no source or test path, per `docs/doc-standards.md` §7 and §10 | PASS |
| Restricted areas and Backlog task untouched | `git diff --name-only main..HEAD -- src/ test/ scripts/ prompts/ config/ docs/ workflow.config.json` → empty; `backlog/tasks/task-2470 - Update-the-README-with-a-Defence-in-depth-section.md` frontmatter still `status: active`, `assignee: [qwen]` | PASS |

Next action: Operator repairs `main` so `./scripts/verify-local.sh all` can pass — either make the Backlog catalog re-serialize column-0 block items byte-identically, or normalize the `labels:` indentation in `backlog/tasks/task-2473 -Wire-resumeReview-into-a-CLI-command-so-stopped-reviews-can-recover.md` — then re-run handoff for task-2470. This branch needs no further work: it is rebased onto `main` (`git rebase main` reports up to date), the worktree is clean, `./scripts/verify-local.sh docs` exits 0, and the only red test is `test/task-2284-catalog-round-trip.test.ts` failing on `main`'s own task-2473 record.
