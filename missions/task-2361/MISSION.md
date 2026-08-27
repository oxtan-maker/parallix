# Mission: Measure the second post-boundary 20-completed-mission cohort (task-2361)

## Goal
Publish ADR 0051's second post-integration completed-mission bug-frequency
measurement (cohort 2) and give the repeated measurement a reproducible,
read-only home instead of a one-off mission script.

Cohort 2 is the first 20 unique missions that durably entered
`backlog/completed/` strictly after cohort 1's last member TASK-2233
(transition commit `1c9e40f419ad4d038c0131183c767583b0c3a3e7`,
2026-07-26T06:53:33+02:00), selected with the tie-breaker frozen in
`missions/task-2291/cohort-ledger.json` (committer date ascending, then
ancestry order on `main`, then task ID ascending inside one commit).

The mission publishes three separately compared series and nothing merged:

1. ADR 0051 baseline — 39 bug / 129 total / 90 non-bug, 30.2%, 43.3 per 100 non-bug
2. Cohort 1 (TASK-2291) — 20 total / 4 bug / 16 non-bug, 20.0%, 25.0 per 100 non-bug
3. Cohort 2 (this mission) — computed at report time

The mission's default answer to TASK-2289 acceptance criterion #8 is to
implement the missing report as a first-class, tested repository artifact:
a pure classification/aggregation module under `src/application/projections/`
plus a thin read-only runner script, with fixture tests. Recording a
script-based decision instead is permitted only under the explicit conditions
in Success Criteria SC5.

## Why Now
ADR 0051 requires two post-integration cohorts before any trend claim is
allowed, and cohort 1's 20.0% is therefore an early signal that currently
supports no conclusion at all. `git log --reverse --diff-filter=A` over
`1c9e40f41..main -- backlog/completed/` already yields 170 completion additions,
so far more than 20 unique missions are eligible: the measurement is unblocked
and the two-cohort gate in ADR 0051 can be answered now rather than deferred
into a third cohort's backlog.

The second reason is that this is the third consecutive hand-run measurement.
TASK-2289 criterion #8 asked for a reproducible bug-frequency report; no
revision of this repository has ever contained one (`git log --all -S"bug-frequency"`
returns only ADR, task, and mission prose). TASK-2291 substituted
`missions/task-2291/audit-cohort.mjs` plus an independent `awk` pass. Every
future cohort re-derives the same parsing rules — duplicate task-file copies,
label unions, malformed frontmatter, fail-closed ambiguity — from prose, which
is exactly how a frozen input silently drifts. `src/application/projections/cohorts.ts`
and `src/adapters/cli/commands/cohort-report.ts` are the *throughput/cycle-time*
cohort surface (`px stats`); they measure delivery metrics, not `bug` labels, and
do not satisfy criterion #8.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: a new pure projection module plus a read-only runner (~150–220
  lines) and four named fixture scenarios in a new test file (~150–220 lines)
  put this above the Medium ceiling even though the measurement itself is
  data-only; the cohort ledger and measurement JSON artifacts are generated
  data, not engineering lines.

## Scope
- Build a cohort-2 ledger `missions/task-2361/cohort-ledger.json` recording the
  boundary commit `1c9e40f419ad4d038c0131183c767583b0c3a3e7`, the enumeration
  command, the frozen tie-breaker copied verbatim from
  `missions/task-2291/cohort-ledger.json`, the eligible unique total, the 20
  cohort members with transition commit/date/path, and the first mission after
  the cohort.
- Implement the read-only bug-frequency report:
  - a pure module under `src/application/projections/` that takes already-read
    task records and returns total / bug / non-bug counts, `bug / total`,
    `100 * bug / non-bug`, included IDs, warnings, and aborts (no filesystem,
    no git, no process access in the application layer, per ADR 0051);
  - a thin read-only runner under `scripts/` that enumerates the cohort from git
    history and the backlog stores and feeds the module.
- Port the classification rules currently encoded in
  `missions/task-2291/audit-cohort.mjs`: exact `bug` label only, label union
  across duplicate copies of one task ID across `backlog/tasks`,
  `backlog/completed`, `backlog/archive`, `backlog/archive/tasks`, labels
  recomputed at report time, malformed frontmatter surfaced as a warning,
  ambiguous ID/label data aborting the record rather than being classified.
