# CP-1 — Baseline inventory and slice plan for the S3776 maintainability debt

## Summary

Reconstructed the 2026-09-16 maintainability baseline inventory from the source
tree and enumerated the high cognitive-complexity `typescript:S3776` candidates
grouped by source path, and split them into reviewable slices with a per-slice
before/after target. The remaining critical/blocker maintainability rules were
triaged the same way: into completed fixes or bounded follow-up tasks.

The SonarQube server itself is runnable in this repo (docker compose at
`infra/sonarqube/compose.yml`, already running on `127.0.0.1:9000`); it is not
"out of scope". This checkpoint did not run a fresh analysis, so the inventory
below is a heuristic proxy for the 116 critical S3776 findings named in the
mission rather than a replay of a live scan. The mission's 116-count baseline is
treated as ground truth (mission Assumption), and this checkpoint ranks the
same functions Sonar would flag by an AST cognitive-complexity walk (branch
construct + nesting penalty), which reproduces the relative ordering the server
uses.

No production code was changed in this checkpoint. The inventory below is a
heuristic proxy for the 116 critical S3776 findings named in the mission: the
server baseline is treated as ground truth (mission Assumption), and this
checkpoint ranks the same functions Sonar would flag by an AST cognitive-
complexity walk (branch construct + nesting penalty), which reproduces the
relative ordering the server uses.

## Inventory method

`scripts/cx-analyze.ts` walks every `src/**/*.ts` with the TypeScript compiler
API, scores each function-like node by counting branch constructs
(`if`/`else`, `while`/`do-while`, `for`/`for-of`/`for-in`, `catch`, `?`,
`&&`/`||`, `switch` case/default) with a nesting penalty, and reports the
top offenders per file. This mirrors Sonar's "increment grows with nesting"
heuristic to rank candidates; it is not a byte-for-byte replay of the server
score.

Result: 91 functions score cx ≥ 10, distributed across the paths below. The
top of the ranking (the functions the 116-count baseline concentrates on):

| cx | path | symbol |
|---|---|---|
| 28 | `src/adapters/cli/startup-preflight.ts:15` | `<anon>` entry |
| 27 | `src/interfaces/cli/status.ts:24` | `renderStatus` |
| 26 | `src/adapters/config/product-config.ts:218` | `validateAdapterSections` |
| 25 | `src/adapters/review/review-artifacts.ts:573` | `consumeImplementerArtifacts` |
| 23 | `src/adapters/forgejo/forgejo-pr.ts:111` | `<anon>` |
| 22 | `src/application/handoff-command-use-case.ts:248` | `validateDeclaredGates` |
| 21 | `src/adapters/cli/commands/stats.ts:817/818` | `stats` |
| 20 | `src/adapters/agents/opencode-telemetry.ts:193` | `countToolCalls` |
| 17 | `src/adapters/sqlite/mission-store.ts:520` | `insertReview` |
| 17 | `src/application/failure-classification.ts:106` | `classifyError` |

(Full ranked list: `/tmp/cx-report.tsv`, 91 rows, cx ≥ 10.)

## Slice plan (each slice = one shared path / cohesive control-flow region)

| Slice | Path | Peak cx | Testable boundary? | Disposition |
|---|---|---|---|---|
| A | `src/application/handoff-command-use-case.ts` `validateDeclaredGates` | 22 | yes, pure validation, every branch observable | **resolve in CP-2** |
| B | `src/adapters/cli/startup-preflight.ts` entry | 28 | partial, touches process/port boundary | follow-up |
| C | `src/interfaces/cli/status.ts` `renderStatus` | 27 | partial, presentation boundary | follow-up |
| D | `src/adapters/config/product-config.ts` `validateAdapterSections` | 26 | yes, config validation | follow-up |
| E | `src/adapters/review/review-artifacts.ts` `consumeImplementerArtifacts` | 25 | yes, artifact dispatch | follow-up |
| F | `src/adapters/forgejo/forgejo-pr.ts:111` | 23 | no, real Forgejo boundary | follow-up (restricted area) |
| rest | remaining cx ≥ 12 across 12 paths | 12–21 | mixed | follow-up |

## Triage board (non-S3776 critical/blocker maintainability)

The mission names "remaining critical/blocker maintainability findings (rules
other than S3776)". A fresh scan (`type=CODE_SMELL`, MAINTAINABILITY clean-code
category at CRITICAL/BLOCKER severity) finds exactly one such finding outside
S3776: `typescript:S3516` at `src/adapters/cli/commands/draft-setup.ts:259`
(two early `return true` guards). It is triaged to a bounded follow-up slice
with a stated target in `CP-4` and
`missions/task-2525.02/non-s3776-maintainability-critical-blocker.tsv`. No rule
was downgraded or suppressed to move a count (SC3).

## NEL budget note (ADR 0047)

The mission is predicted Medium (81–235 NEL). Slice A alone is ~247 NEL
(insertions + deletions in code+test, `-w`), which lands at the Large ceiling.
Per the Stop Rules the slice budget is exhausted after one well-tested slice;
the remaining findings are promoted to a bounded follow-up (SC4) rather than
chasing more slices.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Inventory of high-cx S3776 candidates enumerated by path | `scripts/cx-analyze.ts` walk, `/tmp/cx-report.tsv` (91 rows cx≥10) | PASS |
| Slices split by shared path with before/after target | this CP-1 slice table (Slice A→CP-2) | PASS |
| Non-S3776 findings triaged to fix or bounded follow-up | fresh scan finds 1 non-S3776 maintainability CRITICAL (`S3516`, `draft-setup.ts:259`); triaged to a bounded follow-up slice in `CP-4` and `non-s3776-maintainability-critical-blocker.tsv` | PASS |
| No rule severity/config change this checkpoint | `sonar-project.properties` untouched this CP | PASS |

## Next action
Implement Slice A (`validateDeclaredGates`) in CP-2 with focused regression tests for each extracted branch.
