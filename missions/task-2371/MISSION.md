# Mission: Unify weekly agent-performance semantics and lifecycle integration dwell (task-2371)

## Goal

Make authoritative Mission lifecycle completion the single owner of weekly Mission-performance cohort membership. Approved review-origin integrations must enter `integration` before landing and reach `done` only after landing; CLI Agent Performance must use the same current/previous completed-Mission cohorts as FLOW; and PR-fix averages must count only known `reviewFixRounds` observations while preserving known zero.

## Why Now

FLOW already uses lifecycle-completed rolling cohorts, but CLI Agent Performance can select telemetry by row date instead. Together with a review-to-done shortcut and unknown PR-fix rounds treated as zero, this produces misleading dwell and weekly performance statistics from otherwise authoritative lifecycle facts. Correct the existing lifecycle, decision-window, cohort, and telemetry seams before further CLI restructuring in TASK-2369.

## Refinement Signals

- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: Activate as-is; use adversarial completion and telemetry dates.
- Main drivers: review approval lifecycle transition; lifecycle-derived CLI cohorts; complete selected-Mission telemetry; unknown-versus-zero PR-fix aggregation; production-path regressions.

## Mandatory Execution Rules

- Before changing code, record `git rev-parse HEAD` and `git status --short`. Trace the production approval, landing, decision-window, Agent Performance, spend, aggregation, and fallback seams. If a stated defect is fixed already, prove it with source and regression evidence; do not manufacture churn.
- Add red regressions before changing each production seam. They must reproduce the missing integration transition, opposing completion-versus-telemetry windows, and unknown-round denominator error.
- Reuse the existing Mission lifecycle, decision window, lifecycle-completed population/projection, `MissionOutcome`/cohort projection, and canonical repository identity. TASK-2369 owns structural extraction and CLI splitting.

## Scope

- Transition the authoritative Mission from `review` to `integration` when review approval promotes the Backlog representation; landing alone transitions `integration` to `done`.
- Make approval idempotent for a Mission already in `integration`; failed landing leaves it in `integration` with no `done` event.
- Derive current and previous CLI Agent Performance populations from authoritative lifecycle `completedAt`, using the same rolling decision window as FLOW and default `px stats`.
- Join all relevant telemetry for each selected Mission. Telemetry row dates must not decide Agent Performance membership or implementer Mission counts.
- Retain telemetry-date filtering only for the separately labelled Agent Spend resource-consumption view, with an explicit report/application-boundary semantic contract.
- Preserve `reviewFixRounds` tri-state semantics: known `0` and positive values are observations; absent or unrecognizable evidence is unknown and excluded from sum, denominator, and average.
- Expose PR-fix observation count when it differs from implementer Mission count; render no known observations as unavailable rather than `0.00`.
- Exercise the production CLI/application report path with deterministic, fully mocked regressions.

## Out of Scope

- A new statistics, cohort, window, `MissionOutcome`, lifecycle-state-machine, telemetry-repository, or analytics-framework architecture.
- Changing FLOW review-bounce semantics or treating lifecycle bounce as PR-fix rounds.
- TASK-2369 structural extraction/CLI splitting, historical DB repair, canonical repository identity redesign, new metrics, dashboard redesign, statistical significance, real-agent E2E, or network-backed tests.
- Altering rolling-window duration, redefining resource-consumption reporting, or lifecycle vocabulary beyond using the existing `review → integration → done` transitions.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Do not use subjective adjectives or vague quantifiers. Preserve named behaviors rather than claiming generic preservation.

- SC1: Production approval of a Mission in `review` records exactly one `review → integration` transition before landing; an already-integrating Mission records no duplicate transition.
- SC2: Failed review-origin landing leaves the Mission in `integration` with zero `done` events; successful landing records `review → integration → done`, never direct `review → done`.
- SC3: Persisted lifecycle facts entered at 10:00 (`review`), 10:30 (`integration`), and 11:15 (`done`) report review dwell of 30 minutes and integration dwell of 45 minutes.
- SC4: CLI Agent Performance selects current and previous rolling seven-day populations by authoritative `completedAt`, matching FLOW and default `px stats`; every selected Mission is counted once per applicable implementer grouping.
- SC5: In an Aug 6–12 current window, Mission A completed Aug 10 with Aug 4/5 telemetry appears only in current performance; Mission B completed Aug 4 with Aug 8 telemetry appears only in previous performance.
- SC6: Selected Missions contribute complete relevant telemetry without telemetry dates changing performance cohort assignment; Agent Spend retains intentional telemetry-date consumption semantics.
- SC7: `[2, unknown, unknown]` reports `PR fix n = 1` and `2.00`; `[0, 2, unknown, unknown]` reports `PR fix n = 2` and `1.00`.
- SC8: Known `reviewFixRounds = 0` remains an observation; absent task text/files and unrecognizable evidence remain unknown. With no known observations, the report renders unavailable, not `0.00`.
- SC9: Agent Performance and Agent Spend labels/contracts distinguish completed-Mission performance from telemetry-date resource consumption; a late Mission B spend row can appear in current spend while B remains previous performance.
- SC10: No additional cohort/window/lifecycle/telemetry architecture or TASK-2369-owned cleanup is introduced.
- SC11: No test requires Forgejo, an agent, a mission runner, or network access; no focused or unannotated skipped test is introduced.

