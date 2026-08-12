# Mission: Make lifecycle completion authoritative and repair statistics (task-2367)

## Goal

Make the authoritative Mission lifecycle transition into `done` the only definition of a completed mission. Successful integration must persist that transition exactly once after integration lands, statistics must read the same lifecycle population everywhere, and contemporary telemetry must retain execution measurements without any completion flag. Repair straightforward historical local-DB inconsistencies without creating a permanent reconciliation subsystem.

## Why Now

Task-2364 integrated without increasing the rolling seven-day completed-Mission population because integration reporting did not read lifecycle history and completion was coupled to backlog promotion. At the same time, telemetry `closed=yes` remains a competing completion representation and missing `reviewFixRounds` is being corrupted to zero. These defects cause current FLOW decisions and operator reports to use an untrustworthy population.

## Refinement Signals

- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is; the backlog defines the required invariants, repair boundary, and deterministic certification scenarios.
- Main drivers: removal of a cross-cutting telemetry field and SQLite column; reordering integration closeout through `MissionIntegrationService`; one shared lifecycle-plus-telemetry reporting path; nullability repair; local historical-data repair; deterministic integration/statistics certification.

## Scope

- Remove `closed` and every renamed-equivalent mission-completion marker from contemporary telemetry domain records, persistence, SQLite measurement schema, writers, readers, statistics interfaces, aggregation helpers, fixtures, comments, and tests. Quarantine any old-CSV parsing to an explicit legacy-import boundary.
- Make `MissionIntegrationService` persist the atomic `integration` → `done` transition and exactly one lane event only after an actual squash/integration landing is established, independent of backlog Markdown state.
- Preserve recovery: a rerun after a landed-but-unclosed integration reconciles the missing transition once; a later rerun does not add another event or completed mission.
- Route integration-time reporting, `npm run dev -- stats`, and Board/FLOW projection through authoritative lifecycle completed Mission IDs joined with telemetry by canonical repository identity and Mission.
- Preserve rolling-window selection (current: today minus six days through today; previous: today minus thirteen through today minus seven) and use complete lifecycle/runtime/telemetry for each selected Mission without admitting lifetime history into current samples.
- Preserve `reviewFixRounds` tri-state semantics end-to-end and verify an actual SQLite write/read for values `0`, `2`, `NULL`, and `NULL`.
- Add a task-specific, idempotent local-DB repair that repairs only obvious landed-but-unclosed Missions, fabricated review-fix zeros, and unambiguous legacy repository aliases; it prints counts and ambiguous Mission IDs, then skips ambiguity.
- Add a deterministic no-agent, no-network production certification using a temporary Git checkout/worktree, migrated SQLite, real lifecycle and measurement persistence, `MissionIntegrationService`, metrics adapter, Board projection, and weekly report.

Reproduction-Test: test/task-2367-integration-completion-repro.test.ts

## Out of Scope

- External analytics or BI, statistical significance, experiment selection, backup tooling, interactive repair UI, confidence scoring, generic reconciliation infrastructure, or a long-lived repair service.
- A general `integrate.ts` or `stats.ts` rewrite, lifecycle-state redesign, another integration-completion API, CLI-specific completion SQL, or a telemetry-based completion fallback.
- Real-agent E2E, LLM invocation, network access, and deletion of historical data merely because it is old.
- Changing backlog state as a completion authority, or changing unrelated uses of the word “closed” such as resources, file handles, or PR state.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Contemporary telemetry domain, persistence, SQLite schema, writers, readers, statistics DTOs, and public measurement APIs contain no `closed` field or renamed mission-completion marker; only explicitly labelled legacy import/repair code may read historical `closed`.
- SC2: A contemporary telemetry measurement, including a legacy fixture with `closed=yes`, cannot make a Mission with lifecycle status `integration` appear completed in CLI statistics or BoardMetrics.
- SC3: For an approved Mission in `integration`, a successful landed integration changes status to `done`, creates exactly one `integration` → `done` event, and changes the current rolling-seven-day completed population from N to N+1.
- SC4: An integration failure before landing leaves status other than `done`, persists zero `integration` → `done` events, and leaves the completed population at N.
- SC5: A retry after landing with missing lifecycle closeout creates one completion event and N+1 population; a second retry leaves both values unchanged.
- SC6: Integration closeout uses `MissionIntegrationService` and `saveWithTransition`; backlog task state neither enables nor suppresses authoritative Mission completion.
- SC7: Immediately after successful integration, the integration report, `npm run dev -- stats`, and BoardMetrics contain the same current completed Mission IDs, including the integrated Mission; the integration report does not report unavailable lifecycle history when persistence is available.
- SC8: Current and previous FLOW windows remain seven-day completed-Mission populations, and lifecycle-cycle samples exclude historical Missions outside the selected completed-Mission window.
- SC9: For persisted `reviewFixRounds` values `[0, 2, NULL, NULL]`, the metric population is 4, observation values are `[0, 2]`, observation count is 2, and unknown values are not written or reported as zero.
- SC10: Lifecycle and new telemetry writes from a worktree use the canonical owning `RepositoryId`, so worktree telemetry joins the owning repository’s Mission.
- SC11: The one-off repair is idempotent; it repairs only obvious cases, preserves prior events, creates no duplicate completion event, prints lifecycle/review-fix/repository counts plus skipped Mission IDs, and removes the contemporary SQLite `closed` column after repair evidence is consumed.
- SC12: The deterministic certification starts no agent, invokes no LLM or network, and proves the normal-success, failed-integration, resume/retry, and telemetry-alone scenarios against persisted facts and real statistics/Board projection reads.
- SC13: `git diff --check` and `./scripts/verify-local.sh all` complete successfully with no focused or unannotated skipped tests.

