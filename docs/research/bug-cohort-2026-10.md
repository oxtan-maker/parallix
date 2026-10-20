# Parallix bug cohort research — latest 40 bug missions (2026-10-05 → 2026-10-18)

Historical research artifact (PX-0012). It records what was observed in one fixed
window of Parallix delivery history, what the evidence supports about causes, and
which preventive controls look worth their engineering cost. It is not live
documentation, not a defect-rate claim, and not a promise that any recommended
control prevents future bugs.

## 1. Cohort contract

| Item | Value |
|---|---|
| Cutoff revision | `67480fc0308dbaf3f3129db0189bd0e419cc2ca9` on `main` (committer `2026-10-18T15:24:48+02:00`), the base revision of this research branch |
| Mission authority | Operator mission store `~/.local/state/parallix/parallix.db`, `repository_id = 'parallix'` |
| Corroborating sources | `backlog/tasks`, `backlog/completed` task records; `main` commit history (`Task: task-<n>` trailer); recorded reproduction tests and checkpoint Goal Check evidence in the mission store |
| Bug inclusion rule | Mission carries the exact `bug` label in Mission state **and** `status = done`. Per `docs/metric-contract.md`, "The exact `bug` label from Mission state is authoritative; Backlog task labels do not determine membership." |
| Recency key | First `integration → done` event in `board_lane_events` (`completedAt` in `docs/metric-contract.md`). Administrative `closed_at` is never used as the key. |
| Ordering | `completedAt` descending; deterministic tie-break: mission id ascending |
| Cohort | 40 distinct mission ids, `task-2641` (`2026-10-05T11:19:15.000Z`) through `task-2777` (`2026-10-18T10:23:15.000Z`) |

Cohort ids (most recent first): task-2777, task-2769, task-2770, task-2771,
task-2761, task-2766, task-2758, task-2763, task-2760, task-2757, task-2756,
task-2752, task-2712, task-2744, task-2735, task-2730, task-2732, task-2722,
task-2729, task-2717, task-2724, task-2706, task-2709, task-2705, task-2696,
task-2704, task-2695, task-2694, task-2685, task-2672, task-2673, task-2681,
task-2679, task-2651, task-2670, task-2674, task-2671, task-2663, task-2642,
task-2641.

### Population, exclusions and cross-checks

- 219 Parallix missions carry the exact `bug` label; 215 are `done`.
- 179 of the 215 have a lane-event completion key; 36 have only `closed_at`
  (legacy fallback, none selected). All 40 selected rows used the lane-event key,
  and all 40 keys are distinct, so the tie-break was never exercised.
- 4 bug-labeled missions are excluded as not done: task-2773.01, task-2774,
  task-2775, task-2776.
- No shortfall: 40 verifiable bugs exist.
- Size cross-check through the public CLI: `px stats --from 2026-10-05 --to 2026-10-18`
  reports 40 bug missions of 129 completed (31.0%). The 129-vs-124 difference
  against an instant-based window is the CLI's inclusive local-calendar-date
  window (`Europe/Stockholm`), a window-edge difference, not a membership
  difference.
- Backlog-store cross-check: `node --import tsx scripts/bug-frequency-report.ts
  --enumerate 6c80042270a83402dfc8ae906a3fe0ae21fd6b6a --ref main --cohort-size 40`
  derives 40 completed missions from `backlog/completed` file-addition recency;
  only 10 of them are bug-labeled and only 10 intersect the lane-event cohort.
  Backlog file-addition recency is therefore rejected as the cohort key: task
  records land in later batched commits and are absent for many missions.
- Record availability differs by source: 39 of 40 cohort members have a
  `backlog/completed` record; task-2651 has none. 158 of the 215 done bug
  missions have no `backlog/tasks` or `backlog/completed` record at all. Backlog
  markdown is used only as corroborating symptom text.
- Label divergence excluded per the metric contract: backlog records label
  task-2773.03, task-2773.09 and task-2514 as `bug` while Mission state does
  not.
- Fix attribution: all 40 resolve to at least one `main` commit by trailer.
  18 resolve to a single-mission commit; 22 resolve only to batched landing
  commits carrying several mission trailers (`7246f90a5` 14, `caecfbf69` 17,
  `e9158207b` 13, `5a74441d9` 10, `00ad03107` 8, `4becaed9f` 5, `d0a5a8a64` 4,
  `4b0f3b937` 3). For those, attribution rests on the trailer plus the recorded
  reproduction test, not on the commit alone.

## 2. Per-bug findings

Status key: **C** = cause confirmed against a fix diff or an explicit recorded
diagnostic; **C\*** = cause stated by the mission's own recorded brief and
consistent with the changed files, not independently re-derived from a diff;
**H** = hypothesis, evidence incomplete.

