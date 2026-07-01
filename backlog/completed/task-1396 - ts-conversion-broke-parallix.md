---
id: TASK-1396
title: ts conversion broke parallix
status: done
assignee:
  - custom
created_date: '2026-07-01 06:09'
updated_date: '2026-07-01 16:19'
labels:
  - user_value
  - bug
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
magnus@debian:~/code/parallix-task-1395$ node px.ts active
[INFO] Running execute preflight...
[FAIL] missionStartFn is not a function

After the TypeScript conversion, the `active` command is broken:
1. `active` — `missionStartFn is not a function` (active.ts imports the module namespace `* as missionStart` then uses it as a function default)

Note: The `checkpoint` command also had a related issue (`Command module 'checkpoint' does not export a function`) but fixing it required changes to `index.ts`, which was out of scope for this mission. That fix was reverted and should be tracked as a separate task.

All parallix commands must work correctly: mission-start, verify-env, verify, setup, setup-review, draft, active, status, checkpoint, review, handoff, integrate, resolve-conflict, rebase, stats, aliases, config, diff, repair-handoff, stats-backfill, coverage-gate, shell-init, version.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 px active does not throw 'missionStartFn is not a function'
- [x] #2 npm test passes (no regressions)
- [x] #3 Bug-labeled: red-to-green reproduction test added for the fixed command
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Fixes

One command fixed after the TypeScript conversion:

**Bug 1 — `px active`: `missionStartFn is not a function`**
- Root cause: `active.ts:6` used `import * as missionStart from './mission-start.js'`. After `build:cjs` with `esModuleInterop`, this compiled to `__importStar(require('./mission-start.js'))` — a namespace object, not a function. Assigning it as the default for `missionStartFn` caused a TypeError at the call site (`active.ts:65`).
- Fix: Changed to `import missionStart from './mission-start.js'` (default import), which compiles to `__importDefault(...)?.default` — the actual function.
- Commit: `cdf369c4`

## Descoped

**Bug 2 — `px checkpoint`: `Command module 'checkpoint' does not export a function`**
- This bug was real but fixing it required changes to `index.ts`, which was explicitly out of scope per the locked MISSION.md restricted areas. The out-of-scope fix (commit `759068bb`) was reverted in commit `13db1732` and should be tracked as a separate, properly scoped task.

## Evidence

- `node px.js active` → `[INFO] Running execute preflight...` ✓
- `node --test test/task-1396-repro.test.js` → 2/2 pass ✓
- `npm test` → 1739 pass, 0 fail, 22 skipped ✓

## Tests Added

`test/task-1396-repro.test.js` (2 tests):
- `active throws "missionStartFn is not a function" when passed a namespace object (task-1396 repro)`
- `active succeeds when missionStartFn is the default export function (task-1396 fix verified)`
<!-- SECTION:FINAL_SUMMARY:END -->
