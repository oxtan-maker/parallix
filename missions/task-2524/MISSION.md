# Mission: Fix task-file slug-prefix duplicate collision that blocks completeTask closeout (task-2524)

## Goal
Repair the Backlog task-file resolution collision so `completeTask()` can advance an open `backlog/tasks/` file whose slug prefix is shared with a renamed twin in `backlog/completed/`, and clear the three drifted task files left stuck at `status: backlog` after their missions merged.

The defect (verified at `main` head `a6d51e0a3`): `resolveTaskFile()` in `src/adapters/backlog/task-file-io.ts` matches by filename prefix (`findTaskFiles`: `f.startsWith(slug)`). When two files share a slug prefix — a stale original in `backlog/tasks/` plus the mission's renamed file in `backlog/completed/` — it returns `{ ok: false, reason: 'ambiguous' }`. The `preferSameTaskInHigherPriorityDir` helper only disambiguates candidates that share a basename, and `completeTask()` in `src/adapters/backlog/task-transitions.ts` short-circuits on `!resolution.ok` and returns `false` without moving the file. The open `tasks/` file therefore never advances to `done` / `completed/`.

The collision is new this week: before ~2026-09-14 each slug had exactly one file. The `ambiguous`-resolution logic itself is old (task-2369.14, `9e5ae42b1`, 2026-08-13); the duplicates are the new drift.

## Why Now
Three missions landed this week (task-2503, task-2518, task-2519) and their SQLite Mission aggregate is `done`, yet their `backlog/tasks/` files are still `status: backlog`. `px status` / the board already surface the ambiguity, but closeout is hard-locked: `completeTask` cannot advance the open file, so the persisted backlog state can never catch up to the landed mission state. This is a resolution collision that turned a pre-existing guard into a dead end, not a landing-sequence regression.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: regression-closeout-block, backlog-integrity, single-function fix

## Scope
- Fix `completeTask()` (`src/adapters/backlog/task-transitions.ts`) so that when `resolveTaskFile()` returns `reason: 'ambiguous'` with the candidate set being exactly one open `backlog/tasks/` file and one renamed `backlog/completed/` file sharing the same slug prefix, `completeTask` advances the **open** `tasks/` file (its advance contract) instead of returning `false`.
- Add / wire a committed integrity check that fails when two files share a task slug prefix. `checkBacklogIntegrity()` in `src/adapters/backlog/task-file-io.ts` already emits `duplicate-completed` issues for the same-id-in-both-dirs case; the committed gate (consumed by `draft-stats` / `px status`) must reject on the broader slug-prefix overlap this week introduced.
- Correct the three drifted task files so the board matches the landed state:
  - `backlog/tasks/task-2503 - prevent-autobug-filing-on-test-run.md` → `done` + remove stale `tasks/` copy (canonical twin: `backlog/completed/task-2503 - preserve-mission-identity-during-rebase.md`)
  - `backlog/tasks/task-2518 - Keep-board-action-wire-vocabulary-in-sync.md` → `done` + remove stale `tasks/` copy
  - `backlog/tasks/task-2519 - Shift-rigth.md` → `done` + remove stale `tasks/` copy
- Author the red→green reproduction test that locks the bug before the fix (see Checkpoints).