| Bug | Symptom (recorded) | Trigger | Affected boundary | Root cause | Fix | Why the defense missed it |
|---|---|---|---|---|---|---|
| task-2777 | Web-triggered integrate fails: "current branch is main, expected mission/task-2772", then preflight failure | Board integrate on a web host started from the primary checkout | `src/composition/workflow-operations.ts`, `src/adapters/git/mission-execution-context.ts`, integrate preflight | Supervisor, executor and context builder derived branch and base from `process.cwd()`; fix threads explicit mission/base checkouts through a typed port (C) | `3f3dfe2f0` | The existing board-integrate case passed vacuously (recorded review finding); no case ran integrate with a web host whose cwd is `main` |
| task-2769 | Board agent attribution disagrees with actual provider execution | After task-2750 execution observation | `src/application/projections/provider-execution.ts`, `src/application/projections/agent-status.ts`, `src/adapters/filesystem/run-history-store.ts` | `collectInvocation` treated every retained run with a dead supervisor as attributable; the per-mission run budget walked unsorted directory order, so the retained set was nondeterministic (C, recorded findings) | `919ccf27f` | Shell-only smoke; no projection-level test over multi-run history |
| task-2770 | Cold-cache observer timeout/restart loop; board slow since Oct 13 | After task-2750 | `src/composition/workflow-observation.ts`, metrics read adapter | Cold-cache observer path re-entered timeout/restart; warm reload 214–258 ms versus cold 1204 ms before repair (C\*) | `2740ae624` | Shell-only smoke never exercised a cold cache through the browser path |
| task-2771 | Spinner carriage returns lost on replay; Ctrl+C leaves detached work owning the mission | After task-2750 CLI workflow | `src/composition/workflow-cli.ts`, `src/application/mission-terminal.ts`, `src/application/workflow-operation-service.ts` | Replay re-rendered frames without terminal control characters; stop path did not fence the in-flight operation (C\*) | `cb0a47bf7` | Unit tests asserted plain redirected frames, not real terminal control |
| task-2761 | Review launches exceeded Linux per-argument limit, `bwrap` exit 126, repeated provider fallback | task-2746 review / act-on-review launches | `src/adapters/agents/{claude,opencode,qwen,vibe}.ts`, `src/adapters/agents/prompt-artifacts.ts`, `src/application/agent-launch-context.ts` | Retained context grew into argv with no byte budget at the launch boundary (C) | `0dd869422` | Provider verification used fake providers with small prompts |
| task-2766 | Successful exact-check recovery strands an active mission with pending review | Repair-only early return from task-2738 retained by task-2757 | `src/application/review-loop/review-loop.ts`, `retained-repair.ts` | Repair-only early return skipped start preparation and handoff; red showed handoff count 0 versus expected (C) | `7182e6fff` | No case asserted handoff after a successful exact-check recovery |
| task-2758 | Classifier comparison distorted by telemetry denominators, undecided samples, sample-time windowing | Operator effectiveness review over ~120 re-reviews | `src/interfaces/cli/stats.ts`, statistics contract | Measurement-only hooks wrote telemetry and denominators came from telemetry rather than decided rounds; an accidentally truncated adapter was restored in the same mission (C\*) | `7246f90a5` (batch) | Statistics contract tests accepted telemetry-derived denominators |
| task-2763 | Reviewer classifier judged production rounds on an uncalibrated model | Provider moved the `jev-latest` alias between 2026-10-14 and 2026-10-15 | `src/adapters/decision/provider.ts` | Every route requested a mutable alias; no pin, no drift probe (C) | `7246f90a5` (batch) | No contract asserted a concrete model id; the alias was treated as stable |
| task-2760 | Review continuation fails before reviewer execution with 155 871- and 188 583-character argv prompts, ambiguous null exit | task-2746 continuation | agent adapters; `test/integration/agents/*` | Same argv-payload family; the recorded root cause for the failing case is a fixture that passed a stdin marker without feeding stdin, so pinned codex 0.156.1 exited ambiguously (C for the fixture, H for the full chain) | `7246f90a5` (batch) | Fixture faked the provider boundary; the separate landing-tree gate red was an inherited backlog-root guard, not a mission defect |
| task-2757 | No-op repair agent exit 0 treated as success; failed gate stranded, diagnostics omitted | task-2750 continuation shortcut | `src/application/review-loop/review-loop.ts`, `src/application/review-loop/retained-repair.ts` | Resume branch keyed on any unverified repair checkpoint rather than gate repairs with retained evidence (C, recorded finding) | `7246f90a5` (batch) | No case for missing or access-denied retained gate evidence |
| task-2756 | Restart deadlock: `px active` re-executed a persisted human-only contract blocker; harness printed "Implementation complete" for a blocked stop | Operator corrected a contradictory success criterion on task-2751 | `src/adapters/cli/commands/active.ts`, `src/composition/create-cli.ts` | Operator resume authority was granted by the shared active command, so an automatic resume re-ran a human-only stop; `record --force` never refreshes `authorizedCriteria`, leaving no supported resume path (C) | `7246f90a5` (batch) | No case distinguished operator-initiated resume from automatic recovery |
| task-2752 | Review decisions, statistics and classifier research attach to code the reviewer did not judge | Review head advances after round start | `src/adapters/review/review-evidence.ts`, `src/adapters/sqlite/migrations/0035-review-round-baseline.sql` | Only `subject.revision` was persisted, so the judged baseline was not recorded as an identity (C\*) | `7246f90a5` (batch) | No contract test tied a decision to the revision actually judged |
| task-2712 | Inherited baseline-red guards from `main` forced unrelated repairs and killed px | task-2709 CP-5 inherited a retired-root guard | integrate closeout, retired backlog root guard | A retired-root guard red on `main` propagates to every later mission; guard ownership was not at the mission that introduces the red (C, recorded findings) | `e9158207b` (batch) | The guard itself was the defense; it had no ownership or quarantine rule |
| task-2744 | NVM-installed Codex falsely reported missing during shared-file rebase conflicts | Nested adapter calls | `src/adapters/cli/commands/handoff.ts`, `execute-mission-adapters.ts`, `repair-handoff.ts` | Nested port factories re-created a default configuration with an empty forwarded environment instead of carrying the initiating configuration (C) | `e9158207b` (batch) | Per-adapter suites never crossed two nested adapter calls |
| task-2735 | Raw `stream-json` visible in `px attach` and live web capture | task-2722 terminal work | `src/adapters/process/tmux-host.ts`, `src/adapters/agents/claude-stream-view.ts`, `src/adapters/process/spawn-tee.ts` | tmux displayed provider bytes before the shared renderer ran in the supervisor (C\*) | `26e2adac2` | Terminal suites asserted telemetry retention, not what the operator saw |
| task-2730 | Handoff stalled: original CP-3 lacked evidence while the repair prompt authorized writes only to CP-5 | task-2726 repair launch | rebound repair checkpoint contract | Repair authority enumerated harness checkpoints, not unfinished original criteria (C) | `4b0f3b937` (batch) | Contract cases covered authorized checkpoints only, not the unfinished-original case |
| task-2732 | Main changes misrepresented as repairs; omitted repair evidence; arbitrary byte rejection; preparation fallbacks misreported as over-budget | px-0010 classifier research | review-classification evidence packet | Packet was not scoped to the mission surface; untyped exceptions and byte limits produced fallbacks (C\*) | `5a74441d9` (batch) | Packet tests used hand-built packets, not real round shapes |
| task-2722 | Host-threatening allocation during a focused DOM assertion run | PX-0008 reproduction | test harness runner, `test-memory-boundary` | No contained-runner memory enforcement; a per-process V8 heap cap does not bound native allocations or descendants; CPU and wall watchdogs cannot prevent exhaustion (C) | `5a74441d9` (batch) | Harness budgets were CPU/wall only; memory was unbounded |
| task-2729 | Custom-agent termination persisted a `sigint` block, turning an invocation failure into provider unavailability | 2026-10-12 custom-agent termination | `src/application/services/agent-limit.ts`, `src/adapters/agents/pi-worker-client.ts` | `detectLimitHit` treated a bare SIGTERM as a quota hit (C) | `5a74441d9` (batch) | Blocking rules were tested with limit messages, not with signal-only termination |
| task-2717 | Hosted CI reached production confinement from a fake draft fixture and leaked Forgejo publication from a resolved-rebase fixture | CI tier selection | `test/integration/presentation/*`, tier registry | Fixtures faked real boundaries while claiming production confinement; suite tier misstated dependencies (C, recorded finding) | `5a74441d9` (batch) | Tier membership was asserted by suite name, not by declared dependencies |
| task-2724 | Installed launchers appear missing, autodetection excludes them, Claude transcript retention searches a different home | Commit `5f1e5b06ed` migrated probes and state paths to explicit configuration | `src/adapters/agents/launcher-availability.ts`, `first-run-config.ts`, `composition/*` | A default probe dropped the injected configuration: `options.probe ?? ((family) => workflowLauncherStatus(family))` (C, diff) | `17d98bac8` | Availability suites constructed adapters directly, never through composition |
| task-2706 | Existing `px-XXXX` missions fail draft preflight with "No Backlog task file" | Legacy backlog missions in draft | `src/adapters/cli/commands/draft-stats.ts`, `src/application/legacy-adhoc-migration.ts`, `src/adapters/sqlite/mission-store.ts` | `isDbOwnedMission` treated any stored mission as DB-owned; the migration rewrote only some foreign-key columns (`usage_statistics.mission`, `checkpoint_mission_id`, retired `mission_brief_constraints`) (C, recorded findings) | `b4ddb9ec4` | Migration cases enumerated tables by hand and missed renamed ones |
| task-2709 | Automatic rebase stopped on shared conflicts; recovery terminated before the implementer prompt | Incident task-2705 | `src/adapters/cli/commands/integrate.ts`, `src/adapters/review/review-loop.ts` | `createRebaseWorkflowPort({ ...options })` omitted `configuration`, so the launcher resolved to a default with `forwardedEnvironment = {}`, `searchPath = ''`; an `as never` cast suppressed the type error (C, diff) | `d423cbea3` | The option object was cast, so the type system could not see the missing field |
| task-2705 | Clicking Cancel opens the card; only the first enabled action per card renders; confirmation is not perceivable or keyboard-reachable | Multiple enabled actions on one board card | `web/src/action-button.tsx`, `board.tsx`, `cancel-confirmation.tsx` | Card rendering assumed a single action per card (C\*) | `3a9de1bfc` | Web interaction cases covered single-action cards only |
| task-2696 | Missing-review failure falls through into reviewer selection and round persistence | Continuation of a known mission | `src/application/review-round-use-case.ts`, `src/adapters/review/review-workflow-adapter.ts` | Non-terminating exit callbacks let the rejection fall through (C) | `9b451ea48` | Guard existed but no case asserted termination |
| task-2704 | Unrelated `main` commits pollute reviews; valid packets degrade or throw; setup-required reviews without provider keys | Live 2026-10-09 evidence | `src/adapters/review/review-evidence.ts`, decision provider, review-round baseline migration | Review baseline was not pinned to the round, so packet scope and byte limits degraded (C\*) | `6d55ac043` | Packet tests did not include multi-commit round shapes |
| task-2695 | An agent-discovered invalid locked contract bounced to the implementer who could rewrite its own checks; repair success was not tied to a harness rerun | task-2694 exposed a shared recovery-authority conflict | `src/application/rebound-kernel.ts`, `src/application/integration-repair-review.ts` | Repair authority permitted the implementer to alter its own checks; no durable pre-repair checkpoint (C) | `4becaed9f` (batch) | The rebound authority model had no adversarial case |
| task-2694 | Whole board snapshot rejected, board unusable | A rebound repair stamped Goal Check rows with `recordedRound`/`repairedGate`/`repairedGates` | `src/interfaces/web/transport-projection.ts`, `transport-shape-checks.ts` | The projection forwarded rows unchanged into a strict validator that accepts only `criterion`/`evidence` (C, diff) | `f2f4a3038` | No round-trip test tied projection output to the transport validator |
| task-2685 | Bug trend showed Sep 28–Oct 4 on Oct 8 and omitted new deliveries | Bug trend versus flow comparison | `src/application/services/statistics-bug-trend.ts`, `src/application/services/statistics-report-selection.ts`, `src/domain/decision-window.ts` | Independent ISO-week and 168-hour cutoff arithmetic diverged from the shared rolling-window contract (C) | `00ad03107` (batch) | Each surface had its own window test; none asserted the shared containment |
| task-2672 | Zero agent exit with unfinished Git state after `rebase --continue` paused on `package.json`/`package-lock.json` | task-2668.02 conflict resolution | `src/application/agent-completion-contract.ts`, `src/adapters/cli/commands/resolve-conflict.ts`, `src/adapters/cli/commands/handoff.ts` | Successive-pause guidance reached only `buildRebasePrompt`; shared completion guidance contradicted it (C, recorded finding) | `00ad03107` (batch) | The repro harness faked rebase state with counters instead of real Git state |
| task-2673 | Mandatory integration dry-run falsely failed after conflict repair moved the mission to active without APPROVED review | task-2670 rebase completion | `src/application/rebase-workflow.ts` | Unconditional dry-run regardless of lifecycle state (C) | `caecfbf69` (batch) | Rebase suites asserted the happy path only |
| task-2681 | 4–13 s board requests, one request over 15 s, terminal refresh timeouts | Real-repository browser verification | `src/adapters/backlog/task-file-io.ts`, `src/adapters/sqlite/mission-store.ts`, board readers | Server CPU on a loaded shared host plus a large payload; fixed with a shared scan cache and shared snapshot builds; the remaining level was an accepted operator tradeoff (C) | `caecfbf69` (batch) | Performance was visible only against real repository size, not in suites |
| task-2679 | `Cannot transition from approved to fixing`; the correction was consumed before the failed transition | Human correction landed on an already-approved round | review-loop retry | The REQUEST_CHANGES branch transitioned to fixing for every phase except fixing, while `approved` is terminal; reconciliation consumed the source first (C) | `caecfbf69` (batch) | Retry suites never started from an approved phase |
| task-2651 | Fallback identity dropped for a repair that otherwise completed | Rebound advanced the review aggregate during `px integrate` | `src/adapters/review/review-state-mapping.ts`, integrate gate rebound | The fallback persisted a stale snapshot, which the intentional stale-flattened-write guard then rejected (C) | `caecfbf69` (batch) | The guard and the fallback were tested separately, never together |
| task-2670 | Operators lose the attached tmux view after review or during integration | Review completion / integration teardown | `src/adapters/process/tmux-host.ts`, `src/adapters/cli/commands/run-history.ts` | Teardown killed the attach client (`client?.kill('SIGTERM')`) instead of retiring the console after the result (C, recorded finding) | `0fcbe3971` | The reproduction did not exercise the real exit path (recorded finding) |
| task-2674 | Retained consoles lose operator credentials; repair rounds bypass the classifier without telemetry | task-2670 retained consoles | `src/adapters/process/tmux-host.ts`, `src/application/review-classification/repeat-review.ts`, `src/adapters/review/review-loop-presentation.ts` | No credential resolution inside a retained console; the repair path skipped classification routing and its telemetry (C) | `54b65351d` | Routing tests assumed an interactive parent process |
| task-2671 | Classifier silently unavailable because HEAD advanced after the candidate was captured | Pre-review rebase, verification, Backlog bookkeeping | `src/application/review-classification/repeat-review.ts` at fix time (removed in `caecfbf69`; the guard now lives in `src/application/review-classification/classify-review.ts`), `src/application/review-loop/reviewer-phase.ts` | Revision-drift checks were missing at several call sites; drift fell through to a silent fallback (C, diff) | `6bd45e7a4` | Repeat-review cases pinned no drift scenario |
| task-2663 | A CPU-budget gate failure was misclassified as human-only with zero repair attempts | Gate stdout contained a passing test title with the word "forbidden" | `src/domain/failure-classification.ts` (compatibility re-export at `src/application/failure-classification.ts`) | Keyword regex ran over concatenated gate output including passing result lines (C, diff) | `3fb28e798` | Classification fixtures were synthetic single-line diagnostics |
| task-2642 | 16 genuine assertion failures hidden behind a large passing prefix and a passing-looking parallel summary | task-2637.03 parallel gate output | `src/application/recovery-evidence.ts`, rebound prompts | No durable attributable command evidence; diagnostics were the terminal tail plus a generic final error (C) | `d0a5a8a64` (batch) | Repair prompts carried a tail, not retained output |
| task-2641 | Operator change requests recorded too late or as non-actionable notes; a stale approval launched a no-findings repair | Operator feedback through Forgejo reviews/comments | `src/adapters/review/review-loop.ts` human-feedback reconcile, Forgejo adapter | No author filter, `find` over the full comment history, identity keyed by created minute without a comment id, consumed set held in process state (C, recorded findings) | `d0a5a8a64` (batch) | Both cases injected a fake feedback port; no case exercised the adapter |

