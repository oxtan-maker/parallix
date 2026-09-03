# CP-9: Docs + TASK-2283 recheck + final integration gate

## Summary

Durable docs added; TASK-2283 umbrella acceptance criteria rechecked one by one;
full integration gate passes on the final tree.

Round-1 reviewer blocker (F1) fixed after CP-9 was written: `checkCommandAction`
in `src/interfaces/web/transport.ts` had the `checkKeys` `allowed`/`required`
argument order swapped so every real command action (with or without the
optional `label`) failed wire validation and the web board was fail-closed.
Argument order corrected; regression test added; gate re-run green on the final
tree.

**Docs (SC11):** No standalone `docs/web-board.md` on the final tree — it was
removed in a reviewer-directed fix (PR #374 round 1) after the branch had
rebased through several checkpoints, so citing it as evidence would be
unverifiable. Durable user-facing behavior of the `px web` local board
(launch, read-only projection, per-launch session, mutation authorization,
reconnect, and the `px ui` Ink fallback) lives in the authored ADR only:
`docs/adr/0054-local-web-board-adapter.md`. Removed all implementation-path/
line-number evidence from authored prose; references point to the durable
command identity and ADR 0054. `./scripts/verify-local.sh docs` PASSES (no
volatile implementation evidence, relative links resolve).

**TASK-2283 recheck (SC12):** TASK-2283 ("Align operator UIs on truthful agent
activity semantics / implement the local web board over shared contracts") —
its acceptance criteria are the ones captured by its follow-up TASK-2389. Each is
rechecked here against the web board slice; none is waived.

## TASK-2283 acceptance matrix

| TASK-2283 AC | Evidence | Status |
|---|---|---|
| #1 Shared projection distinguishes authoritative work from recovery-only coordinator evidence; preserves live/unknown/stale/stopped | `test/web-transport.test.ts` "mission work activity preserves live, unconfirmed, stale, blocked, and idle liveness"; "coordinator evidence distinguishes unknown, stopped, and live" | PASS |
| #2 Agent strip no longer labels coordinators as exact running-agent counts | `test/web-board-render.test.ts` "activity, coordinator recovery evidence, and reduced motion stay truthful"; "omitted, null and observed-zero running sessions each render as themselves" | PASS |
| #3 px status exposes the same mission activity/uncertainty as the board | `test/current-work-publication.test.ts`, `test/current-work-reconciliation.test.ts` | PASS |
| #4 Overlapping ops and unattributed families have explicit projection behavior | `test/web-transport.test.ts` "unattributed running sessions keep the same three-state encoding" | PASS |
| #5 Focused rendering tests prove TUI and status CLI agree | `test/current-work-publication.test.ts` + `test/web-board-render.test.ts` | PASS |
| #6 static-analysis + docs verification pass | `./scripts/verify-local.sh all` (static-analysis) + `./scripts/verify-local.sh docs` | PASS |

No TASK-2283 criterion is unmet; none waived. The design-fidelity gate (TASK-2437
#13/#14) could not be completed because the reference design zip is absent —
deferred to `backlog/tasks/task-2437.01`, not waived.

## Final integration gate

`./scripts/verify-local.sh all` EXIT=0 on the final tree:
- Tests: 2357 run, 2357 pass, 0 fail, 0 skipped.
- Canonical bundle: 2.2 MB within the 5 MB stop rule (`scripts/build-canonical-bundle.ts` SC6, `maxSizeBytes = 5 * 1024 * 1024`, unchanged).
- Docs: PASS (no volatile implementation evidence, relative links resolve).
- Static analysis (ESLint + tsc --checkJs): included in the green `all` gate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC11 durable docs only, no volatile inventory | `docs/adr/0054-local-web-board-adapter.md`; `./scripts/verify-local.sh docs` PASS (re-verified this round) | PASS |
| SC12 TASK-2283 criteria rechecked, none waived | matrix above; `test/web-transport.test.ts`, `test/current-work-publication.test.ts` | PASS |
| SC13 design fidelity (reference zip absent) | follow-up task `backlog/tasks/task-2437.01 - design-fidelity-audit-vs-reference.md`; known-item Parallels-duplicate check ABSENT — verified `web/src/top-bar.tsx:42` renders the product label `Parallix` and `:45` renders the live `snapshot.repositoryId`; `grep -rniE "parall[sx]|Parallels" web/src/` finds only that single product label, no duplicated `Parallels` token | FOLLOW-UP |
| SC14 full integration gate passes | `./scripts/verify-local.sh all` → tests 2364, pass 2364, fail 0 (re-run on final tree after F1 fix; static-analysis + docs + 2.2 MB bundle green) | PASS |

## Next action: round-1 reviewer findings addressed (F1 blocker fixed + regression test; F2 SC11 reconciled to ADR 0054); full gate green on final tree (2364/2364). Await round-2 review decision.
