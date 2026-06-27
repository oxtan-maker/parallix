# CP-1: NEL computation function implemented and tested

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC2: Reusable NEL computation function exists | `lib/core/nels.js:1` exports `computeNEL`, `computeNELRecord`, `classifyBucket`, `isExcluded` | PASS |
| SC2: Function accepts git diff range | `lib/core/nels.js:119` signature `computeNEL(range, options)` | PASS |
| SC2: Returns integer NEL from `git diff --numstat -w` | `lib/core/nels.js:122-128` spawns `git diff --numstat -w <range>` | PASS |
| SC3: Excludes missions/**, backlog/**, review-*, CP-*, **/*.md, docs/**, package-lock.json, coverage/**, lockfiles | `lib/core/nels.js:22-31` defines all 9 exclusion patterns; `test/nels.test.js:23-50` validates each | PASS |
| SC3: Unit test covers inclusion, exclusion, empty-diff edge cases | `test/nels.test.js:27-28` — 27 tests all pass, covering 10 exclusion patterns, 6 bucket classifications, 6 git diff integration tests | PASS |
| SC3: Empty diff returns 0 | `test/nels.test.js:126:1` `computeNEL returns 0 for empty diff range` | PASS |
| SC3: Mixed inclusion/exclusion paths | `test/nels.test.js:244:1` `computeNEL correctly handles mixed included and excluded files` — NEL counts only included files | PASS |
| Bucket edges frozen at ADR 0047 terciles (80/235) | `lib/core/nels.js:35-36` `BUCKET_SMALL_MAX = 80`, `BUCKET_MEDIUM_MAX = 235` | PASS |
| No enforcement/gate/block logic introduced | `lib/core/nels.js` is a pure computation module with no conditional gates | PASS |

Next action: CP-2 — Update MISSION.md template to replace "% usage" with NEL bucket terminology.