Status tally for the 40 rows: 31 causes are confirmed against a fix diff or an
explicit recorded diagnostic, 8 are stated by the mission's own brief and match
the changed files but were not re-derived line by line (task-2770, task-2771,
task-2758, task-2752, task-2735, task-2732, task-2705, task-2704), and 1 is only
partly confirmed (task-2760: the fixture cause is confirmed, the full
retained-context→argv→null-exit chain is a hypothesis).

### Missing evidence

Evidence that would sharpen these findings but does not exist in the current
record:

- No per-bug diff isolation for the 22 batched landing commits, and no usable
  bisect point inside a batch, so a batched fix can be attributed to a mission
  only by trailer plus reproduction test.
- No detection-time field in the mission store. The store records delivery and
  review times, not when a defect first appeared, so "how long a defense stayed
  escaped" cannot be measured; only the delivery date is known.
- No record of which verification stage first surfaced a defect. Gate output is
  retained only for failed verification commands through
  `src/application/recovery-evidence.ts`, so a defect that passed gates and was
  found by an operator is indistinguishable from one a gate caught.
- task-2760: no retained launch record tying the 155 871- and 188 583-character
  argv payloads to the ambiguous null exit; the recorded incident selection may
  replay superseded output.
- task-2763: no retained judge output pair under the old and new resolution of
  the moved alias, so the calibration change is documented but not quantified.
