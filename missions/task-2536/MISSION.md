# Mission: Do not globally block a live agent family after an ambiguous launch failure (task-2536)

## Goal
Keep a transient, ambiguous agent-launch failure local to the failing launch
instead of converting it into a family-wide `agent_blocklist` row. Persist a
three-hour family block only when the failure is positively classified as a
genuine provider-wide availability or quota condition, and while doing so check
whether the family still has live work before writing any block. The failed
launch, its reason, and whether it created a global block must remain visible to
the operator.

## Why Now
On 2026-09-18 at 06:13 CEST a single launch failure burst globally blocked both
the Codex and Claude families for three hours while they were demonstrably
active: Codex was blocked at 06:13:46 with `exit 1`, Claude at 06:13:48 with
`exit 1: process crashed`, and the workflow then recorded Claude as running at
06:16:21. The persisted launch evidence shows an ambiguous per-invocation
non-zero exit being widened into global unavailability. The fault sits in the
launch retry path in `src/adapters/agents/agents.ts`, specifically
`shouldPersistLaunchFailureBlock`, which persists a family-wide block for any
non-zero exit that does not match a narrow deterministic-error pattern, without
retaining enough launch identity or checking whether the family still has live
work. No committed Claude/Codex/blocklist change in the last 48 hours explains
the 06:13 writes, so this is a latent defect in the retry path, not a data
artifact. Until fixed, a later selection reroutes away from a usable family.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: operator-visible global block of live families, ambiguous launch-failure classification, retry-path block persistence

## Scope
- Classify launch failures precisely in the retry path (`src/adapters/agents/agents.ts`): keep transient retry exclusion local to the failing launch and persist a family-wide block only on a positive provider-wide availability/quota classification.
- Route the ambiguous-failure decision through the existing `detectLimitHit` quota classifier (`src/application/services/agent-limit.ts`) and the deterministic `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` set, rather than a separate ad-hoc rule.
- Preserve operator visibility of the failed launch: its reason, exit/signal info, and whether it created a global block (via the existing `agentErrors` record and the `status` command board projection).
- Keep genuine usage-limit and confirmed provider-wide outage blocks intact, including the per-agent reset-time parsing, the qwen transient reroute, and the SIGINT short-block path in `detectLimitHit`.
- Add a focused regression test that mocks all agent/process boundaries.

## Out of Scope
- Any change to real agent runners, telemetry parsers, or provider SDKs (`codex.ts`, `claude.ts`, `vibe.ts`, `qwen.ts`, `opencode.ts`) beyond what is required to route the block decision.
- New persistence schema, new SQLite tables, or new domain entities (ADR 0053 forbids speculative entities).
- Operator UI changes beyond surfacing already-collected diagnostics.
- Rewriting `detectLimitHit`'s quota regexes or the `status` command's rendering contract.
- Fixing the historical 06:13 database rows; those are evidence, not the defect.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable with an exact test, path, ADR, or command.

- [ ] An ambiguous non-zero Codex or Claude launch (e.g. `status: 1`, no quota/429/resource-exhausted signal, generic stderr) does not create a persisted `agent_blocklist` row and does not reroute a family that still has live work. Verified by `test/task-2536-ambiguous-launch-no-global-block.test.ts` failing (block written / family excluded) at the parent commit and passing after the fix; cross-checked by `shouldPersistLaunchFailureBlock('codex', {status:1, stderr:'generic crash\n'})` returning `false` in `test/agents-limit-hit.test.ts`.
- [ ] The failed invocation remains visible with its reason to the operator: the launch record (`agentErrors`) still captures `exitInfo`/`stderr`/`signal`/`status`, and the `status` command board projection renders it. Verified by `test/task-2368-agent-running-review-detection.test.ts` and the board projection path in `src/application/projections/board-readers.ts` (see `projectAgentAvailability`).
- [ ] Confirmed quota or provider-wide failures still produce an expiring persisted block and reroute as before. Verified by `test/limit-hit.test.ts` and `test/agents-limit-hit.test.ts`: `detectLimitHit` returns a block for `you've hit your weekly limit`, `resource_exhausted`, and `\b429\b.*quota`, and `startAgent` persists the block via `updateAgentBlockFn`.
- [ ] The qwen transient rate-limit reroute and the SIGINT short-block path remain intact. Verified by existing `test/qwen-limit-detection.test.ts` and the SIGILL/SIGKILL cases in `test/agents-limit-hit.test.ts`.
- [ ] A focused regression test mocks all agent/process boundaries (no real `px`/CLI/SQLite launch) and finishes within the unit-test budget. Verified by `npm test -- --unit-test-headroom` passing.
- [ ] Static-analysis gate passes. Verified by `./scripts/verify-local.sh static-analysis`.

