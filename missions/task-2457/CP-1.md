# Checkpoint 1 — Reproduction test for repository-configured gates

## Summary
Started the mission on TDD. Added `test/task-2457-repro.test.ts`, which encodes
the two core invariants before production behavior existed, plus the minimal
generic gate runner it exercises.

- `test/task-2457-repro.test.ts` asserts (a) an unconfigured fixture checkout
  invokes no gate command, and (b) a configured pre-handoff gate that exits
  non-zero blocks the phase and receives the mission slug, checkout path, and
  exact phase identifier through its environment.
- `src/adapters/config/repository-gates.ts` is the generic, language-neutral
  runner these tests drive: `loadPhaseGates`, `loadRepositoryGates`,
  `validateRepositoryGates`, `buildGateEnv`, `runPhaseGates`. It owns no
  Node/npm/tsx/`scripts/verify-local.sh`/Parallix-directory policy — selection
  is owned by repository configuration.

The test is red on the parent commit (`29a1bd1ab`): importing
`src/adapters/config/repository-gates.js` fails because the module does not
exist. It is green once the runner lands.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repro test proves unconfigured repo runs no gate | `test/task-2457-repro.test.ts`, `"unconfigured repository runs no gate for the handoff phase"` | PASS |
| Repro test proves configured failing gate blocks handoff | `test/task-2457-repro.test.ts`, `"configured failing pre-handoff gate blocks handoff and receives the phase contract"` | PASS |
| Repro test is red on parent commit | import of `src/adapters/config/repository-gates.js` unresolved at `29a1bd1ab` (verified: `Could not find 'test/task-2457-repro.test.ts'` when files removed) | PASS |
| Repro test green with runner present | `npm test -- test/task-2457-repro.test.ts` → 7 pass, 0 fail | PASS |
| Runner exposes env contract (slug/checkout/phase) | `test/task-2457-repro.test.ts`, `"buildGateEnv inherits the invoking environment and sets the three contract keys"` | PASS |

## Next action
CP 2: add `adapters.gates` to the workflow schema, wire `validateRepositoryGates`
into `validateWorkflowConfig`, surface the effective gates through `px config`,
and document the fields in `docs/config.md`; verify omission runs no gate.