- task-2681: timings come from one loaded shared host with no baseline machine,
  so the host-load contribution is not separable from the code path cost.
- No counterfactual record: nothing in the store shows that an existing suite
  would have caught a bug had it covered the missing shape, so an escaped defense
  is established from the absence of a covering case in the named suite, not from
  a demonstrated catch.

## 3. Recurring mechanisms

Counts reconcile to the cohort: 7 + 8 + 7 + 6 + 5 + 3 + 1 + 1 + 1 + 1 = 40. Each
bug is assigned to exactly one primary mechanism; contributing factors are
listed separately.

| # | Primary mechanism | n | Bugs |
|---|---|---|---|
| M1 | Recovery, repair and evidence authority | 7 | task-2695, task-2730, task-2756, task-2757, task-2766, task-2642, task-2641 |
| M2 | Signal, text and telemetry interpretation | 8 | task-2663, task-2671, task-2704, task-2732, task-2758, task-2685, task-2769, task-2729 |
| M3 | Process, OS-resource and terminal lifecycle limits | 7 | task-2760, task-2761, task-2670, task-2735, task-2770, task-2771, task-2722 |
| M4 | Producer→consumer contract drift at a strict boundary | 6 | task-2694, task-2651, task-2673, task-2679, task-2696, task-2752 |
| M5 | Silent or ambient context defaults (configuration, cwd, environment, credentials) | 5 | task-2777, task-2709, task-2724, task-2744, task-2674 |
| M6 | Test and CI fixture / baseline integrity | 3 | task-2717, task-2712, task-2706 |
| M7 | External dependency drift without a pin | 1 | task-2763 |
| M8 | Client-side affordance rendering | 1 | task-2705 |
| M9 | Real-data performance visible only by manual observation | 1 | task-2681 |
| M10 | Agent-facing guidance contract insufficiency | 1 | task-2672 |