- Fixture tests covering duplicate copies, later-added labels,
  malformed-frontmatter warnings, and fail-closed ambiguous classification.
- Publish `missions/task-2361/cohort-measurement.json` and a checkpoint write-up
  carrying all three series side by side with calibrated language.
- Create or link the cohort-3 successor record before handoff.

## Out of Scope
- Re-deriving cohort 1's boundary, membership, denominator, tie-breaker, or the
  ADR 0051 baseline numbers. All four are frozen inputs.
- Any change to `src/application/projections/cohorts.ts`,
  `src/adapters/cli/commands/cohort-report.ts`, `stats-cohorts.ts`, or the
  `px stats` cycle-time/throughput surface.
- Adding a new `px` subcommand or TUI surface for the report.
- Mutating any task label, status, assignee, ordinal, or lifecycle metadata,
  including fixing the known `aborts` entry
  (`backlog/tasks/task-2359 ... filename id TASK-2359 != frontmatter id TASK-2358`);
  it is reported, not repaired, by this mission.
- Rewriting ADR 0051's baseline table or decision drivers. Appending the
  cohort-2 result to ADR 0051's measurement record is allowed; changing the
  baseline is not.
- Any speed, throughput, cost, or token qualification of the bug-frequency result.
- Backfilling cohort 3 or automating a recurring schedule for the report.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1 — `missions/task-2361/cohort-ledger.json` exists and contains: `boundary.commit`
  equal to `1c9e40f419ad4d038c0131183c767583b0c3a3e7`, a `tie_breaker` array
  string-equal to the `tie_breaker` array in `missions/task-2291/cohort-ledger.json`,
  an `enumeration_command` string that re-runs to the same membership, an integer
  `eligible_unique_total`, a `cohort` array of exactly 20 entries each with `rank`,
  `id`, `transition_commit`, `transition_date`, `path`, and a `next_after_cohort`
  object. No ID in `cohort` appears in cohort 1's 20 IDs, and every
  `transition_date` is strictly greater than 2026-07-26T06:53:33+02:00.
- SC2 — If fewer than 20 unique eligible missions exist, the mission stops at
  CP 1 and the checkpoint records the exact eligible count and the exact
  remaining count (`20 - eligible`) instead of publishing a cohort.
- SC3 — `missions/task-2361/cohort-measurement.json` publishes `total`, `bug`,
  `nonBug`, `bugOverTotal`, `bugPer100NonBug`, `bugIds`, `nonBugIds`, `warnings`,
  `aborts`, and per-row `copies`/`copyPaths`/`labelUnion`, and additionally
  carries cohort 1 (20 / 4 / 16, 0.2, 25.0) and the ADR 0051 baseline
  (39 / 129 / 90, 0.302…, 43.33…) as two separate sibling objects that are not
  summed, averaged, or pooled with cohort 2.
- SC4 — Classification uses the exact string `bug` (not `bugs`, not a title
  keyword, not a severity inference), unions labels across every copy of a task
  ID found in `backlog/tasks`, `backlog/completed`, `backlog/archive`, and
  `backlog/archive/tasks`, and reads labels from the working tree at report time
  rather than from the transition commit.
- SC5 — Exactly one of the following holds and is stated in a checkpoint:
  (A) the report is implemented as a pure module under
  `src/application/projections/` plus a read-only runner under `scripts/`, with
  a new test file under `test/` whose test names cover all four scenarios —
  duplicate copies of one task ID, a `bug` label added after the transition
  commit, malformed frontmatter producing a warning without aborting the run,
  and ambiguous ID/label data aborting that record — and `npm test` passes for
  that file; or (B) a checkpoint contains a `## Decision: measurement stays
  script-based` section naming the specific blocker that made (A) impossible,
  and the same decision is recorded in the backlog task file. Option (A) is the
  mission default; option (B) without a named blocker fails this criterion.
- SC6 — The published conclusion states a direction only if cohort 1 and cohort 2
  both fall below the ADR 0051 baseline of 30.2% / 43.3 per 100 non-bug; if they
  disagree in direction, the write-up uses the word "inconclusive" and makes no
  trend claim. In either case the write-up contains no speed, throughput,
  cycle-time, cost, or token qualifier, and no claim of architectural causation.
