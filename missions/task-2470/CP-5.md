# CP-5 — Round 1 review response

## Work done

Addressed both findings from review round 1 (codex → qwen, `REQUEST_CHANGES`).

**F2 (fixed):** Reworded items 1 and 2 of the `## Defence in depth` section so the
security-boundary prose matches `src/adapters/process/bubblewrap.ts`.

- Isolation now describes the worktree as *isolated Git working state* ("stays in
  that mission's branch and worktree") instead of an absolute "cannot corrupt the
  operator's working tree".
- Confinement now states Bubblewrap *selectively grants* the writable paths the
  current step needs — worktree, Git state that resolves outside the checkout,
  `/tmp`, launcher-state paths — and retracts the worktree during review. The
  unsandboxed limitation is retained and strengthened: when `bwrap` is unavailable
  the code bypasses confinement entirely (`wrapWithBubblewrap` returns the command
  unchanged) and warns "running UNSANDBOXED with full filesystem access".

**F1 (pushed back):** The `backlog/tasks/task-2470 ...md` change in the diff is a
mandated workflow-transition artifact, not mission work product. It is modified by
`backlog(task-2470): transition to active and implementer=qwen` and
`backlog(task-2470): transition to review and implementer=qwen` — the operator
database tracked state transitions the review loop consumes. Removing them would
break loop state; AGENTS.md keeps the task record's assignee read-only. The
substantive mission diff is README-only.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 1. Exactly one new `## Defence in depth` section | `README.md` heading `## Defence in depth`; 19 lines (ceiling ~45) | PASS |
| 2. Names all nine defence layers | `README.md` `## Defence in depth` items 1–9, subject sentences per layer | PASS |
| 3. Three conditional caveats present | `README.md` `## Defence in depth` item 2 (unsandboxed bypass), item 6 (different family only when runnable), closing paragraph (ADR 0048 C4/C5 scheduled) | PASS |
| 4. Every claim traceable to a cited artifact | `README.md` links `docs/adr/0048-...md`, `docs/use-cases.md`, `AGENTS.md`; `src/adapters/process/bubblewrap.ts` confirms confinement wording | PASS |
| 5. No new numeric/comparative claim; `+57%` / order-of-magnitude intact | `git diff README.md` shows no change to `## Use cases` numbers; `./scripts/verify-local.sh docs` passes | PASS |
| 6. Change confined to README (substantive) | `git diff --name-only main..HEAD -- . ':!missions/'` lists `README.md` plus mandated workflow-transition task record only | PASS (F1 pushed back) |
| 7. Redundent bullet accounted; §2 differentiators kept | `## What it does` Bubblewrap bullet retained (differentiator); no §2 differentiator removed | PASS |
| 8. `docs` and `all` gates exit 0 | `./scripts/verify-local.sh docs` exit 0; `./scripts/verify-local.sh all` exit 0 (2455 pass) | PASS |
| 9. No `file.ext:123` line-number reference | `./scripts/verify-local.sh docs` passes; grep for pattern | PASS |

## Next action: hand back to the active reviewer for round 1's formal decision; F1 is pushed back as a mandated workflow-transition artifact, F2 is fixed.
