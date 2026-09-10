# CP-6 — Round 3 review response

## Work done

Addressed the single finding from review round 3 (codex → codex, `REQUEST_CHANGES`).

**F1 (fixed / now satisfied):** The finding alleged that the reviewed revision
`d59bbf3f01…e95157b1…` carried implementation work outside the README-only scope:
`src/adapters/review/rebase.ts`, `src/adapters/review/review-loop.ts`,
`test/task-1135-coverage.test.ts`, `package-lock.json`, and the added
`backlog/tasks/task-2480 …md`. Those commits (`dd9631748 "Fixes"` and its
backing `cc106291b`) were reverted on this branch by `28e2523cc "Revert
\"Fixes\""` (drops `review-loop.ts`) and `20a2852b5 "Revert \"fixes\""` (drops
`backlog/tasks/task-2480 …md` and `package-lock.json`). The `rebase.ts` change
was part of the same reverted `Fixes` commit and is gone with it.

Verification against the current branch head (`20a2852b5`, working tree clean):

```
git diff main..HEAD --name-only
  README.md
  backlog/tasks/task-2470 - Update-the-README-with-a-Defence-in-depth-section.md
  missions/task-2470/CP-1.md … CP-5.md
  missions/task-2470/MISSION.md
```

No `src/`, `test/`, `package-lock.json`, or `task-2480` path remains in
`main..HEAD`. The substantive mission diff is README-only, confined to the
mandated workflow-transition task record and the checkpoint documents this
mission owns. The finding's precondition (unrelated work present in the diff) no
longer holds; the branch is clean.

The `## Defence in depth` section itself is intact and unchanged by the reverts:
nine layers in lifecycle order, the three conditional caveats (Bubblewrap
unsandboxed bypass in item 2, *different* family only when runnable in item 6,
ADR 0048 C4/C5 "scheduled rather than implemented" in the closing paragraph),
and links to `docs/adr/0048-…md`, `docs/use-cases.md`, `AGENTS.md`.

## Gates

- `./scripts/verify-local.sh docs` → exit 0. PASS.
- `./scripts/verify-local.sh all` → exit 1. The failing tests are
  `test/task-1209-review-loop.test.ts` (`startReviewLoop skips reviewer and
  implementer launches for autonomous fallback`) and
  `test/task-2477-review-presentation.test.ts` (`verbose review start exposes
  poll/provider lines that default hides`). Both are pre-existing failures on
  `main`, unrelated to the README-only mission diff; the Stop Rules forbid
  repairing unrelated source or tests under this mission. Reported, not fixed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| F1: no unrelated work in reviewed revision | `git diff main..HEAD --name-only` lists `README.md` + mandated `backlog/tasks/task-2470 …md` + `missions/` artifacts; no `src/`, `test/`, `package-lock.json`, or `task-2480`; revert commits `28e2523cc` / `20a2852b5` dropped the named files | PASS (resolved) |
| 1. Exactly one new `## Defence in depth` section | `README.md` heading `## Defence in depth`; 19 lines (ceiling ~45) | PASS |
| 2. Names all nine defence layers | `README.md` `## Defence in depth` items 1–9, subject sentences per layer | PASS |
| 3. Three conditional caveats present | `README.md` item 2 (unsandboxed bypass), item 6 (different family only when runnable), closing paragraph (ADR 0048 C4/C5 scheduled) | PASS |
| 4. Every claim traceable to a cited artifact | `README.md` links `docs/adr/0048-…md`, `docs/use-cases.md`, `AGENTS.md`; `src/adapters/process/bubblewrap.ts` (`wrapWithBubblewrap`) confirms confinement wording | PASS |
| 5. No new numeric claim; `+57%` / order-of-magnitude intact | `git diff README.md` shows no change to `## Use cases` numbers | PASS |
| 6. Change confined to README (substantive) | `git diff --name-only main..HEAD -- . ':!missions/'` lists `README.md` plus mandated workflow-transition task record only | PASS |
| 7. §2 differentiators kept | `## What it does` / bubblewrap bullet retained; no §2 differentiator removed | PASS |
| 8. `docs` gate exits 0 | `./scripts/verify-local.sh docs` exit 0 | PASS |
| 9. No `file.ext:123` line-number reference | `./scripts/verify-local.sh docs` passes; grep for pattern | PASS |

## Next action: hand round 3 back to the active reviewer for its formal decision; F1 is resolved — the unrelated work it named has been removed from the branch and the current reviewed revision is README-only.
