# Mission: Make interrupted landed integrations idempotently closeable (task-2508)

## Goal
Make a local squash commit that has already landed on the base branch an **idempotent closeout path**: a mission whose Forgejo review PR is already `merged` but whose SQLite `Mission` lifecycle is stuck at `integration` (not transitioned to `done`) and whose worktree was retained can be retried through `px integrate <slug>` to a terminal `done` with a non-null `closedAt`, cleaning up its worktree and branch exactly once. Forgejo merge state is treated as an informational projection, never as merge authority.

## Why Now
TASK-2502 landed its squash commit on `main` and Forgejo marked its review PR merged, but integration stopped before the SQLite `Mission` aggregate transitioned from `integration` to `done` and before worktree cleanup. A retry now fails at Forgejo's merged-PR preflight (`printIntegrationPreflight`, `src/adapters/cli/commands/integrate.ts` line ~1724 pushes `pr-merged`), so it never reaches the existing local-squash recovery/closeout path. The operator is left with a shipped task, a stranded `integration` lifecycle record, and a retained mission worktree. The idempotent closeout primitives (`persistLandedIntegrationOrAbort` → `decideIntegration` then `close`, then `cleanupMissionWorktree`) already exist and are keyed on the landed commit SHA; only the merged-PR preflight gate blocks them.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: stranded lifecycle state after a landed local squash; a merged Forgejo PR wrongly treated as an integration blocker; idempotent closeout primitives already present but unreachable.

## Scope
- `printIntegrationPreflight` in `src/adapters/cli/commands/integrate.ts`: a Forgejo PR in state `merged` must not be a preflight failure when the SQLite `Mission` lifecycle already reports `integration` or `done`. Constrain the exception to those two lifecycle states so an un-`done` mission that still needs an authoritative approval is not opened up.
- Reach and exercise the existing idempotent closeout in the `local` integration mode: `persistLandedIntegrationOrAbort` persists completion once via `missionServices.integration.decideIntegration` (idempotency key `integrate:${slug}:${landedCommit}`) and closure once via `missionServices.integration.close` (idempotency key `close:${slug}:${landedCommit}`), then `cleanupMissionWorktree` removes the worktree and branch exactly once.
- `px status <slug>` reports the authoritative SQLite `Mission` lifecycle status (`done`) through the BoardProjection rather than a stale raw backlog task status.
- Regression coverage that locks the interrupted-landed-integration state and proves idempotent closeout.

## Out of Scope
- GitHub PR / GitHub publish mode closeout (external-provider merge authority is unchanged).
- Review approval authority, review recovery, or any change to `recoverMissionForIntegration` lane logic for `active`/`review` missions.
- Un-merging Forgejo PRs, touching Forgejo merge state, or altering the normal (not-yet-landed) integration happy path.
- New schema, new persistence tables, or new domain aggregates — only the existing `Mission` lifecycle and idempotency keys are consumed.
- Backlog task promotion rules (promotion remains a closeout representation, never lifecycle authority).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and tied to a specific file, symbol, test, or repo command.

- SC1: A mission whose SQLite lifecycle is `integration` with a merged Forgejo PR reaches closeout and ends with `mission.status === 'done'` and a non-null `closedAt`. Falsify by asserting, in the reproduction/regression test, that `decideIntegration` and `close` each fire exactly once with the landed-commit idempotency keys and that the reloaded mission carries `closedAt !== null`.
- SC2: `printIntegrationPreflight` returns no `pr-merged` entry in its `failures` array when `context.missionStatus ∈ {integration, done}` and `context.pr.state === 'merged'`. Falsify by calling `printIntegrationPreflight` with that context at the parent commit (expect `failures` contains `pr-merged`, i.e. red) and after the fix (expect `failures` does not contain `pr-merged`, i.e. green).
- SC3: A resumed closeout removes the mission worktree and branch exactly once. Falsify by asserting `cleanupMissionWorktree(slug)` returns `true` and that a second invocation returns `false` (branch already deleted) — no double removal, no deletion of the Forgejo home (`cleanupMissionWorktree` safety guard in `src/adapters/cli/commands/integrate-post.ts`).
- SC4: `persistLandedIntegrationOrAbort` on an already-`done`, already-closed mission issues zero `decideIntegration` and zero `close` calls. Falsify by asserting the injected `integration.decideIntegration`/`close` call arrays remain empty when `mission.status === 'done'` and `mission.closedAt !== null`.
- SC5: `px status <slug>` prints the authoritative lifecycle (`Backlog status: done` via the BoardProjection card `status`/`rawStatus` from `mission.status`) rather than a stale backlog task status. Falsify by running `./scripts/verify-local.sh all` against a test that seeds a `done` mission and asserts the printed status line.
- SC6: Static analysis passes (`./scripts/verify-local.sh all`) with no new focused or unannotated skipped tests.