## Risks and Assumptions

- Risk: Removing a persisted SQLite column before historical repair would discard corroborating legacy evidence. Mitigation: sequence repair reading before the schema removal, or use an equally small migration-compatible sequence that consumes the data first.
- Risk: Integration may be interrupted after landing and before lifecycle persistence. Assumption: the existing integration facts can distinguish a landed squash/integration commit and support idempotent retry through `MissionIntegrationService`.
- Risk: Legacy telemetry can use product-name or worktree aliases. Mitigation: normalize only unambiguous rows; report and skip collisions or ambiguous ownership.
- Risk: Broad searches will find unrelated “closed” terms. Assumption: the contradiction sweep classifies each remaining match and accepts only unrelated or explicit legacy-boundary uses.
- Assumption: the current local Parallix database is accessible to the repair command and contains enough landed-integration evidence to repair only straightforward records.

## Checkpoints

- CP 1: Before any production fix, author the failing reproduction test at `test/task-2367-integration-completion-repro.test.ts`. Seed an approved backlog task and a Mission in `integration`; exercise the current successful-integration closeout path and assert it must persist `done`, exactly one `integration` → `done` event, and N→N+1 completed population. At the mission parent commit this assertion is red because approved integration misses lifecycle completion; it becomes green once the fix lands. Record baseline SHA, clean/dirty state, and observed evidence for one recent integrated-but-uncounted Mission in the checkpoint document.
- CP 2: Add red regressions for premature completion before landing, integration-time lifecycle omission, telemetry completion semantics, and unknown `reviewFixRounds` becoming zero. Do not make broad production changes until these cases are documented red, unless the current source already fixes an individual case and that evidence is recorded.
- CP 3: Remove contemporary telemetry completion semantics and migrate the current measurement schema without introducing a renamed marker or compatibility API. Keep only an explicit, temporary legacy boundary needed by repair/import.
- CP 4: Correct integration ordering through `MissionIntegrationService`, covering normal approved integration, failure before landing, landed-but-unclosed resume, and repeated retry idempotency.
- CP 5: Establish one application/reporting boundary for lifecycle population plus telemetry; verify integration report, standalone stats, and BoardMetrics agree while retaining rolling-window semantics and canonical repository identity.
- CP 6: Preserve nullable `reviewFixRounds`, add real SQLite round-trip coverage, and implement/run the limited idempotent local-DB repair before legacy `closed` evidence becomes unavailable.
- CP 7: Add and run the deterministic no-agent certification. It must use temporary Git/worktree and real migrated persistence/projections, and cover success, failure, resume/retry, and telemetry-alone completion prevention.
- CP 8: Perform the contradiction sweep for telemetry-completion patterns; record why every remaining match is unrelated or explicitly legacy. Run local statistics against the repaired DB, record current/previous completion populations, lifecycle median/n, telemetry population, review-fix observation population, and explain any legitimate population difference.
- CP 9: Run final whitespace and repository verification, then produce a final Goal Check table with evidence for every success criterion.

### Checkpoint Documentation Requirements

Every checkpoint document (`CP-N.md`) MUST lead its evidence with durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when necessary but discouraged because line numbers rot.

Every checkpoint document MUST include:

- A concrete summary of work done.
- The exact heading `## Goal Check`.
- The exact three-column pipe-delimited table header `| Criterion | Evidence | Status |` followed by one evidence row for every applicable success criterion.
- Evidence that names the exact test, test path, ADR, or recognized command/path that establishes the row. Raw `stat`/`ls` output or generic prose alone is not enough: pair any shell output with at least one accepted reference above.
- For CP 1 and CP 2, red/green status with the exact reproduction or regression test name and the parent-commit assertion; for CP 6 and CP 8, the exact repair/statistics command and recorded counts; for CP 9, `git diff --check` and `./scripts/verify-local.sh all`.
- A non-generic `Next action:` line at the bottom that names the next checkpoint objective.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Approved integration records lifecycle completion | `test/task-2367-integration-completion-repro.test.ts`, exact test name | PASS |
| Telemetry cannot complete a Mission | deterministic certification test path, exact test name | PASS |
| Final verifier completed | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] git diff --check
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not create `markMissionDone`, CLI-specific completion SQL, a second integration coordinator, a second lifecycle-completion service, or any telemetry-based completion fallback.
- Do not alter statistics readers or Board/FLOW to infer completion from telemetry; repair lifecycle persistence and data instead.
- Do not place statistics calculations in UI code or manually manufacture final BoardMetrics in the certification.
- Do not retain, rename, or hide telemetry `closed` as `completed`, `final`, `finished`, `isClosed`, `isFinal`, or `missionDone`.
- Do not add backup tooling, interactive repair prompts, generic reconciliation, agent/LLM execution, network access, or unscoped historical-data cleanup.

## Stop Rules

- Stop before removing the SQLite `closed` column if no safe ordering remains to use legacy values as corroborating repair evidence; document the migration constraint and seek direction.
- Stop and report any affected historical Mission whose landed integration, repository identity, or review-fix count is ambiguous; print its Mission ID and leave it unchanged.
- Stop if the existing `MissionIntegrationService` cannot atomically persist state plus lane event at the post-landing boundary; do not introduce a parallel completion mechanism.
- Stop if integration, standalone statistics, and BoardMetrics still select different completed Mission IDs after using the shared reporting boundary; do not hide the discrepancy with formatting or consumer-specific filtering.
- Stop if the deterministic certification would require an agent, LLM, network, or manually constructed final BoardMetrics; redesign the test around persisted local components.
