# Mission: Cut over AgentBlock persistence and retire agents.local block state (task-2322.10)

## Goal

Make the checked, database-backed `AgentBlock` repository the sole authority for runtime block state. Migrate existing `agents.local.json` block entries through an explicit dry-run and atomic, idempotent import; retain that file only for static agent configuration and launcher discovery; and make CLI, TUI, and board consumers obtain the same reason, expiry, limit, and eligibility from one application-level query.

## Why Now

Task-2322.02 established that AgentBlock remains family-keyed, but block data is still split between checked persistence and the local configuration overlay. That split permits stale eligibility and file fallbacks after a failed mutation. Completing the cutover now gives all agent-facing surfaces one durable authority before further scheduler and board work depends on block state.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: The dependency task fixes the AgentBlock identity model; this mission can now move persistence ownership without changing that model.
- Main drivers: application-boundary query and mutation routing; one-time legacy import; removal of production local-file block authority; cross-surface projection consistency; mocked regression coverage for persistence failures and lifecycle cases.

## Scope

- Route every production block, unblock, expiry, limit, and eligibility decision through application services backed by the checked `AgentBlock` repository.
- Define an import path for legacy block entries in `agents.local.json` with a dry-run report, atomic execution, idempotent re-runs, conflict reporting, and no mutation of the source configuration file.
- Remove production reads, searches, and writes that treat local agent configuration paths as AgentBlock authority.
- Compose static agent configuration and launcher observations with checked AgentBlock state at the application boundary; keep SQLite and filesystem access outside domain policy.
- Have CLI, TUI, and shared-board projections consume one application query for block reason, expiry, limits, and eligibility.
- Add fast mocked tests for import, expiry, unblock, concurrent updates, restart, missing configuration, and repository/database failure; tests must not launch real agents or access Forgejo.
- Update the operational-persistence and authority-boundaries documentation if the implemented user or workflow behavior changes.

## Out of Scope

- Changing the family-keyed AgentBlock identity or revisiting the decision recorded by task-2322.02.
- Moving static agent definitions, launcher discovery, or non-block configuration out of `agents.local.json`.
- Replacing SQLite, changing its schema beyond what the AgentBlock cutover requires, or adding a new persistence backend.
- Changing agent scheduling policy unrelated to block reason, expiry, limit, or eligibility.
- Running real launchers, real agents, or Forgejo from unit tests.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Every production operation that blocks, unblocks, applies expiry or limits, or determines agent eligibility invokes the checked AgentBlock repository through an application service; no production path falls back to `agents.local.json` after a repository mutation or query fails.
- The legacy import supports dry-run output without persistence changes, commits a valid import atomically, is idempotent on a repeated identical import, reports conflicts, and leaves `agents.local.json` byte-for-byte unmodified.
- Production code contains no AgentBlock write to `agents.local.json` and no local-agent-path lookup used as block authority; static agent configuration and launcher discovery continue to be read as external inputs.
- The application boundary returns block reason, expiry, limit, and eligibility in one query used by the CLI, TUI, and shared-board projections; domain policy has no SQLite or filesystem dependency.
- If a checked AgentBlock mutation fails, the requesting operation reports failure and does not modify configuration, continue using stale eligibility, or substitute file-backed state.
- Automated tests cover legacy import dry-run, atomic/idempotent import, conflict reporting, expiry, unblock, concurrent updates, restart persistence, missing configuration, and repository/database failure using mocked launchers with no real-agent or Forgejo access.
- `./scripts/verify-local.sh all` exits successfully on the completed mission tree.

## Risks and Assumptions

- Assume task-2322.02 is available on this branch and its family-keyed AgentBlock behavior is the required identity contract.
- Existing local block entries may be incomplete or conflict with checked rows; the import must expose those cases rather than silently choosing a winner.
- Removing legacy lookup may reveal callers that implicitly relied on stale local state; checkpoints must trace each production caller before deletion.
- Concurrent updates and restart behavior can be nondeterministic if tests use real persistence or launchers; tests must control repository and launcher seams with mocks.
- CLI, TUI, and board projections may format the shared result differently, but their displayed reason, expiry, limit, and eligibility must originate from the same application response.

## Checkpoints

- CP 1: Map all current AgentBlock decisions, mutations, local-overlay reads/writes, and consumer projections; identify the application service/query boundary and document each legacy authority path to remove.
- CP 2: Implement and test the one-time legacy import contract: dry-run reporting, atomic persistence, idempotent replay, conflict reporting, and immutable source configuration.
- CP 3: Route mutations and eligibility through the checked repository, retire production local-file authority, and add failure-path coverage proving no stale or file fallback behavior.
- CP 4: Switch CLI, TUI, and shared-board projections to the shared application query; complete lifecycle, concurrency, restart, missing-configuration, and mocked-launcher coverage; update applicable ADR documentation and run the gate.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include:
- A summary tied to the checkpoint’s named paths, callers, tests, or behavior.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every Success Criterion.
- Evidence must use one or more accepted forms Parallix verifies today: an existing `file:line` reference; an exact existing test name; an ADR reference; an existing test file path; or a recognized repository command/path such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, cite the import test path and exact test names for dry-run, atomic/idempotent import, conflicts, expiry, unblock, concurrent updates, restart, missing configuration, and repository failure; cite changed application and projection file:line references; and cite the applicable ADR reference when documentation changes.
- Raw `stat`/`ls` output or generic prose alone is not evidence. It may be supplemental, but shell output must be paired with an accepted reference above.
- A concrete `Next action:` line at the bottom that names the next caller, test, projection, documentation change, or verification command.

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not alter the family-keyed AgentBlock decision supplied by `missions/task-2322.02/CP-3.md`.
- Do not write block state back to `agents.local.json`; preserve it as a static configuration and launcher-discovery input.
- Do not let domain policy import or depend on SQLite repositories, filesystem paths, or JSON configuration readers.
- Do not add tests that start real agents, execute expensive CLI agent flows, or access real Forgejo.
- Do not modify unrelated scheduler policy, launcher implementation, or persistence backends.

## Stop Rules

- Stop and request direction if task-2322.02 is unavailable or its family-keyed AgentBlock contract conflicts with the required import identity mapping.
- Stop and request direction if existing legacy entries cannot be represented by the checked AgentBlock model without choosing an undocumented conflict-resolution policy.
- Stop and request direction if a required consumer cannot use the shared application query without changing an out-of-scope public CLI, TUI, board, scheduler, or persistence contract.
- Stop and request direction if verification requires real agents, real Forgejo, destructive migration of user configuration, or a non-mocked external service.
