# CP-2: Command removed, wiring repointed, prompts verified, regression tests added

Removed the hallucinated `px mission-start` command surface, repointed the two
supported callers of the shared startup-preflight implementation to the renamed
module, verified the prompts already contain no `px mission-start` guidance, and
added a focused command-absence regression test.

## What changed

- **Implementation renamed, not deleted.** `src/adapters/cli/mission-start.ts`
  → `src/adapters/cli/startup-preflight.ts`; the function is now
  `startupPreflight` (default + named export; `completePreflightOrExit`
  unchanged). The `cli` package is the only package whose named dependency rules
  permit the preflight's imports, so it stays here and `px active` /
  `px verify-env` keep using the same logic.
- **Composition.** `src/composition/create-cli.ts`: dropped the
  `'mission-start': missionStart` registry entry; `'verify-env'` and the
  `run()` `verify-env` dispatch now import `../adapters/cli/startup-preflight.js`.
- **Runtime.** `src/interfaces/cli/runtime.ts`: removed `mission-start` from
  `KNOWN_COMMANDS` and the `printUsage` Core Commands block.
- **Adapter.** `src/adapters/mission/execute-mission-adapters.ts`: the
  `preflight` runtime binding now points at `startupPreflight`, so
  `px active` still runs startup preflight.
- **Production import graph.** No source file imports a `mission-start` module
  anymore.

## Tests updated / added

- Updated imports to the renamed module in `test/mission-start.test.ts`,
  `test/active.test.ts`, `test/task-2200-classification-bug-label.test.ts`,
  `test/forgejo-independence.test.ts`.
- `test/index.test.ts`: dropped `mission-start` from the `KNOWN_COMMANDS`
  expected list, the `/mission-start/` help assertion, and `CORE_LIFECYCLE`
  (seven → six lifecycle commands).
- `test/install.test.ts`: usage assertion now checks for `active`.
- `test/external-target-resolution.test.ts`: repointed the spawned command from
  `px mission-start verify-env` to `px verify-env` (the supported command) so the
  temp-dir path-resolution assertion still holds.
- **New** `test/mission-start-removal.test.ts`: asserts `KNOWN_COMMANDS` and
  `suggestCommand` no longer expose the command, and that `main(['mission-start'],
  …)` resolves to `Unknown command: mission-start`, prints usage, exits 1, and
  never emits a USABLE verdict. `px active` preflight retention is covered by
  `test/active.test.ts` (execute preflight path) and
  `test/execute-mission-adapters.test.ts` (`workspace adapter runs the execute
  preflight quiet`).

## Prompts

`prompts/act-on-review-core.md` and `prompts/draft-core.md` contain no
instruction to run `px mission-start` (grep returns no matches); no edit made.
Historical mission records were not touched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `px mission-start` absent from registration, help, suggestions, dispatch | `src/composition/create-cli.ts` no `'mission-start'` registry entry; `src/interfaces/cli/runtime.ts` `KNOWN_COMMANDS`/`printUsage` drop it; `test/mission-start-removal.test.ts` `"px mission-start resolves to Unknown command and never reaches preflight"` | PASS |
| No production import/reference to the removed command module | `grep -rn "mission-start" src/` → NONE; `src/adapters/cli/startup-preflight.ts` is the renamed module | PASS |
| Command adapter entry removed, preflight still wired for `px active` | `src/adapters/mission/execute-mission-adapters.ts:235` `preflight: startupPreflight` | PASS |
| `px active` executes startup preflight | `test/active.test.ts` `"active() success path: preflight, launch, and handoff run in order"` + `"active() exits 1 when preflight fails"`; `test/execute-mission-adapters.test.ts` `"workspace adapter runs the execute preflight quiet"` | PASS |
| Live prompts contain no `px mission-start` instruction | `grep -rn "mission-start" prompts/act-on-review-core.md prompts/draft-core.md` → no matches | PASS |
| Focused regression + gates pass, no `.only`/`.skip`, no unrelated changes | `test/mission-start-removal.test.ts`; `./scripts/verify-local.sh static-analysis` (all stages PASS); `./scripts/verify-local.sh all` → 2520 pass / 0 fail | PASS |

Next action: CP-3 — re-run the focused regression suite and both declared gates
one more time against the committed tree and record the final Goal Check.
