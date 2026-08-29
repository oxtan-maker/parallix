# Mission: Rebounce does not fire for declared gate failures on review --submit (task-2439)

## Goal

Make `px review <slug> --submit` reject malformed declared gates before shell execution and route agent-fixable declared-gate failures through the ADR 0048 rebound kernel, so the implementer receives a bounded, verified repair attempt instead of the task stranding in `active` with a raw shell error.

## Why Now

Task-2431 exposed a deterministic failure in the review-submit handoff path: a gate line with balanced parenthesized outcome prose passed `validateDeclaredGates`, was executed verbatim through `bash -c`, and failed under a Swedish shell locale. Step 2.6 then returned a hard-blocking handoff result without entering the rebound kernel. This bypasses the behavior task-2353 and ADR 0048 established for agent-fixable gate failures and requires an operator to diagnose and restart work manually.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one regression-first review-submit fixture, declared-gate suffix validation, structured malformed-gate classification independent of shell locale, and rebound-kernel wiring with bounded verification.

## Scope

- Add `test/task-2439-rebounce-review-submit-repro.test.ts` to reproduce a `px review <slug> --submit` handoff whose `MISSION.md` declares `./scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)`.
- Update `src/application/handoff-command-use-case.ts` so a parenthesized or other non-command declared-gate suffix is rejected by `validateDeclaredGates` with the existing exact-runnable-command diagnostic before `bash -c` is invoked.
- Carry declared-gate validation and execution failures from the Step 2.6 handoff result as structured rebound evidence, including the declared command and captured process output when a command did run.
- Update the `px review --submit` path in `src/adapters/review/review-commands.ts` and/or its application seam so a relaunchable declared-gate failure uses `src/application/rebound-kernel.ts`, returns the mission to `active` for repair, launches the implementer under the kernel's bounded retry policy, re-runs the failed submission check, and resumes submission only after verification succeeds.
- Update `src/application/failure-classification.ts` only as needed so malformed declared-gate evidence is classified as `MalformedGates` / `AutoRepair` from structured validation evidence rather than locale-specific Bash wording; preserve ADR 0048's `GateFailure` / `AutoSendBack` classification for a command that actually executes and exits non-zero.
- Add focused unit coverage for the validator and review-submit/rebound behavior, including equivalent English and Swedish Bash syntax diagnostics where classification is exercised.

Reproduction-Test: test/task-2439-rebounce-review-submit-repro.test.ts

## Out of Scope

- Changing the text or layout of any unrelated mission's `MISSION.md`.
- Altering generic verification-gate, gatekeeper, rebase, Forgejo, reviewer-selection, or integration behavior.
- Changing ADR 0048's dispatch table beyond the structured malformed-gate evidence needed by this path.
- Adding retries beyond the rebound kernel's existing bounded policy or persisting a separate retry counter.
- Translating shell output, changing the operator's locale, or treating localized shell text as the primary failure contract.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `test/task-2439-rebounce-review-submit-repro.test.ts` fails at this mission's parent commit because submitting a mission with `./scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)` reaches the hard-block path instead of the expected validation/rebound behavior, and passes after the implementation.
- SC2: `validateDeclaredGates` rejects the parenthesized declaration in SC1 before invoking `bash -c`, returns `reason: 'validation-failed'`, and includes `Gate declaration must contain an exact runnable command only` in its diagnostic.
- SC3: A declared gate that reaches process execution and exits non-zero during `px review <slug> --submit` is represented as structured gate-failure evidence and is dispatched by `rebound` as `GateFailure` / `AutoSendBack`; the implementer receives the failed command and diagnostic in the repair prompt.
- SC4: A malformed declared-gate validation failure during `px review <slug> --submit` is dispatched as `MalformedGates` / `AutoRepair` without relying on English-only matching of Bash's `syntax error` text; English and Swedish syntax diagnostics yield the same classification where raw diagnostics are supplied.
- SC5: For each relaunchable declared-gate failure in SC3 or SC4, the review-submit flow transitions the task to `active`, launches through `src/application/rebound-kernel.ts`, re-runs the failed check after repair, and proceeds with submission only when that re-run succeeds; an unrepaired failure stops after the kernel's existing bounded retry limit.
- SC6: Existing declared-gate behavior remains intact: an exact runnable gate that exits zero is accepted and submission continues, while a non-runnable declaration is never passed to `bash -c`.
- SC7: `./scripts/verify-local.sh all` exits 0 on the final tree.

## Risks and Assumptions

