# Mission: Split backlog.ts — extract task file I/O and lifecycle transitions (task-2369.14)

## Goal
Split `src/adapters/backlog/backlog.ts` (1306 lines) into three focused modules — `task-file-io.ts`, `task-transitions.ts`, `task-metadata.ts` — and leave `backlog.ts` as a thin re-export under 400 lines. All 19 external callers keep working via re-exports.

## Why Now
Single-file backlog module is hard to navigate, review, and modify. Every change touches 1300+ lines. Splitting by concern reduces cognitive load, enables independent edits, and surfaces the public API via explicit re-exports.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: pure mechanical refactor — move functions, add re-exports, update imports. No behavior change.

## Scope
- Create `src/adapters/backlog/task-file-io.ts` with 12 functions: `getTaskStorage`, `findTaskFiles`, `findTaskFile`, `resolveTaskFile`, `reportTaskResolution`, `taskIdFromFilename`, `getTaskFrontmatterValue`, `getAcceptanceCriteria`, `commitTaskFileUpdate`, `checkBacklogIntegrity`, `pruneStaleBacklogDuplicates`, plus `resolveStableRepositoryId` and `extractRepoNameFromUrl` (internal helpers used by file-io functions).
- Create `src/adapters/backlog/task-transitions.ts` with 12 functions: `getTaskStatus`, `setTaskStatus`, `completeTask`, `transitionTask`, `transitionTaskLocal`, `transitionTaskOnIntegrationBranch`, `replaceTaskAssignees`, `restoreAuthoritativeTaskLifecycle`, `reconcileMissionRebase`, `unresolvedRebaseFiles`, `resolveBacklogStateRoot`, `recordLifecycleOperation`.
- Create `src/adapters/backlog/task-metadata.ts` with 14 exports: `getTaskAssignee`, `getTaskImplementer`, `setTaskAssignee`, `setTaskImplementer`, `enforceTaskAssignee`, `clearTaskAgentAssignee`, `getTaskLabels`, `setTaskLabels`, `syncTaskLabelsToBaseWorktree`, `getTaskClassification`, `hasBugLabel`, `parseAssigneeFamilies`, `CLASSIFICATION_LABELS`, `getSupportedAgents`.
- Update `backlog.ts` to re-export all public symbols from the three new files. Remove extracted function bodies.
- Update all 19 callers that import from `backlog.js` — no behavior change, imports resolve via re-exports.

## Out of Scope
- Renaming any function or changing signatures.
- Adding new tests (static analysis is the gate).
- Refactoring callers to import from new files directly.
- Modifying `backlog.md` aggregate or any non-backlog adapter.

## Success Criteria
- SC1: `src/adapters/backlog/backlog.ts` is under 400 lines after refactor.
- SC2: `src/adapters/backlog/task-file-io.ts` exists and exports all 12+ listed functions.
- SC3: `src/adapters/backlog/task-transitions.ts` exists and exports all 12 listed functions.
- SC4: `src/adapters/backlog/task-metadata.ts` exists and exports all 14 listed symbols.
- SC5: `backlog.ts` re-exports every symbol previously exported (no symbol dropped).
- SC6: `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs).
- SC7: No function signature changes — all 19 callers compile without modification.

## Risks and Assumptions
- Risk: Cross-module circular dependency between the three new files. Mitigation: each new file imports only from shared deps (`fs`, `path`, `git`, `agents`, `fmt`, `product-config`, `mission-utils`), not from sibling modules. If a cross-reference exists, inline or restructure.
- Risk: `transitionTask` (line ~565) calls into file-io and metadata functions. After split, imports within `task-transitions.ts` must reference sibling modules. Assumption: transition functions are the deepest layer — they depend on file-io and metadata, not vice versa.
- Assumption: No runtime tests exercise these functions directly (all callers are CLI commands or workflow adapters). Static analysis is sufficient gate.

## Checkpoints
- CP 1: Extract `task-file-io.ts` — move 12+ functions, verify `backlog.ts` re-exports, static analysis passes.
- CP 2: Extract `task-metadata.ts` — move 14 exports, verify re-exports, static analysis passes.
- CP 3: Extract `task-transitions.ts` — move 12 functions, add sibling imports where needed, verify re-exports, static analysis passes.
- CP 4: Trim `backlog.ts` — remove all extracted bodies, confirm <400 lines, final static analysis pass.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — e.g., `"backlog re-exports all symbols"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `src/adapters/backlog/task-file-io.ts` (must be an existing file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| task-file-io.ts exports all listed functions | `src/adapters/backlog/task-file-io.ts`, grep `export` | PASS |
| backlog.ts re-exports task-file-io symbols | `src/adapters/backlog/backlog.ts`, `export { ... } from './task-file-io.js'` | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- Do not modify any file outside `src/adapters/backlog/` (callers import via `backlog.js` re-exports; no caller file changes needed).
- Do not change function signatures, parameter order, or return types.
- Do not add new dependencies or imports beyond `fs`, `path`, `git`, `agents`, `fmt`, `product-config`, `mission-utils`, and sibling modules.

## Stop Rules
- Stop if static analysis reveals a missing re-export or broken import — fix before continuing.
- Stop if `backlog.ts` exceeds 400 lines after all extractions — audit for leftover function bodies.
- Stop if a circular dependency prevents compilation — restructure imports, do not add a third module.
- Do not add tests; this is a mechanical refactor. If static analysis is clean, the refactor is correct.