Primary causes versus contributing factors:

- task-2729 belongs to M2: signal-only SIGTERM was interpreted as persistent
  provider unavailability, not upstream identifier drift. The recorded task and
  `src/application/services/agent-limit.ts` establish this distinction; pinning
  cannot prevent it.

- The three largest mechanisms (M1–M3, 22 of 40) are all inside Parallix's own
  control plane: recovery authority, telemetry interpretation, and process
  lifecycle. Most of these defects are in how the workflow reads and acts on its
  own signals rather than in agent output quality.
- A recurring enabling factor across M4, M5 and M6 is an optional or defaulted
  parameter at a composition seam. The current source carries 137 optional
  `configuration?: ParallixConfiguration` parameters, 124 references to a
  default configuration constant, and 13 `as never` casts; `eslint.config.mjs`
  bans `@typescript-eslint/no-explicit-any` but not `as never`. In task-2709 the
  missing field was hidden precisely by an `as never` cast.
- Change-induced regression is the largest single trigger pattern: 18 of 40
  briefs name
  a prior mission as the trigger; 11 of those were introduced by non-bug
  (feature or refinement) missions and 7 by other bug missions. Six in-cohort
  chains are visible: task-2694→task-2695, task-2670→task-2673,
  task-2670→task-2674, task-2757→task-2766, task-2722→task-2735,
  task-2705→task-2709.
