# Mission: Wire AgentSelectionSnapshot into review-loop and CLI selection (task-2351)

## Goal
Make reviewer and CLI agent selection use a single, materialized `AgentSelectionSnapshot` whose runtime block state comes from SQLite, so a currently blocked eligible agent is excluded before launch and selection outcomes are observable.

## Why Now
Runtime blocks are written to SQLite while the review-loop still selects from `agents.local.json`. The stale JSON path repeatedly nominates blocked agents, wastes launch attempts, and can repeatedly fall back to one reviewer. The domain snapshot and port already express the intended selection boundary but are not wired into the review-loop or CLI selection paths.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is; the backlog identifies the write authority, stale read authority, domain boundary, and affected call sites.
- Main drivers: implement the `AgentSelectionSnapshotPort` adapter backed by SQLite availability data; materialize and reuse a snapshot for synchronous selections; migrate review-loop and CLI selection callers; add outcome telemetry; lock the stale-block regression with isolated tests.

## Scope
- Add a concrete `AgentSelectionSnapshotPort` implementation that reads runtime blocks from the SQLite-backed agent availability authority and combines them with launcher status and step policy data required by `AgentSelectionSnapshot`.
- Wire snapshot preparation into the review-loop path rooted at `src/adapters/review/review-loop.ts` and use the prepared selection for reviewer nominations rather than the JSON-only blocklist path.
- Wire CLI agent-selection entry points to the same snapshot-based selection boundary.
- Preserve the existing domain `selectAgent` / `selectableAgents` decision rules while giving them SQLite runtime-block input.
- Emit or record selection outcomes that distinguish nominated, skipped-blocked, launch-failed, and fallback events.
- Add fast unit coverage with mocked SQLite availability and mocked launcher probes, including the regression reproduction below.

## Out of Scope
- Migrating, deleting, or synchronizing `agents.local.json` as a general configuration format.
- Changing agent-family fairness, implementer exclusion, retry limits, launch error classification, or block-expiry policy except where required to pass snapshot data through existing rules.
- Investigating or changing the separate `claude` reviewer-skew hypothesis without evidence produced by the new selection telemetry.
- Changing SQLite schema, backfilling historical `agent_blocklist` rows, or running production data repair.
- Altering unrelated board/TUI availability displays.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- **SC1:** `test/task-2351-agent-selection-snapshot-repro.test.ts` fails on the mission parent commit when its mocked SQLite state blocks an otherwise eligible agent while the JSON config is stale/unblocked, because selection nominates that blocked agent; after the mission, the same test passes by selecting an unblocked eligible agent.
- **SC2:** A concrete adapter satisfies `AgentSelectionSnapshotPort` and reads active runtime blocks through the SQLite-backed agent availability source; unit tests prove an active SQLite block is represented in the prepared snapshot without reading `agents.local.json` for that runtime-block decision.
- **SC3:** The review-loop materializes one `PreparedAgentSelection` for its selection window and reviewer nomination skips an eligible SQLite-blocked agent before `startAgent` is called; a mocked review-loop test asserts zero launch calls for that blocked agent and one nomination of an unblocked candidate.
- **SC4:** Every supported CLI agent-selection path that previously called the legacy JSON-blocklist selection flow receives the same prepared snapshot; focused tests cover each migrated CLI entry point with a mocked active SQLite block and assert the blocked candidate is not returned.
- **SC5:** Selection telemetry/logging records the four outcome labels `nominated`, `skipped-blocked`, `launch-failed`, and `fallback`; tests assert the emitted structured fields or messages for each applicable branch.
- **SC6:** Existing selection-policy behavior remains intact for an unblocked eligible candidate and for the no-selectable-agent case, as demonstrated by focused mocked unit tests.
- **SC7:** `./scripts/verify-local.sh all` exits successfully on the completed tree.

## Risks and Assumptions
- **Risk:** Snapshot creation may require asynchronous SQLite and launcher-probe work at call sites that currently expect synchronous selection. **Mitigation:** materialize `PreparedAgentSelection` at an existing async boundary and keep subsequent selections synchronous.
- **Risk:** Review-loop retries can obscure whether an agent was excluded at selection or failed during launch. **Mitigation:** use distinct structured outcome labels and assert them in branch-level tests.
- **Risk:** CLI entry points may have different configuration assembly paths. **Mitigation:** enumerate every legacy selection caller before migration and add a focused mocked test for each migrated entry point.
- **Assumption:** SQLite-backed availability is the authoritative source for active runtime blocks because `updateAgentBlockChecked` writes there; static configuration policy remains supplied by the existing configuration path.
- **Assumption:** Tests can mock the SQLite availability reader and launcher probes without accessing a real Forgejo instance or starting external agent processes.

## Checkpoints
- CP 1: Before any fix, author `test/task-2351-agent-selection-snapshot-repro.test.ts`. Mock an otherwise eligible agent as actively blocked in SQLite while `agents.local.json` is stale and marks it unblocked; exercise the current selection path and assert the selected agent is not the SQLite-blocked candidate (or is the known unblocked candidate). Run this focused test against the mission parent commit and record the failing assertion as red; after the fix it must pass green. Do not change production selection code in this checkpoint.
- CP 2: Implement and unit-test the SQLite-backed `AgentSelectionSnapshotPort` adapter and snapshot preparation boundary. Demonstrate active-block, expired-block, launcher-status, and step-policy inputs in isolated tests using mocks only.
- CP 3: Migrate review-loop and all identified CLI selection entry points to the prepared snapshot. Add focused tests proving pre-launch exclusion, fallback behavior, and unchanged unblocked/no-selectable behavior.
- CP 4: Add outcome telemetry for nominated, skipped-blocked, launch-failed, and fallback branches; verify structured fields/messages with tests. Run the full required verifier and document all success-criterion evidence.

Reproduction-Test: test/task-2351-agent-selection-snapshot-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |` and at least one row for every Success Criterion.
- Verifiable evidence using Parallix-recognized forms: existing `file:line` references; exact test names; ADR references; test file paths; and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, identify the regression test path, adapter and caller file:line references, exact mocked test names, and the command used for verification wherever those criteria apply.
- Raw `stat`/`ls` output or generic prose alone is not enough. If shell output is included, pair it with one of the accepted references above.
- A non-generic `Next action:` line at the bottom that names the next checkpoint action or the remaining verification work.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify files outside the agent domain, application ports/services, agent/review adapters, CLI composition/command selection callers, targeted tests, mission checkpoint documents, and the backlog task unless an unanticipated dependency is first documented in a checkpoint.
- Do not access real Forgejo, start real coding agents, or use non-mocked SQLite/launcher dependencies in unit tests.
- Do not alter `agents.local.json` persistence semantics, SQLite schema, historical blocks, agent-family policy, or unrelated TUI/board behavior.

## Stop Rules
- Stop and request direction if SQLite availability cannot provide the block, expiry, launcher-status, or policy data required by `AgentSelectionSnapshot` without a schema migration or a new external authority.
- Stop and request direction if an identified CLI selection path is public API behavior that cannot be migrated without changing its documented command contract.
- Stop and request direction if the red reproduction cannot fail at the parent commit using mocks alone, or if reproducing it requires Forgejo, a real agent launch, or production SQLite data.
- Stop and request direction if the required verifier fails for a pre-existing unrelated failure; record the exact command and accepted file/test reference rather than masking the failure.
