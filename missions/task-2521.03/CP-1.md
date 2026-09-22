# CP-1: Re-draft and typed Mission writes

## Summary

The previous read-only Mission was superseded. This checkpoint records the
active pivot: the new Mission owns both agent reads and writes. The implemented
`px mission <area> <action>` surface enumerates context, checkpoint,
assignment, dependency, review, and lifecycle domain operations. Every write
requires the version returned by `px context <slug> --json`; JSON is accepted
through `--data` or `--data-stdin`.

The mutation-parity audit is represented as executable test data rather than a
durable inventory document. Task-source writes remain an external-provider
contract for Mission 4; they are not folded into the Mission aggregate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Re-draft replaces the obsolete seven-criterion, read-only scope | `missions/task-2521.03/MISSION.md` | PASS |
| Typed context/checkpoint/assignment/dependency/review operations exist; no generic patch or SQL command was added | `src/interfaces/cli/mission-operations.ts` | PASS |
| Every implemented Mission write requires optimistic-concurrency input | `MISSION_OPERATIONS_HELP`, `test/task-2521-03-context-cli.integration.test.ts` | PASS |
| Mutation-parity mapping gives each discovered legacy write a bounded owner | `test/task-2521-03-mutation-parity.test.ts` | PASS |
| Missing version fails before mutation | `"every Mission write requires --expected-version"` (`test/task-2521-03-context-cli.integration.test.ts`) | PASS |

Next action: complete lifecycle-negative coverage and consumer migration before
treating the pivot as ready for prompt migration.
