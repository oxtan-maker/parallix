# Mission: Fix `missionStartFn is not a function` regression in `px active` (task-1396)

## Goal

Restore `px active` so it runs the mission-start preflight without throwing `missionStartFn is not a function`. The fix is a one-line import correction in `lib/commands/active.ts`: change `import * as missionStart from './mission-start.js'` to `import missionStart from './mission-start.js'` so that the default export (the function) is used directly instead of an `__importStar` namespace wrapper.

## Why Now

The regression was reported live by a maintainer running `px active` in a target repository. The `active` command is the primary entry point for launching the execute agent; without it, no mission can progress past the draft stage. This blocks all downstream workflow operations (handoff, review, integrate).

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: Root cause is obvious from the stack trace; fix is a single import statement.
- Main drivers: `px active` is completely broken; the fix is a known TypeScript/esModuleInterop interop pattern.

## Scope

- **In scope:**
  1. Change `import * as missionStart from './mission-start.js'` to `import missionStart from './mission-start.js'` in `lib/commands/active.ts` (line 6).
  2. Verify the compiled output no longer wraps the function in `__importStar`.
  3. Add a reproduction test in `test/task-1396-repro.test.js` that proves the namespace-object is not callable and that passing the function directly works.
  4. Ensure all existing tests continue to pass.

## Out of Scope

- Any changes to `lib/commands/mission-start.ts` (the module itself is correct).
- Changes to any other `import * as` patterns in the codebase (they are not affected because they access named properties, not call the namespace).
- Runtime or build-system changes.
- Changes to `px.ts` or `index.ts`.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `px active [<slug>]` executes the preflight step without throwing `TypeError: missionStartFn is not a function` when run from a target repository directory.
2. `lib/commands/active.ts` line 6 uses `import missionStart from './mission-start.js'` (default import, not namespace `import * as`).
3. The compiled `lib/commands/active.js` (CJS build) does NOT contain `__importStar` applied to the `mission-start.js` require — the `missionStart` variable holds the function directly.
4. `npm test` passes all 1737+ existing tests with zero regressions.
5. The reproduction test `test/task-1396-repro.test.js` exists and passes, demonstrating that a namespace object is not callable and that the function works correctly.
6. No other file in `lib/commands/` or `lib/` was modified except `lib/commands/active.ts` and `test/task-1396-repro.test.js`.

## Risks and Assumptions

- **Assumption:** The `mission-start.ts` module exports a single default function (`missionStart`) plus a static property (`completePreflightOrExit`). Both are preserved on the default export, so switching from namespace to default import does not lose any functionality.
- **Risk:** If any other code in `active.ts` references `missionStart.<namedProperty>`, that access would break. Verified: `active.ts` only uses `missionStart` as the `missionStartFn` default — it never accesses `missionStart.something`.
- **Risk:** The fix only affects the ESM→CJS compiled output. The `@ts-nocheck` annotation on `active.ts` means TypeScript does not catch this at compile time. Adding a simple runtime type check or removing `@ts-nocheck` could prevent future regressions but is out of scope.
- **Assumption:** The existing test suite does not exercise the `active` command's preflight path (it uses injectable dependencies), so the regression was undetected by tests.

## Checkpoints

- CP 1: Reproduction test authored. `test/task-1396-repro.test.js` contains a test that fails with `TypeError: missionStartFn is not a function` when `missionStartFn` is a namespace object (mirroring the bug), and a companion test that passes when `missionStartFn` is the function directly.
- CP 2: Fix applied. `lib/commands/active.ts` line 6 changed to `import missionStart from './mission-start.js'`. Compiled output verified. All tests pass.

## Gates

- [ ] npm test (pretest runs build:cjs; all existing tests must pass)
- [ ] npm run build:cjs (CJS build must succeed without errors)

## Restricted Areas

- Do not modify `lib/commands/mission-start.ts` — the module is correct; the bug is in the consumer.
- Do not modify any file outside `lib/commands/active.ts` and `test/task-1396-repro.test.js`.
- Do not change the `@ts-nocheck` annotation or add TypeScript strictness changes (out of scope).

## Stop Rules

- Stop immediately if `npm test` reveals regressions in unrelated tests.
- Stop if the compiled output shows any unexpected changes beyond the `missionStart` import.
- Stop if `mission-start.ts` lacks a default export (it does; verify before proceeding).

Reproduction-Test: test/task-1396-repro.test.js
