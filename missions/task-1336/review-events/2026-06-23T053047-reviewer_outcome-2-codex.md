---
event_type: reviewer_outcome
timestamp: 2026-06-23T05:30:47.768Z
round: 2
phase: reviewing
actor: codex
slug: task-1336
verdict: request-changes
---

# Review Outcome

Disposition: request-changes

The README rewrite meets most of the structural and tone requirements, and the final checkpoint document does contain a Goal Check table with concrete file/test citations. But the branch regresses the most important user-facing behavior: the landing page's two primary entry commands are wrong for this repository.

Required changes:

1. Fix the packaging/install instructions so they point at the actual package root and verify them against this checkout.
2. Fix the direct-from-checkout invocation so it names the real executable form instead of `node parallix <command>`.
3. Update the copied authority-reference text and the checkpoint evidence that currently mark the broken commands as a passed first-step proof.

Evidence:

- [README.md](/home/magnus/code/parallix-task-1336/README.md:11) and [README.md](/home/magnus/code/parallix-task-1336/README.md:59) document `npm pack ./parallix`, but `/home/magnus/code/parallix-task-1336/parallix/package.json` does not exist.
- [README.md](/home/magnus/code/parallix-task-1336/README.md:72) documents `node parallix <command>`, which fails with `MODULE_NOT_FOUND` in this checkout.
- The same incorrect entrypoint was copied into [docs/authority-reference.md](/home/magnus/code/parallix-task-1336/docs/authority-reference.md:17) and [docs/authority-reference.md](/home/magnus/code/parallix-task-1336/docs/authority-reference.md:278).
- CP evidence currently treats the broken opening commands as a successful SC-2 proof in [missions/task-1336/CP-2.md](/home/magnus/code/parallix-task-1336/missions/task-1336/CP-2.md:32) and [missions/task-1336/CP-4.md](/home/magnus/code/parallix-task-1336/missions/task-1336/CP-4.md:26).

---
`[workflow-round:2, workflow-phase:reviewing]`