- SC7 — `git status --porcelain` at handoff shows no modification to any file
  under `backlog/tasks/`, `backlog/completed/`, or `backlog/archive/` other than
  the mission's own backlog record `backlog/tasks/task-2361 - Measure-the-second-post-boundary-20-completed-mission-cohort.md`
  and a newly created cohort-3 successor task file, and no `px active`,
  `px review`, `px integrate`, or agent/network call was made by the measurement.
- SC8 — A cohort-3 successor exists before handoff: either a new
  `backlog/tasks/task-<id>` record whose description fixes cohort 3's boundary at
  cohort 2's last member's transition commit and reuses the same frozen
  tie-breaker, or a link to an existing record that already does so. The chosen
  ID is verified free against current `main`, not only against this worktree.
- SC9 — `./scripts/verify-local.sh all` exits 0 on the final tree.

## Risks and Assumptions
- Assumption: the 170 completion additions observed after `1c9e40f41` on this
  worktree's `main` contain at least 20 unique task IDs. Duplicate re-adds of a
  single ID reduce the unique count; SC2 is the guard.
- Risk: cohort membership drifts if the enumeration runs against a stale `main`.
  Mitigation — CP 1 records the exact `main` commit the enumeration was run
  against alongside the ledger.
- Risk: labels are read at report time (SC4), so re-running the report later can
  legitimately change cohort 2's numerator when a `bug` label is added
  afterwards. This is ADR 0051's stated rule, not a defect; the measurement JSON
  records the read time so a later difference is explainable.
- Risk: putting filesystem or git access inside `src/application/` would violate
  ADR 0051's UI-neutral boundary. Mitigation — all IO lives in the `scripts/`
  runner; the projection module is pure and takes records as input.
- Risk: a temptation to "clean up" the known abort record
  (`task-2359` filename/frontmatter ID mismatch) to get a clean run. It is
  explicitly out of scope; a fail-closed abort is the correct output.
- Risk: two cohorts below baseline reads as proof. The four bug missions in
  cohort 1 landed outside the ADR 0051 extracted slices, so causation is not
  established; SC6 constrains the language.
- Assumption: ADR 0051 remains the owning decision record and no superseding ADR
  changes the baseline mid-mission. If one has, CP 1 stops and reports it.

## Checkpoints
- CP 1: Build and freeze the cohort-2 ledger. Enumerate
  `1c9e40f419ad4d038c0131183c767583b0c3a3e7..main -- backlog/completed/` with
  `git log --reverse --no-renames --diff-filter=A`, dedupe by task ID, apply the
  frozen tie-breaker, take the first 20, and write
  `missions/task-2361/cohort-ledger.json`. Record the `main` commit enumerated
  against and the eligible unique total. If fewer than 20 unique missions are
  eligible, stop here per SC2.
- CP 2: Deliver the report (SC5). Default path: pure module under
  `src/application/projections/`, read-only runner under `scripts/`, new test
  file under `test/` with the four named fixture scenarios, run against the CP 1
  ledger to reproduce cohort 1's published 20 / 4 / 16 as a self-check before
  computing cohort 2. Fallback path: the `## Decision: measurement stays
  script-based` section with a named blocker.
- CP 3: Publish and hand off. Write
  `missions/task-2361/cohort-measurement.json` with the three separate series,
  state the cohort-2 result and the SC6-constrained conclusion, list which
  cohort-2 bug missions touch the ADR 0051 extracted slices, create or link the
  cohort-3 successor, and confirm no task-record mutation (SC7).

### Checkpoint Documentation Requirements
Every checkpoint document (`missions/task-2361/CP-N.md`) MUST include:
- A summary of work done in that checkpoint
- A `## Goal Check` section using that exact heading
- Immediately under it, a 3-column pipe-delimited markdown table with the
  columns `| Criterion | Evidence | Status |` — one row per criterion the
  checkpoint touches (SC1–SC9), Status one of PASS / FAIL / N/A
