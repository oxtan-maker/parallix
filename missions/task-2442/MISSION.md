# Mission: Keep the Ink board quiet between visible state changes (task-2442)

## Goal

Stop `px ui` from publishing and repainting an Ink board frame when a polling tick changes only the raw remaining block duration and the `AgentStrip` countdown text is unchanged, while retaining the existing two-second projection rebuild as the cross-process reconciliation mechanism.

## Why Now

An agent usage block that lasts days creates a new raw duration on every poll even though the board continues to display the same day label (for example, `3d`). The current refresh fingerprint treats that invisible precision change as board state, so a long-running `px ui` continuously emits Ink frames and can exhaust Node's heap. The issue occurs in ordinary blocked-agent operation and must be locked with deterministic tests before changing the refresh seam.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one display-aligned fingerprint normalization at the board subscription seam; one deterministic subscription regression; one mounted Ink regression; focused boundary and state-change coverage

## Scope

- Add `test/task-2442-repro.test.ts` before the fix. It must drive the existing subscription with an injected timer and deterministic projections whose raw `blockedForMs` values differ by one poll but both render as the same `AgentStrip` countdown. It must assert one notification and no second Ink content frame through a mounted `BoardShell` subscription path; this is red at the parent commit and green after the fix.
- Change the existing board refresh/display seam so `boardFingerprint` compares the same blocked-countdown representation `AgentStrip` visibly renders, including day, hour, minute, zero/expired, and indefinite cases.
- Keep `subscribeToBoardProjection` rebuilding the authoritative `BoardProjection` on every scheduled tick and publishing immediately whenever a displayed card, attention, source, agent availability, displayed reason, family, live-process count, or current-work value changes.
- Extend focused tests for day, hour, and minute display-boundary crossings and an elapsed block becoming available.

Reproduction-Test: test/task-2442-repro.test.ts

## Out of Scope

- Changing `BOARD_REFRESH_INTERVAL_MS`, skipping a scheduled projection build, or replacing polling with a watcher, event bus, daemon, database trigger, SSE, WebSocket, cache, or invalidation system.
- Heap-size flags, forced garbage collection, process restarts, telemetry, configuration switches, dependencies, or generic scheduling infrastructure.
- Changes to web-board behavior, lifecycle flows, agent launching, persistence schemas, task-document processing, metrics calculations, or unrelated board reads.
- Importing Ink, React, terminal formatting, or process APIs into the application projection layer; an adjacent pure shared formatter is allowed only if it is necessary to keep fingerprint and rendered countdown semantics identical.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Two consecutive scheduled projections for a blocked family whose raw `blockedForMs` values differ by the poll interval but render the same countdown produce one subscription notification and one mounted Ink content frame.
- SC2: Each scheduled tick invokes the projection builder once even when the visible fingerprint is unchanged.
- SC3: A countdown crossing a displayed day boundary, hour boundary, or minute boundary produces one additional subscription notification; a zero/expired block renders the family available on its next scheduled projection.
- SC4: A change to availability, displayed block reason, family identity, attributed live-process count, unattributed live-process count, card state, attention state, source status, or current-work state produces an additional notification on the next scheduled projection.
- SC5: The regression tests use injected timers and deterministic projection values; they contain no real-time sleep, retry loop, forced GC, heap-size setting, or environment-specific memory threshold.
- SC6: `npm test -- --unit-test-headroom`, `./scripts/verify-local.sh static-analysis`, and `./scripts/verify-local.sh all` pass.

## Risks and Assumptions

- Risk: A rounded duration rule that differs from `AgentStrip` can suppress a frame the operator should see. Mitigation: exercise the exact day, hour, minute, zero/expired, and `Infinity` display cases through the same formatting semantics.
- Risk: Reducing the fingerprint too broadly can hide liveness or work changes. Mitigation: retain every existing card, attention, source, availability, and process-count field unless it is replaced with an equivalent visible representation.
- Assumption: The existing injected `setTimer`/`clearTimer` seam can deterministically advance subscriptions without real elapsed time.
- Assumption: A mounted `BoardShell` can observe the actual subscription-to-Ink render path with a controlled output stream.

## Checkpoints

- CP 1: Before writing a fix, author `test/task-2442-repro.test.ts` to lock the bug. Use a fake timer/scheduler and deterministic projections for a blocked agent where consecutive raw durations differ by 2,000 ms but both render the same countdown label. Assert exactly one subscription notification and one mounted `BoardShell` Ink content frame; those assertions fail at the parent commit because it emits a second notification/frame (red), then pass after the fix (green).
- CP 2: Trace the existing `boardFingerprint`, `AgentStrip` countdown formatter, and their callers. Implement the smallest display-aligned normalization at that shared refresh/display seam; preserve a projection build on every timer callback and preserve all non-countdown displayed fingerprint fields.
- CP 3: Add deterministic focused coverage in `test/task-2442-repro.test.ts` for day, hour, and minute boundary refreshes, expiry-to-available refresh, and each non-countdown state change listed in SC4. Run the declared gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Durable evidence must lead with exact test names, ADR references, test file paths, and recognized repo commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited Markdown table whose header is exactly `| Criterion | Evidence | Status |`.
- At least one durable evidence row for every success criterion; use `test/task-2442-repro.test.ts`, exact test names, and the relevant declared command where applicable.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair shell output with an accepted durable reference above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Same-label blocked countdown is suppressed | `test/task-2442-repro.test.ts`, exact mounted Ink regression test name | PASS |
| Projection still rebuilds and visible boundaries publish | `test/task-2442-repro.test.ts`, exact subscription boundary test name | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] npm test -- --unit-test-headroom
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `src/interfaces/web/` — web-board transport and streaming behavior are not part of this display-deduplication mission.
- `src/application/projections/board.ts` and projection-builder data sources — do not skip or cache authoritative projection rebuilding.
- `src/adapters/`, persistence migrations, and task-document handling — do not alter data sources or schemas to solve a TUI repaint issue.
- `src/interfaces/tui/` outside the countdown formatting seam — do not redesign the board or change unrelated Ink behavior.

## Stop Rules

- Stop and seek direction if matching the visible countdown requires changing the polling interval, omitting a projection build, or introducing a watcher, event bus, cache, daemon, or other invalidation architecture.
- Stop and seek direction if the mounted Ink regression cannot be driven deterministically through the existing subscription seam without real-time waits or retry loops.
- Do not suppress a refresh for a change in availability, displayed reason, agent family, attributed or unattributed live-process evidence, card state, attention, source facts, or current work.
- Do not use heap-size settings, forced GC, restart logic, snapshots that conceal repeated frames, `any`, type suppression, focused/skipped tests, or new dependencies as a solution.
