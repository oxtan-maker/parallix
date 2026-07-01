# CP-1: Re-scope the mission to the real deliverable

## Summary

Replaced the hallucinated "just add an e2e test" interpretation with the actual task-1397 contract: product support for an integration-time gate, repo opt-in to that gate, a deterministic lifecycle suite that runs the real `draft -> active -> review -> integrate` path with only the agent stubbed, and documentation of the layered validation model.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mission covers gate support, repo adoption, and the first lifecycle suite instead of a test-only slice | `missions/task-1397/MISSION.md:5-10`, `missions/task-1397/MISSION.md:33-48` | PASS |
| Mission success criteria explicitly require repo-configured integrate-time gating and the deterministic lifecycle suite | `missions/task-1397/MISSION.md:62-72` | PASS |
| Mission checkpoints now match the intended implementation order | `missions/task-1397/MISSION.md:85-91` | PASS |
| Backlog task remains assigned to the current implementer and is already in review-stage ownership state | `backlog/tasks/task-1397 - retake-on-1358.md:4-6` | PASS |

Next action: Land the product seam for integration-time workflow gates with safe no-config behavior.