## Risks and Assumptions
- Over-broadening the merged-PR exception could let a mission that still needs an authoritative approval skip the approval gate. Assumption: the exception is strictly scoped to SQLite lifecycle `integration`/`done`, where the local squash already landed and only closeout remains.
- Idempotency keys are keyed on the landed commit SHA (`integrate:${slug}:${landedCommit}` / `close:${slug}:${landedCommit}`). Assumption: the resumed run resolves the same landed commit (via `findExistingSquashCommit` on the base branch or the stored reference); if it cannot resolve a landed SHA, closeout must fail closed rather than fabricate one.
- `px status` reads lifecycle from the BoardProjection (`src/application/projections/mission-board.ts` maps `card.status = mission.status`, `card.rawStatus = mission.rawStatus ?? mission.status`); assumption that projection already reflects the SQLite `Mission` (ADR 0053) and needs no change beyond verification.
- Worktree cleanup must never delete the Forgejo home; the existing `cleanupMissionWorktree` guard throws on that. Assumption it remains in place.
- The `local` integration mode owns `close-mission`; the fix assumes the operator repository runs in `local` mode (the TASK-2502 case).

## Checkpoints
- CP 1: Author the failing reproduction test that locks the interrupted-landed-integration state (red) before any fix.
- CP 2: Narrow the `pr-merged` preflight gate so a merged Forgejo PR is non-fatal for a lifecycle `integration`/`done` mission and the idempotent closeout becomes reachable.
- CP 3: Prove idempotent closeout — `decideIntegration`/`close` fire exactly once, `closedAt` is non-null, and `cleanupMissionWorktree` removes worktree + branch exactly once.
- CP 4: Prove `px status` reports the authoritative lifecycle `done` and add regression coverage across SC1–SC5.
- CP 5: Run the static-analysis / verification gate and confirm no new focused or unannotated skipped tests.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2508-...test.ts` ``, `` `px status <slug> ``, `` `node --import tsx src/adapters/cli/commands/integrate.ts ...` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — must match a test name in the repo, e.g. the reproduction test's `it(...)` title
  3. **Test file paths** — e.g., `test/task-2508-interrupted-landed-integration-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above (e.g. `src/adapters/cli/commands/integrate.ts::printIntegrationPreflight`)
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. A weak submission fails: pasting bare `git branch`/`ls worktree` output or saying "the test passes" with no accepted reference is not evidence.
- The red→green handoff (CP 1 → CP 2) reads the reproduction test declared below on its `Reproduction-Test:` line to locate it; that line must be present and accurate in MISSION.md.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction locks the merged-PR preflight regression | `test/task-2508-interrupted-landed-integration-repro.test.ts`, `"printIntegrationPreflight does not fail on a merged PR for a landed integration"` | PASS |
| SC2 merged-PR preflight narrowed to lifecycle integration/done | `printIntegrationPreflight` in `src/adapters/cli/commands/integrate.ts`, `./scripts/verify-local.sh all` | PASS |
| SC4 idempotent closeout no-ops on an already-closed mission | `test/integrate.test.ts`, `"persistLandedIntegrationOrAbort records lifecycle completion and closure"` | PASS |
| Static-analysis gate ran clean | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the GitHub PR / github-publish closeout paths in `src/adapters/cli/commands/integrate.ts` (the `strategy.mode === 'github-pr'` branch) or `src/application/services/integration-dispatch.ts`.
- Do not modify review approval logic, `recoverMissionForIntegration` lane transitions, or `src/domain/review.ts`.
- Do not add schema migrations, new persistence tables, or new domain aggregates (`src/domain/`).
- Do not touch the Forgejo provider adapters (`src/adapters/forgejo/`) to change merge state.
- Do not relax the `cleanupMissionWorktree` Forgejo-home safety guard in `src/adapters/cli/commands/integrate-post.ts`.

## Stop Rules
- Stop before implementing: this is a draft contract; do not write the fix or the reproduction test implementation here (only declare the test path below).
- Do not push the mission branch to `origin`; the `review` remote is the sole push target for code review.
- Do not add a separate frontmatter field for mission type; classification lives in the backlog task labels (`ai_sdlc`).
- Do not transition the backlog task to `ready`; the harness does that after a clean draft.
- Stop if the merged-PR fix would require touching GitHub-mode closeout or review approval — escalate instead of expanding scope.

Reproduction-Test: test/task-2508-interrupted-landed-integration-repro.test.ts
