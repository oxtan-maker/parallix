# CP-1: Mission aggregate and current-state model

## Summary

Rebuilt the domain model around the decisions Parallix makes rather than its
file formats. `Mission` is the aggregate root; checkpoint evidence and the
current review cycle belong to it. Checkpoints are explicitly replaceable when
a mission is redone. The lifecycle contains only persisted workflow statuses—
no `draft`, `shipped`, or `archived` states.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Pure domain boundary | `src/domain/mission.ts:1`, `test/domain-import-boundary.test.ts`, `"SC1: no src/domain file imports a forbidden infrastructure module"` | PASS |
| Mission aggregate models extensible labels, lifecycle, closure, assignment, checkpoints, review, and NEL | `src/domain/mission.ts:47`, `"mission labels preserve independent and extensible dimensions"` | PASS |
| Checkpoint evidence can be replaced after a redo | `src/domain/checkpoint.ts:38`, `"recording the same checkpoint replaces stale evidence after a redo"` | PASS |
| Lifecycle uses current persisted states and rejects unsupported jumps | `src/domain/mission.ts:20`, `src/domain/mission-workflow.ts:38`, `"mission lifecycle rejects unsupported jumps and missing handoff evidence"` | PASS |
| Integration retains a durable queue transition while application preflight may promote an approved review | `src/domain/mission-workflow.ts`, `"integration queue remains a required durable lifecycle transition"`, `src/platform/runtime/lib/commands/integrate.ts:1127` | PASS |
| Review rounds model reviewer decisions and implementer responses against exact revisions, with reviewer assignment constrained by configured eligibility | `src/domain/review.ts`, `"reviewer commands are approve or request-changes and approval may carry a comment"`, `"review assignment accepts only reviewers eligible in user configuration"`, `"implementer resolution accounts for every finding and opens a new revision round"` | PASS |
| Integration and closure are separate: done remains open until closeout records closure | `src/domain/mission.ts`, `"done remains open until closeout records closure"` | PASS |
| NEL is a replaceable mission attribute | `src/domain/mission.ts:65`, `"NEL is a replaceable mission attribute captured at handoff"` | PASS |
| Human intervention is one actionable state rather than separate parked/blocked phases | `src/domain/review.ts`, `"parked and blocked legacy dispositions collapse to human intervention"` | PASS |
| Session resume is scoped to mission, role, and agent | `src/domain/session.ts:20`, `"resume marker is scoped to mission, role, and extensible agent family"` | PASS |

Next action: Model authority, outcome measurements, and concrete board projections without storage-schema registries.