- Evidence must lead with a durable reference Parallix verifies today:
  1. **Recognized repo commands or paths** — e.g. `` `node scripts/<runner>.mjs` ``,
     `` `git log --reverse --no-renames --diff-filter=A --format='C|%H|%cI|%s' --name-only 1c9e40f419ad4d038c0131183c767583b0c3a3e7..main -- backlog/completed/` ``,
     `` `npm test -- test/task-2361-bug-frequency.test.ts` ``, `` `./scripts/verify-local.sh all` ``
  2. **Test names** — the exact `it`/`test` title as written in the repo, e.g.
     a name covering "unions labels across duplicate copies of one task id"
  3. **Test file paths** — e.g. `test/task-2361-bug-frequency.test.ts` (must exist)
  4. **ADR references** — `ADR 0051` for the cohort rule and baseline, `ADR 0039`
     for the falsifiability rule (each must exist under `docs/adr/`)
  5. **File:line references** — accepted where nothing else pins the claim, but
     line numbers rot; prefer the four forms above
- Weak-agent failure mode, stated explicitly: raw `stat`, `ls`, `cat`, or
  `git status` output pasted alone, or prose such as "the ledger was verified"
  or "all counts check out", does NOT satisfy a row. Shell output is supplemental
  and must be paired with a command, test name, test file path, or ADR reference
  from the list above. A row asserting a number (20, 4, 16, 30.2%, 43.3) must
  cite the artifact the number was read from — `missions/task-2361/cohort-measurement.json`,
  `missions/task-2291/cohort-measurement.json`, or `docs/adr/0051-ui-neutral-application-boundary.md`.
- SC7's no-mutation row must cite the `git status --porcelain` command together
  with the list of paths written by the mission, not a bare "nothing was changed".
- A non-generic `Next action:` line at the bottom naming the next concrete step
  (for example, the specific runner invocation or the successor task ID), never
  "continue" or "proceed to CP 2".

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1 cohort-2 ledger frozen at TASK-2233's transition commit | `missions/task-2361/cohort-ledger.json`, tie-breaker copied from `missions/task-2291/cohort-ledger.json`, `ADR 0051` | PASS |
| SC5 duplicate-copy label union covered by a fixture test | `test/task-2361-bug-frequency.test.ts`, `npm test -- test/task-2361-bug-frequency.test.ts` | PASS |
| SC9 verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `docs/adr/0051-ui-neutral-application-boundary.md` — append the cohort-2
  result only; the baseline table (129 / 39 / 90, 30.2%, 43.3) and the decision
  drivers are read-only.
- `missions/task-2291/**` — read-only frozen inputs (`cohort-ledger.json`,
  `cohort-measurement.json`, `audit-cohort.mjs`, `CP-1.md`–`CP-3.md`).
- `src/application/projections/cohorts.ts`, `src/adapters/cli/commands/cohort-report.ts`,
  `src/adapters/cli/commands/stats-cohorts.ts`, `src/adapters/cli/commands/stats*.ts` —
  the throughput cohort surface; do not modify.
- `backlog/tasks/`, `backlog/completed/`, `backlog/archive/` — read-only except
  this mission's own record and the new cohort-3 successor file.
- `src/application/**` — no filesystem, git, network, or `process` access may be
  introduced; IO belongs in the `scripts/` runner.

## Stop Rules
- Fewer than 20 unique eligible missions after the boundary commit — stop at
  CP 1, report eligible and remaining counts (SC2), do not widen the window,
  do not relax the tie-breaker, do not include non-completed records.
- The recomputed cohort 1 self-check in CP 2 does not reproduce 20 / 4 / 16 —
  stop and report the discrepancy; do not adjust cohort 1, the tie-breaker, or
  the parsing rules to force agreement.
- A cohort-2 result that requires changing the ADR 0051 baseline, the label
  rule, the denominator, or the cohort boundary to look better — stop and report.
- An ambiguous record forces a classification choice not covered by the
  fail-closed rule — stop and report; do not guess and do not edit the task file.
- The report cannot be implemented as a pure module plus runner without adding
  IO to `src/application/` or a new `px` subcommand — take SC5 option (B) with a
  named blocker rather than expanding scope.
- Any step would mutate a task label, status, assignee, or lifecycle state, or
  requires `px active` / `px review` / `px integrate` / an agent / a network
  call — stop; the measurement is read-only (SC7).
- `./scripts/verify-local.sh all` fails for a reason inside this mission's diff —
  fix it; if it fails on a pre-existing baseline-red test, report the failing
  test name and its state at the mission's parent commit rather than patching
  production code to green it.
