# CP 1 — Reproduction test for folded-YAML web mission summary

## Summary
Traced the web mission card summary path end to end: `ConcreteMissionReadAdapter.buildRecord` reads the mission title via `parseTaskFrontmatterValue` (`src/adapters/backlog/task-file-io.ts`), which uses a single-line regex `^title:\s*([^\r\n]+)`. A mission whose `title` is a YAML folded block scalar (`>-`) yields the literal marker `>-`, which the web board renders verbatim (`toWebMissionCard` sets `WebMissionCard.title = card.title = card.title`). The TUI card already masks this via `isPlaceholderTitle` (`src/interfaces/tui/mission-card.tsx`); the web path does not.

Author `test/task-2526-web-summary-repro.test.ts` that loads a mission from a task file whose `title` serializes as a folded scalar, projects it through `projectMissionCard` → `buildBoardProjection` → `toWebBoardSnapshot`, and asserts the rendered web card title equals the descriptive text. Confirmed the folded-scalar test is **RED at the parent commit** (`actual: ">-"`) while the ordinary single-line description test passes.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test is red at parent commit | `test/task-2526-web-summary-repro.test.ts`, test `"web mission summary renders folded YAML description text"` fails with `actual: ">-"` | PASS (red confirmed) |
| Ordinary description still renders text | `test/task-2526-web-summary-repro.test.ts`, test `"web mission summary preserves an ordinary single-line description"` passes | PASS |
| Failure is isolated to web-summary path | Traced to `parseTaskFrontmatterValue` (`src/adapters/backlog/task-file-io.ts`), used by `ConcreteMissionReadAdapter` title | PASS |

Next action: implement the smallest shared-boundary correction in `parseTaskFrontmatterValue` to resolve folded/literal block scalars, then verify the test turns green (CP 2).