- Batched landing commits (22 of 40) are a contributing factor to diagnosis cost,
  not a cause: they weaken per-bug fix attribution and make bisect unhelpful.
- Inherited baseline red is a contributing factor to wasted repair rounds in at
  least task-2712, task-2760, task-2735 and task-2704, where recorded evidence
  says the gate failure was ambient rather than a mission defect.
- Review evidence gaps are measurable: 79 review findings were recorded across
  the cohort; 47 match an evidence, reproduction, verification, coverage or
  checkpoint keyword in their summary, spanning 18 of the 40 missions. That
  47/79 split is a keyword classification over `mission_review_findings.summary`,
  not a hand-audited taxonomy. Rework cost for the cohort:
  142 review rounds, 40 changes-requested rounds, 63 review→active bounces and
  51 integration→active bounces, against 285 / 71 / 97 / 94 for the 84
  non-bug missions delivered in the same window. Per mission that is 1.57 versus
  1.15 review bounces and 1.27 versus 1.12 integration bounces.

### Sampling limits

- The cohort is selected by an operator-applied `bug` label at mission creation.
  Defects fixed without a mission, defects absorbed into a feature mission, and
  defects not yet noticed are absent. The cohort therefore over-represents
  visible control-plane defects and under-represents unknown ones.
- The window is 14 days of heavy work on the review, repair and terminal
  subsystems. Mechanism weights (M1–M3) reflect that activity mix, not a stable
  repository-wide distribution.
- 31.0% bug share in the window is a share of delivered missions. Per
  `docs/metric-contract.md`, bug shares "describe delivery effort, not a defect
  rate per line of code or proof of causation". This sample cannot establish a
  repository-wide bug rate.
- 40 observations across ~30 subsystems is too few to rank mechanisms beyond
  "these three clusters are larger than the rest". A single mission moving
  between mechanisms changes a cluster count by 14–20%.
- No control group exists. Nothing here shows that a proposed control would have
  prevented a listed bug; each recommendation states the sampled bugs it could
  address and the validation that would test the claim.

## 4. Candidate preventive controls

Ranked by justified value against cost. Every gate or verification-tier change is
an operator decision; none of these is implemented by this research. R1–R5
are in descending priority; R8 is a cheap guidance adjunct, R7 requires a
separate operator decision, and R6 is deferred after checking existing coverage.
Effort estimates below are planning judgments, not measured delivery times.
Seeded checks and parent replays test detection, not prevention effectiveness.
For an adopted control, separately track relevant escapes, alerts/exemptions and
review delay in the next independently derived 40-bug cohort; do not interpret
a before/after count as causal proof.

**R1 — Composition-root configuration identity contract (M5, 5 bugs).**
Add one unit suite that constructs the production composition and asserts the
resolved configuration object reaches the deepest port factories (rebase
workflow port, launcher availability probe, handoff and repair-handoff adapters,
mission execution context). Overlapping defenses: per-adapter suites such as
`test/integration/rebase/pre-review-launcher-configuration.test.ts` and
`test/unit/adapters/cli/commands/mission-handoff-repair-contract.test.ts` cover
single seams but never two nested calls. Expected incremental benefit: detects nested-factory default reconstruction
(task-2709, task-2724, task-2744), beyond isolated adapter checks. Limits: does
not cover cwd/branch context, which task-2777 addressed with a typed execution
context port. Cost: one new unit file, no production change; maintenance is low
because it follows the composition root. Validation: the case must be red on the
parent revision for the sampled call shapes (task-2709, task-2724, task-2744)
and green only when configuration identity is preserved. Workflow cost: no
provider calls, but legitimate configuration copies may fail an identity assertion;
assert identity only at seams that promise it, and compare values elsewhere.
Re-wiring composition requires updating the fixture; this is the main maintenance
cost. Do not infer that all five M5 bugs are covered by these three replays.

**R2 — Ban type-escape casts on option and configuration objects (M5 enabling
factor).** `eslint.config.mjs` already errors on `@typescript-eslint/no-explicit-any`
and `./scripts/verify-local.sh static-analysis` runs ESLint with
`--max-warnings 0`, so the ratchet exists. Extending it to `as never` and
`as unknown as` on object literals would have surfaced task-2709 at authoring
time. Cost: small — 13 current sites to fix plus one rule. False-positive cost:
legitimate `as never` uses need an inline exemption. Limits: lint proves the
type is visible, not that the value propagates. Adding or tightening a gate is an
operator decision. Incremental benefit is visibility of hidden option errors
(task-2709), complementing R1 rather than covering five independent bugs.
Validation: seed the rule with the parent task-2709 literal, nested double casts,
and equivalent parenthesized forms; require all forbidden examples to fail and
typed literals, unrelated casts and documented exemptions to pass. First run in
report-only mode and count actionable sites versus exemptions before deciding
whether to enforce it. Maintenance: keep parser fixtures aligned with TypeScript
syntax and review exemptions; workflow cost includes fixing legacy sites and
reviewing false positives, not just writing the rule.

