# TASK-2659 evidence summary

Comparison of deterministic report-outcome reading (rule `report-outcome/1`; the implementation was removed before integration and survives only in this branch's history) with the production reference checker, recorded Jev answers and independent labels, for ADR 0065 option A. Rows are mission/checkpoint/position references in the operator database; no report text is committed. [Raw disagreements](disagreements.json).

## Protocol

- Axes scored separately: reference validity (`findUnverifiableGoalCheckRow` accepts an artifact), report meaning (what the text literally says), verified execution. Execution is not established for any row: no report text proves a command ran, passed on the reviewed revision or satisfied a requirement.
- Population: 13,707 historical Goal Check rows in 634 missions, minus the 34 families TASK-2650 used. Mission families split by task number: even families developed the rule (6,437 rows, 243 families), odd families (6,284 rows, 244 families) were evaluated only after the rule file was frozen in commit `902895539a`. Review then found that negated structured success ("did not exit 0", "No tests passed: 12") read as favorable; `report-outcome/2` guards it. Replaying all 12,721 development and fresh rows and the 35 recorded packets gave identical readings, so the validation below applies unchanged to version 2.
- Labels: the implementing agent labelled every sampled row by reading it, before applying the rule to the fresh sample (S success, F failure, D deferral, M missing outcome, A mixed, N no check outcome expected, E expected failure). Labels are one reader's judgement, not human adjudication.
- Fresh sample (276 rows, seed fixed before drawing): every failure/deferral/mixed/quoted/weak reading, 25 of each success and missing-outcome reading, 40 keyword-bearing and 30 other silent rows. Rates below are over this stratified sample, not population prevalence; population counts come from the full replay.
- Jev provider is `setup-required` here (no API key in the implementing terminal; the operator has Jev configured elsewhere), so no new Jev request was possible. Jev is compared on the 35 recorded TASK-2650 reporting packets, which include the four archived production packets; they were not used to develop the rule.

## Fresh validation (frozen rules, 6,284 rows)

| Reading | Population rows | Sampled | Appropriate | False warning / favorable |
|---|---|---|---|---|
| reported_deferral | 5 | 5 | 5 deferral | 0 |
| reported_failure | 6 | 6 | 2 failure (one exit code), 3 mixed outcomes | 1 (test name) |
| missing_outcome | 337 | 25 | 16 missing, 1 deferral | 8 (4 reported outcome in prose, 4 behaviour claims) |
| reported_success | 498 | 75 | 59 | 1 false favorable (mixed outcome); 15 unsupported (behaviour claim, not a check result) |
| ambiguous (quoted, weak, mixed) | 96 | 95 | 15 silently missed (F/D/M) | none favorable |

Silently missed problems: 15 of 39 sampled F/D/M-labelled rows were left to ordinary checks (mostly prose such as "Gates run in CP-5", "Pending", "Not done"). Absent failure words never produced a favorable reading. Population check cost: 43 ms for 6,284 rows (about 0.007 ms/row), extraction 46 ms.

## Recorded packets: rule, reference checker, Jev (35)

| Check | Matches label | Notes |
|---|---|---|
| Reference checker | 13 of 35 | accepts 34, rejects one; validates a reference, not meaning |
| Frozen rule | 29 of 35 | 1 false favorable (`./scripts/verify-local.sh workflow` reported for a criterion naming `all`), 1 false warning, 4 abstentions (e.g. "Gates run in CP-5") |
| Recorded Jev | 35 of 35 | purposive packets; question text was refined on the development half |

Measured time over the 35 packets: rule 8.6 ms, reference checker 527 ms, Jev 10,023 ms recorded round trips and USD 0.00076. Jev adds what the rule cannot see: scope mismatch between criterion and reported command, and indirect deferral wording. These are four contrast-selected packets, and no fresh Jev run was possible, so incremental value on fresh rows is not demonstrated.

## Decision

No rule is implemented. Deferral and failure readings were mostly appropriate on small samples (5 of 5, 5 of 6), but missing-outcome precision was 17 of 25, 15 of 39 sampled failure/deferral/missing rows were missed, mixed/quoted/weak readings could not warn, and success readings must stay unverified. The advisory notes gate nothing and no end-to-end saving was shown, so the path, persistence and statistics were dropped. Jev report-content feedback is the next test.