- Risk: Calling rebound from the review-submit boundary can duplicate the handoff-level recovery loop. Mitigation: establish one ownership boundary and test that a single incident consumes only the kernel's bounded attempts.
- Risk: Validation errors do not have a shell exit code or output. Mitigation: introduce explicit structured malformed-gate evidence instead of inferring a class from formatted error text.
- Risk: Test doubles for handoff, lifecycle transition, and agent launch can omit a dependency that production supplies. Mitigation: model the review-submit seam with injected ports and assert command, transition, prompt, and retry outcomes.
- Assumption: ADR 0048 remains authoritative: malformed declarations are `MalformedGates` / `AutoRepair`, while a declared command that actually exits non-zero is `GateFailure` / `AutoSendBack`.
- Assumption: The current rebound kernel's in-memory bounded retry policy is the only retry budget required for this incident.

## Checkpoints

- CP 1: Author the failing reproduction test at `test/task-2439-rebounce-review-submit-repro.test.ts` before any fix. Construct a mission fixture whose `## Gates` line is `./scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)`, invoke the `px review <slug> --submit` seam with mocked handoff/review dependencies, and assert the desired behavior: the malformed declaration is treated as a validation/rebound incident, not executed by Bash, and the task is not stranded by the raw shell-error path. This test must be red at the mission parent commit and green after the fix.
- CP 2: Extend declared-gate validation in `src/application/handoff-command-use-case.ts` to reject the fixture's parenthesized prose suffix and produce the exact-runnable-command diagnostic before process execution. Add focused validator assertions for parenthesized and already-supported prose suffixes, while retaining exact command acceptance.
- CP 3: Wire the Step 2.6 declared-gate failure result through the review-submit recovery owner and `src/application/rebound-kernel.ts`. Add tests proving `MalformedGates` / `AutoRepair` for structured validation evidence, `GateFailure` / `AutoSendBack` for a real non-zero gate result, active transition, implementer prompt, re-verification, successful submission after repair, and bounded exhaustion when the condition remains.
- CP 4: Make malformed-gate classification locale-independent by testing the same outcome for English and Swedish Bash syntax diagnostics where diagnostic text enters the classifier. Run the full repository verifier and record final Goal Check evidence.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include durable evidence first: exact test names, ADR references such as `ADR 0048`, test file paths such as `test/task-2439-rebounce-review-submit-repro.test.ts`, and recognized repository commands or paths such as `npm test -- test/task-2439-rebounce-review-submit-repro.test.ts`, `node --test test/task-2439-rebounce-review-submit-repro.test.ts`, `git diff --check`, `px review <slug> --submit`, or `./scripts/verify-local.sh all`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document MUST also include:

- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited Markdown table `| Criterion | Evidence | Status |`, with at least one durable evidence row for every success criterion addressed by that checkpoint.
- A non-generic `Next action:` line at the bottom.

Raw `stat`/`ls` output or generic prose alone is not enough. It may appear as supplemental context only when paired with an accepted test name, ADR reference, test file path, recognized command, or recognized repository path above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1 reproduction locks the former hard block | `test/task-2439-rebounce-review-submit-repro.test.ts`, exact test name | PASS |
| SC4 uses ADR 0048 dispatch independent of locale | `ADR 0048`, `src/application/failure-classification.ts` | PASS |
| SC7 repository verification completed | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `missions/task-2431/MISSION.md` and every other mission contract — do not alter historical gate declarations as part of this implementation.
- `src/adapters/forgejo/` and Forgejo network behavior — the defect is local declared-gate/rebound control flow, not provider transport.
- `src/adapters/cli/commands/integrate.ts` and integration pipelines — integration is not part of review-submit recovery.
- `src/adapters/review/review-loop.ts` except for a necessary shared seam with no behavioral change outside `px review --submit` — the existing pre-review rebound flow is the comparison point, not the primary target.
- `docs/adr/0048-fail-closed-harness-defense.md` — apply its decision matrix; do not revise the ADR.

## Stop Rules

- Stop and request direction if satisfying the flow requires changing ADR 0048's `MalformedGates` / `AutoRepair` or `GateFailure` / `AutoSendBack` decisions.
- Stop and request direction if the implementation needs a new persisted retry counter, a retry budget larger than the rebound kernel's current bound, or parallel recovery owners for the same declared-gate incident.
- Stop and request direction if the only way to reproduce the bug requires real Forgejo access, a real agent launch, or an external shell locale; preserve it as a fully mocked unit test.
- Do not treat a raw Bash syntax diagnostic as the authoritative malformed-gate signal when structured validation evidence is available.
- Do not invoke `bash -c` for a declaration rejected by `validateDeclaredGates`.
