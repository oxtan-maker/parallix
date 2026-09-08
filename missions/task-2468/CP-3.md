# CP-3: Intake-independent prompt rendering + three-intake stubbed net

## Work summary

Consolidated the draft prompt around one intake-independent body with an
intake-specific substituted block, and extended the stubbed lifecycle net to
cover the adhoc-only intake.

**Prompt parity (one draft prompt, intake block substituted).**
- `prompts/draft.md` stays the single common draft prompt; the intake
  difference is confined to the `{{classificationInstructions}}` substitution
  block. `resolveClassificationInstructions`
  (`src/adapters/cli/commands/draft-prompts.ts`) returns the Backlog-task-label
  rule for a real Backlog task and the DB/mission-label rule for a synthetic
  (adhoc) task, so classification is readable and writable in both intakes
  without a second prompt file.
- `test/task-2468-prompt-parity.test.ts` asserts: (1) the two intakes
  substitute different intake blocks and the adhoc block names no Backlog task
  file; (2) after normalizing away the per-mission identity (slug + absolute
  paths) and the substituted block, the two rendered prompts are byte-identical
  — the intake difference is confined to that one block.

**Three-intake stubbed net.**
- The shared stub agent in `test/e2e-mission-lifecycle.test.ts` now resolves
  both namespaces from a prompt: `task-<…>` and the DB-owned
  `parallix-adhoc-<NNNN>` (capturing group widened in the slug parser). The
  execute-stub `CP-1` Goal Check row is conditional: it mirrors the Backlog task
  when one exists and otherwise cites the DB-authoritative adhoc identity, so a
  missing mirror never fails the checkpoint.
- Added `setupAdhocRepository` (a repository with **no `backlog/` directory** —
  intake case 2) and `runAdhocScenario`, which drives the real CLI through
  `draft` → `active` → `px review <slug> --status` and asserts the adhoc
  identity reaches an approved review read from DB authority.
- `test/task-2468-adhoc-lifecycle-repro.test.ts` remains the red→green anchor
  for the free-text first-value path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| One common draft prompt; intake difference confined to substituted block | `prompts/draft.md`, `src/adapters/cli/commands/draft-prompts.ts` `resolveClassificationInstructions` | PASS |
| Two intakes render prompts that differ only in the intake block; adhoc has no task-file instruction | `test/task-2468-prompt-parity.test.ts`, `"the common draft prompt body is intake-independent modulo identity and the intake block"` | PASS |
| Stub parses the new adhoc identity; three-intake net covers backlog-only and adhoc-only | `test/e2e-mission-lifecycle.test.ts`, `"adhoc-only intake: a free-text draft reaches an approved review with no Backlog task file"` | PASS |
| Missing Backlog mirror does not fail the execute checkpoint | `test/e2e-mission-lifecycle.test.ts` execute-stub `CP-1` conditional evidence row | PASS |
| Free-text adhoc draft reaches `active`/approved review without a Backlog task file | `test/task-2468-adhoc-lifecycle-repro.test.ts`, `test/e2e-mission-lifecycle.test.ts` | PASS |
| Static-analysis gate clean | `./scripts/verify-local.sh static-analysis` | PASS |
| Full integration gate clean | `./scripts/verify-local.sh all` (no failing tests) | PASS |

## Next action
CP-4: cover the mixed intake (Backlog + adhoc in one repository) and Backlog
mirror degradation (missing/moved mirror file mid-mission does not block
`active`/`review`/`integrate`) in the stubbed net; verify explicit
`px draft task-<N>` still rejects a missing/ambiguous task file; confirm
`px status` and `px integrate` accept the adhoc identity; record durable Goal
Check evidence and reconcile prompt composition with task-2465 if it landed.