**R3 — Boundary round-trip contracts (M4, 6 bugs).** Two narrow suites: (a) a
projection→transport round trip that feeds stamped repair metadata
(`recordedRound`, `repairedGate`, `repairedGates`) through the real projection
into `validateWebBoardSnapshot` in `src/interfaces/web/transport-validators.ts`;
(b) a phase×event transition table for the review and integration state machine,
including `approved` + REQUEST_CHANGES and `active` + integration dry-run.
Overlap: `test/unit/interfaces/web/web-transport.cases.ts` and
`test/unit/application/review-loop/review-loop-retry-contract.test.ts`.
Expected benefit: catches producer/consumer drift and illegal transitions before
landing. Cost: two unit suites, low maintenance if driven from existing row and
phase shapes. Validation: replay task-2694 projection metadata, task-2679 approved-phase
feedback and task-2673 active-phase dry-run; require failure on their parents
and success on fixes, including unchanged valid shapes. Incremental coverage is
these crossed boundaries, not all six M4 bugs. Workflow cost: strict schemas can
flag intentional additive metadata; review the consumer contract before updating
fixtures. Maintenance follows metadata and transition changes; avoid a second
hand-maintained transition authority.

**R4 — Typed failure evidence as the only classification input (M2 subset, M1
contributor).** `src/application/recovery-evidence.ts` already persists command,
cwd, captured revision, exit code, signal, incident id, attempt and capture
completeness; `src/domain/failure-classification.ts` now drops passing
test-result lines (`PASSING_TEST_RESULT_LINE_RE`) before keyword matching. The next step is to make a typed
reason code the primary input and keyword matching an explicit, logged fallback.
Expected benefit: fewer false human-only stops (task-2663) and fewer wasted
repair rounds. Cost: moderate — every gate writer must emit a code, and existing
logs must be replayed as fixtures. False-positive cost: a missing code now falls
back instead of blocking, which can hide real infrastructure failures. Limits:
does not help telemetry-window mechanisms (task-2685, task-2758), which need the
shared window contract instead. Overlap includes the signal guard and fallback
regression in `test/unit/adapters/agents/agent-ambiguous-launch-blocking.test.ts`
(task-2729); that bug supports signal-aware classification, not pin/probe.
Incremental coverage must be demonstrated beyond those fixed cases. Validation:
replay task-2663 output with a passing forbidden title plus failing CPU diagnostic,
and task-2729 signal-only termination versus positively identified quota output;
require the expected reason and block/no-block result, including missing-code
fallbacks. Maintenance: version reason codes and preserve older-reader fallback
fixtures. Workflow costs include writer migration, triaging unknown codes and
avoiding an overly permissive fallback; this makes R4 costlier than R1–R3.

**R5 — Probe pinned external identifiers (M7, task-2763 only).** The pin and
unsupported-version rejection already exist after task-2763 in
`src/adapters/decision/provider.ts` and
`test/unit/adapters/decision/decision-contract.test.ts`. Incremental benefit is
an earlier drift alert if an upstream identifier can change resolution despite
the pin; the cohort does not establish that this remains possible. First confirm
that gap, otherwise defer. It cannot address task-2729. Implementation effort:
small opt-in diagnostic, plus resolver error handling. Maintenance: intended
upgrades require explicit re-pinning and updating resolver fixtures. Workflow
cost: network/authentication dependencies and outages can produce noisy alerts;
report resolution failure separately from confirmed drift and do not block by
default. Validation: seed unchanged id, changed id, unavailable resolver and
unsupported-version responses; require only changed resolution to report drift,
then optionally observe one read-only upstream resolution with operator-owned
credentials. No new live probe was run here. Limits: identifier equality cannot
establish equivalent model behavior or detect silent weight changes.

**R6 — Additional launch-payload budgeting (M3 subset; deferred).** task-2761
supports the argv-size transport failure; task-2760's full
retained-context→argv→null-exit chain remains a hypothesis, not a second
confirmed transport failure. `0dd869422` moved the Claude prompt to stdin, and
`src/adapters/agents/prompt-artifacts.ts` retains large context in files.
Existing overlap is substantial: `scripts/verify-provider-prompt-delivery.ts`
uses a 12 000-repeat Unicode payload, checks receipt above 188 583 bytes and
runs fake-provider public-CLI review/act-on-review paths for Claude, OpenCode
and Qwen. The owning `claude.test.ts`, `opencode-launch-contract.test.ts`,
`qwen-launcher.test.ts` and `vibe-launch-contract.test.ts` under
`test/unit/adapters/agents/` already assert oversized stdin delivery, including
retry/session paths where applicable. These are transport checks, not real-model
acceptance checks. No remaining uncovered oversized-stdin contract was established
in this research, so another generic size suite has low incremental value and
ranks below R8. A total context-growth budget would be a separate problem with
no supported threshold here. Implementation would be small for an assertion but
larger for payload policy; maintenance must follow provider transport changes.
Workflow cost: arbitrary caps can reject valid stdin payloads or truncate useful
evidence, and character counts misstate UTF-8 byte sizes. Validation prerequisite
for revival: demonstrate an uncovered call path with a seeded payload above
188 583 bytes, verify exact receipt and retry transport against the existing
checks, and show a failing parent before proposing additional coverage. Fake
providers cannot resolve task-2760's missing real launch evidence.

