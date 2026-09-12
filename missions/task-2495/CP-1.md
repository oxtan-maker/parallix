# CP-1: Inventory of every `mission-start` reference

Inventory of every `mission-start` surface across CLI registration, composition,
runtime, adapter execution, help/suggestions, tests, and prompts. The central
finding: the `missionStart` function is the single shared startup-preflight
implementation used by three call sites — the `px mission-start` command (to be
removed), the `px verify-env` command (supported, keep), and the `px active`
execute preflight (supported, keep). Removing the command surface therefore
requires renaming the module so that no production file imports a
`mission-start` module, while the preflight function itself is preserved.

## Scope of the change

Production references (all under `src/`):

- `src/adapters/cli/mission-start.ts` — the implementation. Renamed to
  `src/adapters/cli/startup-preflight.ts`; the function is renamed
  `startupPreflight`. The `cli` adapter package is the only package whose named
  dependency rules (`adapterPackageDependencies['cli']`) permit its imports
  (git, backlog, forgejo, review, config, filesystem, `application/presentation`);
  the `mission` package cannot import those directly, so the preflight stays in
  `cli`.
- `src/composition/create-cli.ts` — `'mission-start': missionStart` registry entry
  (removed), `'verify-env': missionStart` (kept, repointed), dynamic import +
  `verify-env` dispatch in `run()` (repointed to `startup-preflight.js`).
- `src/interfaces/cli/runtime.ts` — `KNOWN_COMMANDS` entry (removed),
  `printUsage` Core Commands line (removed).
- `src/adapters/mission/execute-mission-adapters.ts` — `preflight: missionStart`
  runtime binding (repointed to `startupPreflight` so `px active` keeps its
  startup preflight).

Test references that must be updated:

- `test/mission-start.test.ts`, `test/active.test.ts`,
  `test/task-2200-classification-bug-label.test.ts`,
  `test/forgejo-independence.test.ts` — import the renamed module.
- `test/index.test.ts` — `KNOWN_COMMANDS` expected list,
  `/mission-start/` help assertion, and `CORE_LIFECYCLE` (seven → six lifecycle
  commands) must drop `mission-start`.
- `test/install.test.ts` — usage assertion no longer finds `mission-start`.
- `test/external-target-resolution.test.ts` — spawns
  `px mission-start verify-env`; repointed to `px verify-env` (the supported
  command) so the temp-dir path-resolution assertion still holds.

Focused regression tests to add:

- Command absence: `main(['mission-start'], …)` with an injected empty command
  registry resolves to `Unknown command: mission-start` and never reaches
  preflight.
- `px active` preflight retention: exercise `px active` and assert the
  startup-preflight effect (already covered by `test/active.test.ts`; the
  `completePreflightOrExit` returnResult path is asserted there).

## Untouched (verified clean)

- `prompts/act-on-review-core.md` and `prompts/draft-core.md` contain no
  instruction to run `px mission-start` (grep `mission-start`, `mission start`,
  `preflight`, `px active` → no matches). The prompt half of scope is already
  satisfied; no edit is made.
- Historical mission records under `missions/*/` are not changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every `mission-start` production reference inventoried | `src/adapters/cli/mission-start.ts`, `src/composition/create-cli.ts:46,208-209,496-533`, `src/interfaces/cli/runtime.ts:21,238`, `src/adapters/mission/execute-mission-adapters.ts:3,41,235` | PASS |
| Call sites that must keep the preflight identified | `px verify-env` (`create-cli.ts:533`), `px active` execute preflight (`src/application/execute-mission-service.ts:146` → `MissionWorkspaceAdapter.preflight` → `missionStart`) | PASS |
| Boundary constraint pins preflight to the `cli` package | `src/adapters/architecture/boundary-guards.ts` `adapterPackageDependencies['cli']` vs `['mission']` | PASS |
| Prompt guidance already absent | `grep -rn "mission-start" prompts/act-on-review-core.md prompts/draft-core.md` → no matches | PASS |
| Baseline tests green before change | `node --experimental-test-module-mocks --import tsx --test test/mission-start.test.ts` → 16 pass / 0 fail | PASS |
| Focused regression targets identified | command-absence via `main()`; `active.test.ts` `completePreflightOrExit` returnResult path | PASS |

Next action: CP-2 — rename the module to `startup-preflight.ts`, repoint all
production and test imports, drop the command registration/help/suggestions, and
add the command-absence regression test.
