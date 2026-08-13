# CP-1 — Responsibility mapping for the parsing extraction

## Summary

Mapped each of the 18 helper responsibilities named in the mission scope to its
current location in `src/adapters/sqlite/mission-importer.ts`, its inputs and
outputs, the class state it depends on, and its current behavioural coverage.
Recorded the intended API of the new
`src/adapters/sqlite/mission-import-parsing.ts` module and the dependencies that
must stay in the importer.

No production code was changed in this checkpoint.

### Current shape

`src/adapters/sqlite/mission-importer.ts` is 1712 physical lines
(`wc -l src/adapters/sqlite/mission-importer.ts`). Five of the 18 helpers are
already module-level functions in that file (`nonNegativeCount`,
`parseAssigneeValue`, `normalizeAssignee`, `canonicalJson`, `truncate`); the
other 13 are `private` methods on `MissionCompatibilityImporter`.

The class's externally used surface is only the constructor, `dryRun()`,
`apply()` and `restore()` — the sole production consumer is
`src/composition/application-services.ts`. None of the 18 helpers is a public
API, so extraction needs no consumer-facing rename (mission Stop Rule 2 does not
apply).

### Helper → parsing-module API map

| # | Helper (current) | Input | Output | Class state used | New module signature |
|---|---|---|---|---|---|
| 1 | `parseFrontmatter` (method) | markdown content | record of string/string[] | none | `parseFrontmatter(content: string): FrontmatterFields` |
| 2 | `extractTaskId` (method) | task file path | `string \| null` | none (reads fs) | `extractTaskId(taskFile: string): string \| null` |
| 3 | `buildCandidate` (method) | task file path | `MissionImportCandidate \| null` | `this.repositoryId`, `this.rootDir` | `buildCandidate(taskFile, { rootDir, repositoryId }): MissionImportCandidate \| null` |
| 4 | `parseGoalCheckTable` (method) | checkpoint content | `readonly GoalCheckRow[]` | none | `parseGoalCheckTable(content: string): readonly GoalCheckRow[]` |
| 5 | `extractNextAction` (method) | checkpoint content | `string` | none | `extractNextAction(content: string): string` |
| 6 | `readMissionReview` (method) | mission dir or null, mission id | `{ review, errors }` | none (reads fs) | `readMissionReview(missionDir: string \| null, id: MissionId)` |
| 7 | `reviewFromState` (method) | parsed JSON object, mission id, source path | `{ review, errors }` | none | `reviewFromState(data, id, sourcePath)` |
| 8 | `decisionFromPhase` (method) | phase, disposition, startedAt | `ReviewerDecision \| null` | none | `decisionFromPhase(phase, disposition, startedAt)` |
| 9 | `requiredAgentFamily` (method) | unknown value, field, source path, errors sink | `AgentFamily \| null` | none | `requiredAgentFamily(value, field, sourcePath, errors)` |
| 10 | `checkpointOrder` (method) | filename | `number` | none | `checkpointOrder(filename: string): number` |
| 11 | `readCheckpointFiles` (method) | mission dir, mission id | `{ checkpoints, errors }` | none (reads fs) | `readCheckpointFiles(missionDir, id)` |
| 12 | `readMdFiles` (method) | directory | `string[]` | none (reads fs) | `readMdFiles(dir: string): string[]` |
| 13 | `findMissionDir` (method) | mission id | `{ dir, errors }` | `this.rootDir` | `findMissionDir(rootDir: string, slug: MissionId)` |
| 14 | `nonNegativeCount` (function) | unknown | `number` | none | unchanged, exported |
| 15 | `parseAssigneeValue` (function) | `string \| string[]` | `string \| null` | none | unchanged, exported |
| 16 | `normalizeAssignee` (function) | string | `string \| null` | none | unchanged, exported |
| 17 | `canonicalJson` (function) | unknown | `string` | none | unchanged, exported |
| 18 | `truncate` (function) | string, limit | `string` | none | unchanged, exported |

Only helpers 3 and 13 touch class state, and both take it as an explicit
parameter after extraction (`rootDir`, `repositoryId`). No helper reads
`this.db` or `this.store`, so the parsing module never imports the importer and
the circular-dependency risk in the mission's Risks section does not materialise.

### Types that move with the helpers

`MissionImportCandidate` is the return type of `buildCandidate`, so its interface
declaration moves to the parsing module and `mission-importer.ts` re-exports it
to keep `import { MissionImportCandidate } from './mission-importer.js'` working
for any existing consumer.

### Dependencies that stay in the importer

`discoverCandidates`, `detectOmissions`, `computeDigest`, `getTaskStorage`,
`toMission`, `getDivergenceDetails`, `validateCandidates`, `detectConflicts`,
all raw-SQL helpers, `restore`, `recordImport`, `dryRun` and `apply` remain in
`mission-importer.ts`; they call the extracted functions (`readMdFiles`,
`extractTaskId`, `buildCandidate`, `parseFrontmatter`, `canonicalJson`,
`truncate`) as imports rather than methods.

### Existing behavioural coverage

`test/task-2322.04-mission-import.test.ts` exercises these helpers only through
`new MissionCompatibilityImporter(...).dryRun()` / `.apply()`; that file is the
regression net that must stay green, and CP-2 adds direct parsing-module tests
in `test/mission-import-parsing.test.ts` covering all 18 responsibilities plus
fallback cases.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — all 18 responsibilities identified with a planned standalone signature | Helper map table above enumerates 18 rows targeting `src/adapters/sqlite/mission-import-parsing.ts` | PASS |
| SC2 — delegation plan and line-count baseline established | `wc -l src/adapters/sqlite/mission-importer.ts` reports 1712; dependency list above names the members that remain | PASS |
| SC3 — behaviour-preservation baseline identified | `test/task-2322.04-mission-import.test.ts` is the existing end-to-end regression net for these helpers | PASS |
| SC4 — direct-test plan targets the full responsibility list | Planned `test/mission-import-parsing.test.ts` covering the 18 mapped helpers without constructing the importer | PENDING (CP-2) |
| SC5 — verification commands identified | `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` | PENDING (CP-3) |
| Stop rules not triggered | No helper is on the public surface — only the constructor, `dryRun`, `apply`, `restore` are used by `src/composition/application-services.ts` | PASS |

Next action: create `src/adapters/sqlite/mission-import-parsing.ts` with the 18
mapped functions, convert `MissionCompatibilityImporter` to delegate to them,
and add `test/mission-import-parsing.test.ts` (CP-2).
