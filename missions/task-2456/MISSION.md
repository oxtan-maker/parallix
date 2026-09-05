# Mission: handoff retry treats duplicate lane event as failure (task-2456)

## Goal
Fix `MissionLifecycleService.transition` so that a `Duplicate idempotency key`
refusal from the lane-event store is treated as a **successful replay** of an
already-persisted, idempotent lifecycle transition instead of a terminal
`conflict`. A retried `px handoff` whose `submit-for-review` transition has
already committed must complete and synchronise the Backlog task to `review`
rather than bombing before backlog sync. Conflicts are preserved for
non-idempotent transitions whose collision is not a replay of persisted state.

## Why Now
`performHandoff` (
`src/application/handoff-command-use-case.ts`) intentionally passes the stable
idempotency key `handoff-${slug}` to the review transition so the lane-event
`UNIQUE` constraint deduplicates a retried handoff. That intent is defeated at
`src/application/mission-lifecycle-service.ts`: the catch block maps any
`Duplicate idempotency key` to `failure('conflict', …)`. Because the key is
stable, a genuine retry after the review transition committed collides and the
service reports a conflict, so the otherwise-completed handoff fails before the
Backlog task is synchronised to `review`. Task 2339 stabilised the key but left
the service's duplicate-key handling unresolved. This is a regression in the
handoff retry/recovery path that the rebound kernel already exercises.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single-service regression fix in the lifecycle transition path; one red-to-green reproduction test; no public CLI, schema, or ADR change.

## Scope
- In scope:
  - `src/application/mission-lifecycle-service.ts` — `transition()`: reclassify a `Duplicate idempotency key` from `conflict` to a successful replay of the already-persisted state for idempotent, no-op lifecycle transitions.
  - `src/application/mission-integration-service.ts` — `decideIntegration()` and `close()`: apply the same idempotent-replay treatment so all `saveWithTransition` callers honour the stable-key intent (only where the collision denotes a replay; preserve conflicts otherwise).
  - `test/` — one red-to-green reproduction that retries a `submit-for-review` transition after its lane event has committed and asserts the service returns `completed` (was `conflict`), plus a case asserting a non-idempotent duplicate key stays a `conflict`.
  - Evidence in the final checkpoint via recognised repo commands, test names, and test file paths.
- Out of scope:
  - Changing the idempotency-key shape (already stable per task 2339).
  - Any change to `decideMission` domain rules in `src/domain/mission-workflow.ts`.
  - Forgejo, PR, gatekeeper, NEL, or Backlog-file write paths — only the Mission state transition is touched.
  - New migrations, schema, or ADRs.

## Out of Scope
- Rewriting the handoff retry budget, the rebound kernel, or `performHandoff` sequencing.
- Adding new ports, configuration, or public CLI surface.
- Documenting this as a user-facing behaviour change beyond the checkpoint evidence.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no
> unmetriced adjectives or vague quantifiers.

- SC1: A retried `submit-for-review` transition whose `active → review` lane event already committed, issued with the same stable idempotency key `handoff-${slug}`, returns `status === 'completed'` with `to === 'review'` and the persisted version — not `failure('conflict', …)`.
- SC2: A `Duplicate idempotency key` on a transition that is not a replay of already-persisted state (a genuinely distinct, non-idempotent transition that reuses a key) still returns `failure('conflict', …)`.
- SC3: The reproduction test at the path declared in `Reproduction-Test:` is `failed` (red) at parent commit `22c4ec55d` and `passed` (green) after the fix, measured by running the test alone.
- SC4: `./scripts/verify-local.sh all` exits `0` on the final tree, with proof captured in the final checkpoint's Goal Check table.
- SC5: ESLint, `tsc --checkJs`, and test-hygiene report zero findings on every changed file under `./scripts/verify-local.sh static-analysis`.
- SC6: No `.only` and no bare `.skip` exist in any test file touched by the mission.
- SC7: The final checkpoint `## Goal Check` table cites at least one durable reference per criterion (exact test name, test file path, ADR reference, or recognised repo command/path).

## Risks and Assumptions
- Assumption: a reused stable idempotency key denotes an idempotent retry. The discriminator between "replay" (→ completed) and "non-idempotent collision" (→ conflict) must be derived from whether the target lane/aggregate is already persisted, not from the incoming command alone. Implementer must make this explicit and narrow.
- Risk: over-broad replay handling could mask a genuine concurrent-write collision. The fix must keep the `MissionStaleWriteError` / stale-version path a conflict and only collapse the `Duplicate idempotency key` path for idempotent replays.
- Assumption: the reproduction can be driven deterministically through `MissionLifecycleService` against a temp SQLite store (no Forgejo, no CLI subprocess, no agent launch), matching the pattern in `test/task-2379-approval-boundary-repro.test.ts`.
- Risk: the fix touches every `saveWithTransition` caller; an incorrect change to `decideIntegration`/`close` could alter integration/closure conflict semantics. Scope the replay handling identically to the lifecycle service and cover it with the SC2 case.
- Assumption: parent commit is `22c4ec55d` (chore: bump version to 1.5.69). Verify with `git log -1 --format=%H` before authoring the red test.

## Checkpoints
- CP 1: Author the red-to-green reproduction test that locks the bug (before any fix). Reproduce a `submit-for-review` transition whose `active → review` lane event is already committed, then retry with the same stable key `handoff-${slug}` and assert the service returns `completed` (it returns `conflict` at parent). Also assert a non-idempotent duplicate key stays `conflict`.
- CP 2: Implement the idempotent-replay treatment in `MissionLifecycleService.transition` and, consistently, in `MissionIntegrationService.decideIntegration`/`close`. Preserve the conflict mapping for non-idempotent collisions.
- CP 3: Verify — run the reproduction green, run the full gate, and author the final checkpoint Goal Check table with durable evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2456-handoff-retry-duplicate-lane-event.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — must match a test name in the repo
  3. **Test file paths** — e.g., `test/task-2456-handoff-retry-duplicate-lane-event.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. This is a known weak-agent failure mode: raw `ls`/`stat` output or prose like "the test passes" is NOT sufficient evidence — pair any shell output with one of the accepted references (an exact test name, a test file path, an ADR reference, or a backticked `npm`/`node`/`git`/`px`/`./` command).
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `src/domain/mission-workflow.ts` (domain state-machine rules).
- Do not modify the idempotency-key construction in `src/application/lifecycle-lane-event.ts` or the `handoff-${slug}` key site in `src/application/handoff-command-use-case.ts`.
- Do not touch Forgejo/PR, gatekeeper, NEL, or Backlog-file-write adapters.
- Do not add migrations, schema changes, or ADRs.
- Do not alter the handoff retry budget or the rebound kernel.

## Stop Rules
- Stop implementing once SC1–SC7 are satisfied and the final checkpoint Goal Check table is populated with durable evidence.
- Do not push the mission branch to `origin` (review/Forgejo push only, per repo policy).
- Do not run anything beyond the single `./scripts/verify-local.sh all` verification gate as your correctness check.
- Do not expand scope to the domain rules, key shape, or other handoff boundaries without re-scope.

Reproduction-Test: test/task-2456-handoff-retry-duplicate-lane-event.test.ts
