# CP-8: Design fidelity — BLOCKED, reference design zip absent → follow-up

## Summary

Design fidelity (TASK-2437 #13/#14) requires auditing the web board against the
reference design `/tmp/Parallix Kanban Board Controller.zip`. That file is
absent from this worktree (verified: `ls /tmp/Parallix Kanban Board Controller.zip`
→ not present). Per the mission stop rule ("Stop before implementing if the
reference design zip is absent and the work would require inventing
requirements") and its explicit assumption ("if absent, treat design-fidelity
fixes as follow-ups rather than inventing requirements"), this checkpoint is
deferred rather than waived or invented.

Known-item check that needs no zip (TASK-2437 #14): the hallucinated extra
called out — "Parallels displayed twice, once for product name and once for repo
name" — is ABSENT in the current web board. `web/src/top-bar.tsx` renders the
product name `Parallix` plus the live `snapshot.repositoryId` (the actual
working-tree repo), not a duplicated `Parallels` token. `grep -rniE "parall[sx]|Parallels"
web/src/` finds only comment headers and the single top-bar product label.

Follow-up created: `backlog/tasks/task-2437.01 - design-fidelity-audit-vs-reference.md`
(blocks on TASK-2437; does not modify TASK-2437's metadata).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reference design zip present | `/tmp/Parallix Kanban Board Controller.zip` — ABSENT | BLOCKED |
| Called-out hallucinated extra (dup Parallels) absent | `web/src/top-bar.tsx` renders `Parallix` + live `repositoryId`; no `Parallels` duplicate | PASS |
| Follow-up created for remaining audit | `backlog/tasks/task-2437.01 - design-fidelity-audit-vs-reference.md` | PASS |

## Next action: commit CP-8, then CP-9 docs + TASK-2283 recheck + final integration gate.
