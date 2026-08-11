# Mission: Measure post-boundary bug-frequency cohort (task-2291)

## Goal
Produce ADR 0051's first reproducible, read-only reliability measurement for
the first 20 unique missions that durably enter `backlog/completed/` after
TASK-2290's actual integration boundary, or stop with the evidenced remaining
sample count if that cohort does not yet exist.

## Why Now
TASK-2289 supplies the report needed to observe the UI-neutral application
boundary introduced by TASK-2290. Measuring the first completed post-boundary
cohort establishes a comparable baseline without treating elapsed time,
throughput, or pre-boundary work as reliability evidence.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: resolve the integration cutoff, calculate a completed-only
  cohort from repository records, independently audit exact-label
  classification and arithmetic, and record the successor observation.

## Scope
- Resolve TASK-2290's actual integration commit and date from repository
  evidence and use them as the exclusive cohort boundary.
- Determine whether 20 unique post-boundary durable transitions into
  `backlog/completed/` exist; when they do, select the first 20 using a
  documented deterministic tie-breaker.
- Run TASK-2289's read-only bug-frequency report and independently audit its
  cohort membership, duplicate task-file label union, completed-only filter,
  and arithmetic.
- Publish the cohort task IDs, total, bug count, non-bug count, `bug / total`,
  `100 * bug / non-bug`, the ADR 0051 baseline of 39 / 129 (30.2%), task mix,
  cutoff commit/date, and the separately evidenced `stats-backfill` and
  `active` slice findings.
- Create or link the next 20-completed-mission measurement unless an
  integrated automated recurring report already owns ADR 0051's requirement.

## Out of Scope
- Changing application-boundary production code, reporting implementation, or
  task classification logic.
- Editing task labels, statuses, ownership, or mission files as part of the
  measurement.
- Inferring architectural causation, a durable trend, or reliability
  improvement from one cohort.
- Using network services, Forgejo, agents, nested `px` execution, or expensive
  commands to collect the result.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- TASK-2290's integration cutoff is recorded as an exact commit and date, and
  every cohort member's durable completion transition is strictly after it.
- If fewer than 20 eligible transitions exist, the result states the exact
  eligible count and remaining count, cites repository evidence for the cutoff
  and transitions, and stops without publishing a partial rate or extrapolation.
- If at least 20 eligible transitions exist, the report lists exactly 20 unique
  task IDs selected by a documented deterministic tie-breaker; creation date,
  pre-boundary completion, and every non-completed state are excluded.
- Bug classification uses only the exact `bug` label, unions labels across
  duplicate task-file copies, recomputes labels at report time, warns for each
  unambiguous malformed record included, and aborts on ambiguous completion,
  ID, date, or label classification.
- The completed-cohort report states the exact bug and non-bug counts, total,
  `bug / total`, and `100 * bug / non-bug`; each value is reproducible from the
  listed task IDs and is compared separately with ADR 0051's 39 / 129 (30.2%)
  baseline.
- Completed bug-labelled missions touching `stats-backfill` or `active` are
  listed separately with task and file evidence; the aggregate ratio is not
  presented as proof of architectural causation.
- The report says that a lower rate is an early signal rather than a durable
  trend, and reports an equal or higher rate without a speed or throughput
  qualification.
- Before handoff, the next 20-completed-mission cohort measurement is created
  or linked, unless evidence identifies an integrated automated recurring
  report as the ADR 0051 owner.

## Risks and Assumptions
- TASK-2290's integration boundary may be ambiguous; stop for human direction
  rather than choosing a convenient commit or date.
- Fewer than 20 eligible completions may exist; this is an expected stop
  outcome, not a reason to substitute older work or elapsed time.
- Duplicate, malformed, reopened, or archived task records can distort the
  cohort; retain qualifying completed missions and surface unambiguous defects,
  but abort when their classification is ambiguous.
- The TASK-2289 report is assumed to be available and read-only; a disagreement
  with the independent audit requires human direction.

## Checkpoints
- CP 1: Establish the measurement boundary and eligibility ledger. Record
  TASK-2290's actual integration commit/date, enumerate durable post-boundary
  completion transitions, document tie-breaking, and either stop with the
  remaining sample count or freeze the first 20 unique task IDs.
- CP 2: Execute and audit the read-only measurement. Run the TASK-2289 report,
  independently recompute label union, cohort membership, and arithmetic, then
  publish the aggregate values and calibrated ADR 0051 comparison.
- CP 3: Separate slice findings and successor ownership. Identify qualifying
  completed bug missions touching `stats-backfill` or `active` with file/task
  evidence, state the non-causation limitation, and create or link the next
  cohort measurement unless recurring automation is evidenced.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a concise summary of the work
done, then the exact heading `## Goal Check` followed by this exact 3-column
table header:

| Criterion | Evidence | Status |
|---|---|---|

Include one row per applicable success criterion. Evidence must use at least
one form Parallix already verifies today: an existing file:line reference, an
exact existing test name, an existing test file path, an ADR reference, or a
recognized repository command/path such as backticked `npm ...`, `node ...`,
`git ...`, `px ...`, or `./...`. For this measurement, checkpoint evidence
must cite the cutoff and task records with file:line references, identify ADR
0051, and record the exact report/audit command where applicable. Raw `stat`/
`ls` output or generic prose alone is not enough: pair any shell output with
one of the accepted references above. End every checkpoint document with a
specific `Next action:` line naming the next measurement or audit step.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify production source, report implementation, tests, workflow
  state, task labels/statuses, or external services while measuring.
- Read repository data only; do not launch agents, contact Forgejo, make network
  calls, run nested `px`, or invoke expensive commands.
- Preserve the observation boundary, 20-mission cohort size, exact `bug` label
  rule, duplicate-label union, completed-only denominator, and ADR 0051
  baseline regardless of the measured result.

## Stop Rules
- Stop and report the exact eligible and remaining counts when fewer than 20
  post-boundary durable completion transitions exist.
- Stop for human direction when TASK-2290's integration commit/date cannot be
  established unambiguously.
- Stop for human direction when the TASK-2289 report and independent audit
  disagree on cohort membership, label classification, or arithmetic.
- Stop rather than classify an ambiguous completion, ID, date, or label record
  as non-bug.
- Stop before any action that would mutate repository workflow data or require
  network, Forgejo, agent, nested `px`, or expensive-command access.
