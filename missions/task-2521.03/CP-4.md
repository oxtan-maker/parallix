# CP-4: Execute-prompt write surface and mission closeout

## Summary

**Superseded. Do not use this as a closeout checkpoint.** It describes an old
`px mission`/checkpoint-file direction that later work changed. The current
authoritative continuation state is `MISSION.md`'s “Fresh-session handoff”.

The typed write surface landed in CP-1/CP-2 but no runtime prompt named it, so
an implementer reading the execute prompt still had `px context` for reads and
nothing for writes. This checkpoint closes that gap and records the final state
of the mission.

- `prompts/execute-core.md` — names `px mission context update`,
  `px mission checkpoint record` and `px mission dependency add|remove` as the
  supported writes for the execute phase, states that `--expected-version`
  comes from the `version` field of `px context <slug> --json`, and states that
  a stale write is rejected with an explicit conflict and changes nothing.
  `--data-stdin` is named as transport that is never committed.
- Checkpoint evidence is now recorded with `px mission checkpoint record`
  first. The committed CP document stays as handoff transport that re-records
  the same checkpoint name; the prompt states plainly that it is never the
  authority for Mission state.
- Lifecycle, assignment and review writes are kept away from the implementer:
  `px mission transition`, `px mission assignment` and `px mission review` were
  added to the existing do-not-run list, so the widened write surface does not
  hand an execute agent a lane transition or a review verdict.
- Prompt-dependent guardrails updated with the intentional change:
  `test/fixtures/prompt-split-parent.json` regenerated for the execute stage,
  and the pinned wording assertions in `test/active.test.ts` and
  `test/task-2521-03-prompt-authority.test.ts` now assert the write surface and
  the stale-write contract rather than the sentence they previously pinned.

### Recorded gaps, deliberately out of scope

1. **Reviewer and refinement prompts still do not name review writes (AC #12,
   partial).** Reviewer decisions flow through the review-artifact adapter
   chain (`src/adapters/review/review-artifacts.ts`,
   `src/adapters/review/review-events.ts`,
   `src/composition/review-persistence.ts`), and the review prompt forbids the
   agent from invoking `px` beyond the two read-only commands. Pointing the
   reviewer at `px mission review decide` without first migrating that chain
   would produce two writers for one decision. The read half of AC #12 is met:
   the review prompt states that prior findings and resolutions come from
   `px context` and `px status` and must not be reconstructed from files.
2. **Handoff still requires a CP document.** `handoff-command-use-case.ts`
   finds `CP-*.md`, auto-generates one when absent, requires it committed,
   parses its Goal Check table and records it as durable evidence. Removing the
   prompt instruction to commit that document before this consumer is migrated
   would break `px review <slug> --start`. Both consumer migrations belong to
   the mission that retires the workflow files.
3. **Verification state is still not projected.** No Mission port exposes gate
   results; `buildCompletedControlsBlock` reads
   `<mission>/.workflow/gate-result.json`. Per the mission stop rule the
   projection reports `declaredGates` only. Persisting gate results is a schema
   change this mission is forbidden to make.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| AC #12 — the execute prompt names the typed write commands instead of a file edit | `"the execute prompt obtains context and records evidence through supported px commands"` (`test/task-2521-03-prompt-authority.test.ts`) asserts `px mission checkpoint record`, `px mission context update` and `px mission dependency add\|remove` | PASS |
| AC #10 — the prompt states where the version comes from and that a stale write changes nothing | `"the execute prompt obtains context and records evidence through supported px commands"` asserts `--expected-version` and `rejected with an explicit conflict and changes nothing` | PASS |
| Widened write surface does not hand the implementer lifecycle or review authority | `"buildExecutePrompt reserves Backlog lifecycle transitions for Parallix"` (`test/active.test.ts`) asserts the `px mission transition`/`px mission review` ban | PASS |
| No prompt presents a workflow file as the Mission database | `"no runtime prompt presents repository workflow metadata as the Mission database"`, `"no runtime prompt instructs an agent to write a CP-N.md file as durable evidence"` (`test/task-2521-03-prompt-authority.test.ts`) | PASS |
| Prompt-assembly guardrail still holds after the rewrite | the `task-2465-*` tests in `test/prompt-split.test.ts` — 18 pass, 0 fail | PASS |
| AC #7 — same-checkpoint replacement preserves domain semantics | `test/task-2521-03-context-cli.integration.test.ts` records `CP-1` twice and asserts `replaced === true` with a single `CP-1` retained | PASS |
| AC #14 — a rejected stale write leaves every field unchanged | `test/task-2521-03-context-cli.integration.test.ts` asserts `expected version 1, found 3` then re-reads and asserts `goal` is unchanged | PASS |
| AC #3 — the mutation-parity audit is falsifiable, not self-referential | `"task-2521.03: help enumerates exactly the dispatcher command surface"`, `"task-2521.03: mutation-parity audit gives every legacy write a reachable authority"` (`test/task-2521-03-mutation-parity.test.ts`) | PASS |
| Mission gate passes on the final tree (DoD #1) | `` `./scripts/verify-local.sh all` `` — exit 0, 2711 tests pass, 0 fail | PASS |
| Lint and static analysis clean on every changed file (DoD #2) | `` `./scripts/verify-local.sh static-analysis` `` — ESLint, tsc typecheck, test-hygiene and test typecheck all PASS | PASS |
| ADR consequence recorded without a new persistence ADR (DoD #5) | `ADR 0053` — "Mission execution context" consequence paragraph on the discoverable read-only command surface | PASS |

Next action: hand the mission to review; the reviewer should weigh the three
recorded gaps above — the reviewer/refinement half of AC #12, the handoff CP
document dependency, and the unprojected verification state — and decide
whether they are correctly deferred to the workflow-file retirement mission or
must be pulled back into this one.
