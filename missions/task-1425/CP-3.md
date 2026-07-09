# CP-3: Extract graphify and merge/artifact/noise helpers

## Summary

Moved the graphify domain (`graphifyAvailable`, `graphifyCommandCandidates`,
`probeGraphifyAvailability`, `updateGraphifyKnowledgeGraph`) into
`lib/core/mission-utils/graphify.ts`. This module has no dependency on the other
three internal modules — it only imports `fmt` and `git` from `lib/core`, matching
its role as a self-contained probe/update helper set.

Moved the merge/artifact/noise domain (`parseConflictFilesFromMergeOutput`,
`getConflictFiles`, `findLastNonNoiseCommit`, `squashTrailingBacklogNoiseIntoPreviousMission`,
`softResetTrailingBacklogNoise`, `findMissionDocInBranches`, `isMissionArtifact`,
`isWorkflowGeneratedArtifact`) into `lib/core/mission-utils/merge-noise.ts`, importing
`missionPathForSlug`, `missionDirForSlug`, and `getMissionYear` from `./paths.js` for
the branch mission-doc lookup and adapter-aware artifact classification, and
`resolveTaskStorage` directly from `product-config.js` (unchanged from the original).

`lib/core/mission-utils.ts` now re-exports all four modules; no implementation
logic remains in the facade file (confirmed by inspection — `lib/core/mission-utils.ts`
contains only `export { ... } from './mission-utils/*.js'` statements).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Graphify probing/update helpers isolated in one module | `lib/core/mission-utils/graphify.ts:32` (`probeGraphifyAvailability`), `lib/core/mission-utils/graphify.ts:64` (`updateGraphifyKnowledgeGraph`) | PASS |
| Merge-conflict parsing isolated in merge/artifact/noise module | `lib/core/mission-utils/merge-noise.ts:18` (`parseConflictFilesFromMergeOutput`), `lib/core/mission-utils/merge-noise.ts:51` (`getConflictFiles`) | PASS |
| Exact branch matching in `findMissionDocInBranches` preserved | `lib/core/mission-utils/merge-noise.ts:186`, `test/mission-utils.test.js`, `"findMissionDocInBranches uses exact slug matching, not substring"` | PASS |
| Adapter-aware mission artifact detection preserved | `lib/core/mission-utils/merge-noise.ts:241` (`isMissionArtifact`), `test/mission-utils.test.js`, `"isMissionArtifact respects adapter baseDir instead of hardcoded docs/missions"` | PASS |
| Graphify availability/update handling behavior locked | `test/mission-utils.test.js`, `"probeGraphifyAvailability and graphifyAvailable distinguish missing commands from probe failures"`, `"updateGraphifyKnowledgeGraph logs missing, probe-failed, update-failed, and success outcomes"` | PASS |
| Facade is now a pure re-export layer | `lib/core/mission-utils.ts:1` | PASS |
| At least four module boundaries exist (paths, worktree, graphify, merge-noise) | `lib/core/mission-utils/paths.ts:1`, `lib/core/mission-utils/worktree.ts:1`, `lib/core/mission-utils/graphify.ts:1`, `lib/core/mission-utils/merge-noise.ts:1` | PASS |
| Full behavior suite still green through the facade | `node --test test/mission-utils.test.js` (41/41 passing) | PASS |

Next action: reorganize `test/mission-utils.test.js` into focused test files that mirror the four new module boundaries (CP-4), preserving every existing test scenario.