## Out of Scope
- Do NOT touch `src/application/rebase-workflow.ts` or `test/task-2503-repro.test.ts` (task-2503's identity-preservation fix).
- Do NOT change the integration landing sequence, gate selection, or the pre-landing integration guard (TASK-2517).
- Do NOT make `resolveTaskFile()` silently pick a file globally. The ambiguity must still surface as an integrity error for `px status` / board display. Only `completeTask` may prefer the open file to preserve its advance contract.
- Do NOT rewrite `findTaskFiles()` prefix matching or the base-ID fallback in `resolveTaskFile()`.
- Do NOT introduce new slug duplicates; do NOT silently overwrite the `completed/` mission file.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC1 `completeTask('task-XXXX', root)` returns `true` and renames the open `backlog/tasks/` file into `backlog/completed/` when the candidate set is exactly one `tasks/` file + one `completed/` file sharing slug prefix `task-XXXX`. Reproduced by the committed red→green test asserting the pre-fix tree returns `false` and the post-fix tree renames the file.
- SC2 `resolveTaskFile('task-XXXX', root)` still returns `{ ok: false, reason: 'ambiguous' }` for the same two-file prefix collision, so `px status` / board integrity display is unchanged.
- SC3 A committed integrity check fails (non-zero / issue emitted) when two files share a task slug prefix; verified by a test that writes two `task-NNNN-*` files across `tasks/` and `completed/` and asserts the check reports the overlap.
- SC4 The three drifted files (task-2503, task-2518, task-2519) read `status: done` and their stale `backlog/tasks/` copies are removed while the `backlog/completed/` twins remain.
- SC5 No focused or unannotated skipped tests: no `.only`, no bare `.skip` anywhere in the tree (enforced by the test-hygiene portion of the static-analysis gate).
- SC6 `./scripts/verify-local.sh static-analysis` passes on every changed file (ESLint + `tsc --checkJs` + test-hygiene).

## Risks and Assumptions
- The fix must scope the disambiguation to the exact open-vs-completed twin; a too-broad change to `resolveTaskFile` would mask genuine ambiguities that `px status` currently catches. Assumption: the twin is always one file in `tasks/` and one in `completed/` (or `archive/tasks/`) sharing the slug prefix.
- `completeTask()` is called from the closeout/landing path; changing its return contract could interact with callers that already tolerate `false`. Verified by reading every caller before editing.
- The drifted files carry real mission history; removing the stale `tasks/` copy must keep the `completed/` canonical copy intact.
- Integrity-check broadening must not false-positive on legitimately distinct slugs that merely share a numeric base via the base-ID fallback.
- Assumption: the reproduction test runs hermetically in a temp repo (no real git / Forgejo / network), so it belongs in the `unit` tier.

## Checkpoints
- CP 1: Red→green reproduction test that locks the bug (author before any fix).
- CP 2: Fix `completeTask()` disambiguation for the open-vs-completed twin.
- CP 3: Committed slug-prefix integrity check that fails on duplicates.
- CP 4: Correct the three drifted task files (task-2503, task-2518, task-2519) and remove stale `tasks/` copies.
- CP 5: Run verification gates and produce the Goal Check with durable evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2524-slug-duplicate-closeout-repro.test.ts` ``, `` `px status `` `` or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — must match a test name registered in the repo (see the reproduction test's `test(...)` titles)
  3. **Test file paths** — e.g., `test/task-2524-slug-duplicate-closeout-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Example of the weak-agent failure mode to avoid: pasting `ls backlog/completed` and writing "the file is moved" without a test name, test path, or recognized repo command is NOT sufficient evidence — the reviewer cannot verify it.
- A non-generic `Next action:` line at the bottom

The red→green reproduction test (CP 1) MUST:
- Live at `test/task-2524-slug-duplicate-closeout-repro.test.ts` (under `test/`, `unit` tier, hermetic temp-repo harness — no real git / Forgejo / network).
- Build a temp repo with `backlog/tasks/` and `backlog/completed/`, write a `task-NNNN` file into `tasks/` (`status: backlog`) and a slug-prefix twin into `completed/`, then assert `completeTask('task-NNNN', root)` returns `false` at the mission parent commit (red) and renames the open `tasks/` file into `completed/` (green) once the fix lands.
- Also assert `resolveTaskFile('task-NNNN', root)` still returns `{ ok: false, reason: 'ambiguous' }` so SC2 (ambiguity still surfaces) is locked in the same file.

Reproduction-Test: test/task-2524-slug-duplicate-closeout-repro.test.ts

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- `src/application/rebase-workflow.ts` — do not modify.
- `test/task-2503-repro.test.ts` — do not modify (task-2503 identity-preservation fix).
- The integration landing sequence, gate selection, and the pre-landing integration guard (TASK-2517).
- `resolveTaskFile()` / `findTaskFiles()` prefix-matching and base-ID fallback — do not globally silence ambiguity.
- Any file outside `src/adapters/backlog/`, `test/`, and the three drifted backlog task files.

## Stop Rules
- Stop before touching any restricted area; if the twin disambiguation would require changing `resolveTaskFile()`'s global resolution, that is out of scope — stop and surface it.
- Stop if the fix would change the return contract of `completeTask()` in a way that breaks a caller other than the closeout path.
- Stop if the integrity check broadening false-positives on distinct slugs; narrow the check instead of shipping a noisy gate.
- Do not push the mission branch to `origin`; only `main` may be pushed (review goes to the `review` remote).
- Do not transition the backlog task to `ready` yourself; the harness does that after a clean draft.
