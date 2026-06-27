---
event_type: reviewer_findings
timestamp: 2026-06-27T14:09:30.332Z
round: 1
phase: reviewing
actor: custom
slug: task-1365
---

# Task-1365 Review Findings

## Scope Assessment

### In-Scope Changes (Correctly Implemented)
1. **tsconfig.json** — Fully matches mission spec. `allowJs: false`, `checkJs: false`, `noEmit: false`, `outDir: "."`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `strict: true`, `target: "ES2024"`, `exclude` array with `test/`, `graphify-out/`, `.forgejo-local/`. The old `include` array restricting to `lib/core/**/*.js` and `lib/commands/**/*.js` was correctly removed.
2. **package.json scripts** — `build: "tsc"`, `prepublishOnly: "tsc"`, `typecheck: "tsc --noEmit"` all present and correct.
3. **package.json devDependencies** — `@typescript-eslint/parser: "^7.0.0"` and `@typescript-eslint/eslint-plugin: "^7.0.0"` added. Existing fields (name, version, main, bin, engines, files, repository, keywords, bugs, homepage, license, private, publishConfig) all preserved.
4. **.npmignore** — No `.ts` exclusion entry exists. Confirmed by reading the file.
5. **scripts/verify-local.sh** — Updated Stage 2 from `tsc --checkJs --noEmit` to `npm run typecheck` with TS18003 filtered out. This is a reasonable adaptation to the new tsconfig mode. The script correctly handles the case where no .ts files exist.
6. **package-lock.json** — 414 lines added, expected from `npm install`.

### Out-of-Scope Changes (Material Scope Violations)
1. **`lib/commands/integrate.js`** — 7 lines removed (mission telemetry logging in `recordPostIntegrationStats`). **Restricted area violation.** The mission explicitly states: "Do not modify any file under `lib/`".
2. **`test/integrate.test.js`** — 87 lines deleted: 2 assertion removals and 2 entire test cases (`recordPostIntegrationStats prints mission-phase telemetry after weekly stats`, `recordPostIntegrationStats handles empty mission-phase rows gracefully`). **Restricted area violation.** The mission explicitly states: "Do not modify any test file under `test/`".
3. **Deletion of entire mission directories** — `missions/task-1355/` (7 files), `missions/task-1377/` (11 files), `missions/task-1378/` (6 files). These are complete mission artifacts including CP documents, MISSION.md, review events, and review-state.json.
4. **Deletion of backlog task files** — `backlog/tasks/task-1379 - Replace-agent-usage-size-signal-with-Net-Engineering-Lines-NEL-bucket-capture-actual-at-handoff.md`.
5. **Deletion of documentation** — `docs/adr/0047-per-mission-change-size-budget.md`, `docs/use-cases.md` (44 lines). Modified `docs/adr/index.md` and `docs/use-cases.md`. **Restricted area violation.** The mission states: "Do not modify `docs/`".
6. **Renaming of completed task files** — Two files renamed from `backlog/completed/` to `backlog/tasks/` (task-1355 and task-1378).
7. **`scripts/verify-local.sh` scope question** — While the tsc stage update is reasonable, modifying `scripts/` is also outside the stated scope. The mission does not mention updating verification scripts.

## Final Checkpoint Document Review

### CP-1.md (tsconfig.json)
- Goal Check table: 11 criteria, all with file:line references. Evidence matches the actual tsconfig.json content.
- Line references (tsconfig.json:3 through tsconfig.json:14) are accurate for the current file.
- Note: `npm run typecheck` exits with TS18003 — this is expected per the mission assumption at MISSION.md:56 (no .ts files exist).

### CP-2.md (package.json)
- Goal Check table: 8 criteria. Evidence references are mostly accurate.
- `package.json:50` through `package.json:59` line references are correct for the current file.
- `npm run build` claim: correctly notes TS18003 is expected.

### CP-3.md (.npmignore)
- Goal Check table: 3 criteria. Evidence is credible.
- `grep -n '^\.ts' .npmignore` returning exit code 1 is confirmed by reading the file.
- Missing concrete evidence: `npm pack --dry-run` output is referenced but not included.

### CP-4.md (Test Suite)
- **Evidence issue:** Claims `npm test` output shows `pass 1687` at `package.json:52`. Line 52 of package.json is `"test": "FORCE_COLOR=0 node --test test/*.test.js"` — the test command itself, not test output. The line number citation is incorrect.
- Test count of 1687 passes seems unusually high. Should be verified against actual test output.
- Gate claims (`verify-local.sh docs` and `verify-local.sh static-analysis`) are asserted but no output is provided as evidence.

## Correctness Assessment

### tsconfig.json
- `allowJs: false` + `checkJs: false` removes type-checking of existing .js files. This is an acknowledged risk in the mission (MISSION.md:57) with mitigation via the upcoming eslint-ts-config mission. Acceptable.
- `noEmit: false` + `outDir: "."` means tsc will emit .js alongside .ts sources. Since no .ts files exist yet, this is safe. Acceptable.
- `exclude` array is additive to implicit `node_modules` exclusion. Correct per TypeScript docs.
- No `include` array means tsc will scan all directories except excluded ones. This is broader than the old config but intentional per mission scope.

### package.json
- `prepublishOnly: "tsc"` — The `files` array only lists .js files, so `tsc` won't encounter .ts files to type-check during publish. Safe.
- `@typescript-eslint/*@^7` with `eslint@^8.57.0` — npm install succeeded, confirming compatibility.

### verify-local.sh
- Stage 2 now runs `npm run typecheck` with TS18003 filtered. This is correct for the new tsconfig mode.
- Stage 1 (ESLint) and Stage 3 (test-hygiene) unchanged.

## Regression Risk

1. **lib/commands/integrate.js change** removes mission telemetry logging (`renderMissionPhaseReport`). This is a functional regression if any consumers rely on this output. Tests were accordingly removed, but the scope violation is the primary concern.
2. **Deleted mission directories** (task-1355, task-1377, task-1378) — irreversible loss of mission artifacts. Could affect audit trails or downstream processes.
3. **Deleted test cases** — the two mission-phase telemetry tests are gone. If that feature is restored, the tests won't be.

## Security Assessment
- No secrets, credentials, or sensitive data exposed in the diff.
- `npm install` of `@typescript-eslint/*@^7.0.0` — standard packages, no unusual permissions.
- `prepublishOnly: "tsc"` hook is safe (only runs tsc, no arbitrary commands).

## Integration Assessment
- The tsconfig.json change is foundational — all subsequent TypeScript conversion missions depend on this working. The core changes are sound.
- The out-of-scope deletions of other mission directories could disrupt parallel mission workflows.
- The verify-local.sh update is necessary for the new tsc mode to work correctly in the gate pipeline.

## Inconsistency Report
- The diff contains massive scope expansion beyond task-1365: deleting 3 entire missions (~40 files), modifying restricted areas (lib/, test/, docs/), and deleting backlog tasks. These appear to be cleanup/consolidation activities unrelated to the TypeScript infrastructure setup. The mission document makes no mention of these changes. This is a workflow/state inconsistency — either the mission scope was expanded without updating MISSION.md, or out-of-scope changes were grafted onto this branch.

---
`[workflow-round:1, workflow-phase:reviewing]`