## Risks and Assumptions
- The retry path currently has two block-persistence sites: the `detectLimitHit` limit-hit branch (line ~657) and the `shouldPersistLaunchFailureBlock` branch (line ~766). The fix must not drop the genuine-quota block at the first site while narrowing the second; both must agree on "block only on positive availability/quota classification."
- `detectLimitHit` already gates on a failed launcher and classifies quota precisely; the safest fix narrows the second site to mirror that classification rather than inventing a new one. Assumption: reusing `detectLimitHit`'s quota signal at the second site is correct and does not double-block.
- "Family still has live work" is best-effort by construction (`running-sessions.ts` reports `null` when the process table is unavailable). Assumption: the fix treats "unknown" as "do not extend the global block", not "definitely running".
- Narrowing the block must not silently swallow genuine provider outages; the positive-classification bar (usage limit / 429 / resource_exhausted) is the guard.
- Do not treat a working external session as clearing a failed Parallix child process; the reproduction boundary is the persisted launch evidence plus the live-work conflict.

## Checkpoints
- CP 1: Author the failing reproduction test that locks the bug before any fix (red at parent commit). See Checkpoint Documentation Requirements below.
- CP 2: Narrow the launch-failure block persistence so an ambiguous non-zero exit stays local to the failing launch; persist a family block only on a positive provider-wide availability/quota classification.
- CP 3: Preserve operator visibility of the failed launch (reason + exit/signal info) and confirm the `status` board projection still surfaces it.
- CP 4: Confirm genuine usage-limit and confirmed provider-wide outage blocks still persist and reroute; qwen transient reroute and SIGINT short block intact.
- CP 5: Run verification gates and record evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- --unit-test-headroom` ``, `` `./scripts/verify-local.sh static-analysis` ``, `` `node --test test/task-2536-ambiguous-launch-no-global-block.test.ts` ``, or `` `px status` ``
  2. **Test names** — must match a test name in the repo, e.g. the assertion strings inside `test/task-2536-ambiguous-launch-no-global-block.test.ts`
  3. **Test file paths** — must be an existing test file, e.g. `test/agents-limit-hit.test.ts`, `test/limit-hit.test.ts`, `test/qwen-limit-detection.test.ts`, `test/task-2368-agent-running-review-detection.test.ts`
  4. **ADR references** — must correspond to an existing file under `docs/adr/`, e.g. `ADR 0053` (operational persistence and authority boundaries), `ADR 0057` (verification tiers)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above (e.g. `src/adapters/agents/agents.ts` `shouldPersistLaunchFailureBlock`, `src/application/services/agent-limit.ts` `detectLimitHit`)
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. A weak agent must NOT ship a checkpoint whose only evidence is bare `ls`/`stat` output or "the test passes" prose: pair any shell output with an accepted reference such as the exact test path/name, an ADR number, or a runnable `npm`/`node`/`px`/`./scripts/verify-local.sh` command.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Ambiguous launch does not write a global block | `test/task-2536-ambiguous-launch-no-global-block.test.ts`, `shouldPersistLaunchFailureBlock` returns `false` | PASS |
| Quota/provider-wide failures still block | `test/limit-hit.test.ts`, `test/agents-limit-hit.test.ts` | PASS |
| Static-analysis gate | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] npm test -- --unit-test-headroom

## Restricted Areas
- `docs/adr/` architecture-decision records (except adding none; this is a bug fix).
- Real agent runner adapters (`codex.ts`, `claude.ts`, `vibe.ts`, `qwen.ts`, `opencode.ts`) telemetry/launch logic beyond routing the block decision.
- SQLite schema, migrations, and the `AgentBlock` domain model shape.
- The `INTEGRATION_CI_TESTS`/`INTEGRATION_LOCAL_REASONS` classification in `test/lib/test-categories.ts` unless the regression test is a unit test (it must be — it mocks all boundaries).

## Stop Rules
- Stop before implementing any fix; this draft only produces the mission contract.
- Do not author the reproduction test implementation during draft; only declare its path below.
- Do not push any branch to `origin` other than `main`; this mission runs on a local mission branch.
- Do not run tests beyond the single `./scripts/verify-local.sh all` gate at draft time.
- Do not add new domain entities, SQLite tables, or ADRs.

Reproduction-Test: test/task-2536-ambiguous-launch-no-global-block.test.ts