## Regression Quality Requirements

- Use the certification fixture: current Aug 6–12, previous Jul 30–Aug 5; terra Mission A completes Aug 10 with Aug 4/5 telemetry and rounds 2; Mission B completes Aug 4 with Aug 2 telemetry and Aug 8 closeout telemetry and rounds 0; Missions C/D complete Aug 11 with unknown rounds; Mission E enters review 10:00, integration 10:30, and done 11:15.
- Seed lifecycle completion timestamps and let production application logic derive populations. Do not inject desired current/previous groups, test only `compareCohorts`, or test only a PR-fix helper.
- Assert exact Mission IDs, counts, PR-fix observation counts, averages, and window assignments—not mere containment, non-emptiness, or numeric output.
- Document old-bug sensitivity for the critical regressions: telemetry-date-first filtering excludes A and admits B; `unknown || 0` corrupts R7/R8; direct `review → done` removes integration dwell and overstates review dwell. Where practical, temporarily restore former behavior to demonstrate red without committing it.

## Risks and Assumptions

- The existing decision-window/lifecycle-completed projection can expose current and previous Mission identities; extend that shared seam rather than rescanning lifecycle state in `stats.ts`.
- Approval and integration may update Backlog and authoritative Mission state at different seams; tests must exercise the production path rather than file movement alone.
- Performance and spend have legitimately different date semantics; retain telemetry-date filtering only where the table measures consumption.
- Fallback parsing can silently turn missing review evidence into zero; test missing, known-zero, and known-positive values through aggregation and rendering.

## Checkpoints

- CP 0: Record baseline SHA and working tree; trace all production seams.
- CP 1: Add adversarial red lifecycle tests R1–R4 before production lifecycle changes: review approval enters integration, failed landing remains integration with no done event, successful landing records exact transitions, and persisted dwell is review=30m/integration=45m.
- CP 2: Implement lifecycle alignment and rerun R1–R4.
- CP 3: Add red R5/R6 CLI/application-path tests using the opposing dates above; capture the incorrect baseline populations.
- CP 4: Route Agent Performance through current/previous lifecycle-completed populations and complete selected-Mission telemetry without changing Agent Spend.
- CP 5: Add R7–R9 through final aggregation/report rendering: unknown exclusion, known zero retention, and task-text no-evidence returns unknown.
- CP 6: Remove aggregation-time and fallback unknown-to-zero behavior; expose PR-fix `n` and unavailable output.
- CP 7: Verify report/application contract distinguishes performance of Missions completed in a window from spend incurred in a window; add R10 if spend remains telemetry-date-windowed.
- CP 8: Run the certification fixture end-to-end through the relevant CLI/application statistics path and assert exact cohorts and metrics.
- CP 9: Contradiction sweep and classify relevant occurrences of `row.date`, `completedMissionKeys`, `currentCompleted`, `previousCompleted`, `summarizeAgentWindow`, `computeAgentMissionGroups`, `storedRoundsByMission`, `|| 0`, `?? 0`, `deriveFixRoundsFromTaskText`, `review → done`, approval, and integration commands.
- CP 10: Run `git diff --check` and `./scripts/verify-local.sh all`.

### Checkpoint Documentation Requirements

Every checkpoint document (`CP-N.md`) MUST lead its evidence with durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when necessary but discouraged.

Every checkpoint document MUST include:

- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table `| Criterion | Evidence | Status |` with at least one durable evidence row for every applicable success criterion.
- Lifecycle production-path evidence, semantic-contract evidence, and the command actually run for verification.
- A non-generic `Next action:` line at the bottom.

Raw `stat`/`ls` output or generic prose alone is not enough. Shell output may supplement, but must be paired with an accepted test name, ADR reference, test path, or recognized command/path.

## Gates

- [ ] git diff --check
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not modify the task assignee or backlog status; workflow ownership and state changes remain harness-managed.
- Do not introduce StatisticsV2, AgentPerformanceV2, a separate cohort engine/window service, a new `MissionOutcome` type, a lifecycle state machine, or telemetry repository.
- Do not modify TASK-2369-owned structural extraction/CLI splitting.
- Do not change review-bounce calculations to use review-fix telemetry or infer known PR-fix zero from missing evidence.
- Do not change canonical repository identity or allow telemetry to regain Mission-completion semantics.
- Do not introduce focused tests or bare skips, and do not call Forgejo, agents, mission runners, or the network from unit tests.
- Do not push a mission branch to `origin`; only `main` may be pushed there.

## Stop Rules

- Stop and request direction if lifecycle alignment requires changing the authoritative state model rather than using supported `review → integration → done` transitions.
- Stop and request direction if the lifecycle-completed decision-window projection cannot provide current/previous populations without a second cohort/window architecture.
- Stop and request direction if retaining telemetry-date Agent Spend semantics conflicts with an approved report contract or requires redefining spend.
- Stop and request direction if required production-path regressions need real Forgejo access, expensive agents, or unmocked external dependencies.
- Stop and request direction if TASK-2369 work is required to make the change compile.
