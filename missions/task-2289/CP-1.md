# CP 1 — Approval, characterization, and contract matrix

## Summary

Confirmed the integrated ADR and recorded human architecture review, captured
the direct-handler characterization suite, and added the contract-to-ADR/test
matrix for the two selected slices. No CLI handler was changed or delegated.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR decision is integrated and its human-review prerequisite is recorded | ADR 0051; `missions/task-2278/CP-5.md:5` | PASS |
| Contract rules have a test mapping before production extraction | `missions/task-2289/contract-matrix.md:8` | PASS |
| Stats handler text, JSON, summary, and apply behavior are characterized | `test/stats-backfill.test.ts`; `"statsBackfill supports help, json output, summary output, and apply mode"` | PASS |
| Active handler stays direct with launch ordering and agent-exit coverage | `test/active.test.ts`; `"active() success path: preflight, launch, and handoff run in order"`; `"active() exits with agent status when execute agent returns non-zero"` | PASS |
| No handler delegation or workflow state change was introduced | `lib/commands/stats-backfill.ts:355`; `lib/commands/active.ts:205` | PASS |

Next action: define the application-owned outcomes, ports, and strict-fake service tests listed in `missions/task-2289/contract-matrix.md`.