**R7 — Harness and baseline integrity (M6, 3 bugs, plus wasted rounds).**
Three parts: quarantine inherited baseline red at the mission that introduces it
(guidance already exists in `docs/config.md`); require a suite to declare the
real boundary it exercises so a fake fixture cannot satisfy a production-
confinement claim (task-2717); keep tier membership in
`test/lib/test-categories.ts` tied to declared dependencies. Cost: medium, it
touches the harness and the registry. False-positive cost: missions blocked on
unrelated red unless quarantine is explicit and auditable. Overlap: the existing category registry and dependency rules already own tier
membership, and current CPU/wall/memory enforcement covers some harness risks.
Incremental benefit is truthful boundary claims (task-2717) and less baseline-red
repair waste (task-2712); task-2706's migration omission still needs a separate
schema contract. Maintenance: dependency declarations and quarantine entries must
be updated and expired; stale exemptions can hide new regressions. Validation:
in disposable state seed an inherited failing baseline and a mission regression,
require them to remain distinguishable, then replay task-2717's falsely isolated
fixture and require its real dependency to be classified correctly. Record both
false quarantines and correctly attributed failures; never count a fake boundary
as production proof. Prospective value is fewer unrelated repair rounds without
more escaped mission regressions. This is a verification-tier and gate change
and therefore an operator decision.

**R8 — Latest-checkpoint criterion coverage as an agent self-check (M1
contributor).** Recorded findings flagged latest-checkpoint Goal Check coverage
five times inside task-2722 (rounds 0, 1, 4, 6 and 8) and once in task-2712,
where the latest checkpoint's evidence was not reproducible at the reviewed
revision. `px checkpoint check --slug <slug> --json` already reports uncovered
criteria, so the cheap form is an agent-side pre-review self-check, not a new
gate. Recommended as guidance only; a hard gate would add bounce volume and
belongs to the operator. Incremental benefit: agents can repair omitted rows
before review, beyond merely having the command available. Implementation and
maintenance effort: small guidance edit following the public CLI, with no duplicate
coverage algorithm. Workflow cost: one read per handoff; readiness can still be
misread as gate success or evidence truth. Validation: in disposable mission
state, compare missing criterion rows, invalid references and complete evidence;
require agents to inspect ready/findings and correct seeded omissions before
review. Later measure omission-related bounces and added handoff time. This
checks reference coverage, not whether evidence proves a criterion.

### Rejected or deferred

- **More agent-E2E coverage.** Highest cost tier, needs reachable model backends
  per ADR 0057, and the sampled defects were mostly caught by review or by an
  operator, not missed only by E2E. Deferred.
- **Raising the early integration-CI CPU cutoff.** The 3 500 ms cutoff exists for
  runner cost. Shifting more suites earlier adds wall time without addressing
  M1, M4 or M5. Rejected for this cohort.
- **Rewriting the review/repair control plane.** M1 is a large cluster, but
  the sampled fixes were narrow (an early return, a resume key, a fallback
  snapshot). A rewrite would recreate the same contract-drift exposure. Deferred
  behind R3 and R4.
- **A repository-wide defect-rate dashboard.** `docs/metric-contract.md` already
  states that bug share is delivery effort, not a defect rate. A new surface
  would create a misleading authority. Rejected.
- **Making all 137 optional configuration parameters required.** Mechanically
  large and touches every adapter signature. Deferred behind R1, which measures
  whether the composition contract alone is enough.

## 5. Read-only corroboration

One representative behavior from M2 (statistics windowing, task-2685 and
task-2758) was corroborated through the public CLI without mutating state:

```
px stats --from 2026-10-05 --to 2026-10-18
px stats
```

Observed: the explicit range report prints one inclusive selected range
(2026-10-05 → 2026-10-18) with 40 bug missions of 129 completed (31.0%), with no
ISO-week dropping; the default report prints rolling seven-day periods
(2026-10-12 → 2026-10-18: 21/59, 35.6%; 2026-10-05 → 2026-10-11: 19/70, 27.1%).
That matches the post-fix contract in `docs/metric-contract.md` and confirms the
cohort size independently of the query used to build it.

Limitations: the command reads the live operator database, so the numbers are
this machine's state at read time; the reporting window is local calendar dates,
which is why the completed count differs from an instant-based window; the web
board path was not exercised.

## 6. Recommendation and follow-up boundaries

Single actionable recommendation: start with R1 and R2. They are the cheapest
measured interventions, they target a configuration cluster of 5 of 40 sampled
bugs, with direct replay candidates for three and a type-escape example in
task-2709 (coverage of all five is not established), and R1 produces
a number — how many composition seams actually lose configuration identity —
before any large signature refactor is considered.

Follow-up boundaries for whoever acts on this:

- Re-derive the cohort from the same rule before comparing anything to these
  numbers; the cohort is a frozen window, not a standing series.
- Any new gate, tier change or CPU-budget change (R2, R7, R8) is an operator
  decision and must not be added by an implementer.
- Treat M1–M3 as the areas to watch in the next window; if their weights persist
  across an independently derived cohort, revisit R3–R5 with fresh evidence.
- Do not use this document as proof of current runtime behavior; re-check any
  claim against the executable source and tests.
