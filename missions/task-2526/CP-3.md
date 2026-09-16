# CP 3 — Final: gate green, all success criteria met

## Summary
Implemented and committed the shared-boundary correction in `parseTaskFrontmatterValue` (`src/adapters/backlog/task-file-io.ts`), which folds YAML block scalars (`>-`, `|`) into descriptive text. The regression test `web mission summary renders folded YAML description text` (`test/task-2526-web-summary-repro.test.ts`) is green, the ordinary-description test stays green, and the required gate `./scripts/verify-local.sh all` exits 0 with 2631 pass / 0 fail. All three success criteria are falsifiable and verified.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Folded-scalar mission `Description` projects to web with descriptive text, not `>-` | `test/task-2526-web-summary-repro.test.ts`, test `"web mission summary renders folded YAML description text"` asserts rendered web card text equals the description (not `>-`) | PASS |
| Regression test is red at parent commit and green after correction | `test/task-2526-web-summary-repro.test.ts`; red at parent `f8c594ff7` (`actual: ">-"`), green post-fix (CP-1, CP-2) | PASS |
| Ordinary mission description summary unchanged | `test/task-2526-web-summary-repro.test.ts`, test `"web mission summary preserves an ordinary single-line description"` passes | PASS |
| `./scripts/verify-local.sh all` exits successfully on final tree | `./scripts/verify-local.sh all` → exit 0, `ℹ pass 2631 / ℹ fail 0` (`/mnt/data/gate_final.out`) | PASS |

## Durable evidence
- Fix: `src/adapters/backlog/task-file-io.ts` `parseTaskFrontmatterValue` (folds `>-`/`|` block scalars).
- Test: `test/task-2526-web-summary-repro.test.ts`, test names `"web mission summary renders folded YAML description text"` and `"web mission summary preserves an ordinary single-line description"`.
- Gate: `./scripts/verify-local.sh all` exit 0, 2631 pass / 0 fail (run recorded in `/mnt/data/gate_final.out`; rerun against committed tree).
- Re-run unit suite in isolation: `node --experimental-test-module-mocks --import tsx --test test/task-2526-web-summary-repro.test.ts` → pass 2 / fail 0.
- Decision record: ADR 0039 Part 2 (falsifiability) governs the success-criteria wording.

## Scope / stop-rule check
No stop rule triggered: `>-` was a serialization artifact (a folded block scalar), not intentional mission content; no schema migration, bulk rewrite, or web-card redesign was required. Summary extraction is shared by the web board only via the single `parseTaskFrontmatterValue` reader; the correction is applied once at that boundary. No unrelated projections were altered.

Next action: update the Backlog task Definition of Done checkboxes to reflect completion (without changing status/assignee/labels/lifecycle), then hand off.
