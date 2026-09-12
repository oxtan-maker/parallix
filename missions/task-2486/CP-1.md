# Checkpoint 1 — Claim inventory and dependency evidence

## Work Summary

Inspected the README against the runtime authorities before changing its framing.

| README guarantee | Required adjacent qualification | Runtime evidence |
|---|---|---|
| Separate review prefers a different family and blocks provider self-approval | A different reviewer is guaranteed only when an eligible different family is available; the sole eligible implementer family is the recorded exception. | `src/domain/review.ts`; test `startReview allows self-review only when the implementer is the sole eligible family` |
| Repository verification checks delivery | A repository gate applies where the repository configures one; an undeclared gate is a documented no-op. | `README.md`; `workflow.config.json` |
| Bubblewrap confines agent processes | Confinement is Linux-only and applies when Bubblewrap is available; otherwise the process runs unsandboxed with an explicit warning. | `src/adapters/process/bubblewrap.ts`; test `isBubblewrapAvailable warns once that the agent runs unsandboxed` |
| Forgejo provides a review surface | Forgejo is optional; the branch/worktree workflow operates when it is disabled. | `src/adapters/review/setup-review.ts`; test `evaluateReviewSetup reports not-required without configured review settings and passes when setup is complete` |
| Human owns the squash merge | Nothing merges autonomously; the operator decides whether to integrate. | `README.md`; `px integrate --help` |
| Internal measurement records agent-family telemetry | The figure is internal measurement, not external evidence or a universal result. | `README.md`; `docs/readme-rewrite-benchmark.md` |

TASK-2484 is an ancestor of this branch and its npm metadata verification is present. TASK-2485 is not merged; its committed CP-3 records that the single-family rehearsal was blocked before review and integration. That outcome confirms the rewrite must retain the reviewer-availability condition rather than promote it to a default-path guarantee.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Claim inventory maps review, verification, confinement, Forgejo, merge, and measurement claims to qualifications and authorities | `missions/task-2486/CP-1.md`, `src/domain/review.ts`, `src/adapters/process/bubblewrap.ts`, `src/adapters/review/setup-review.ts` | PASS |
| README and npm description can lead with the trust ladder | `README.md`, `package.json` | PENDING CP-2 |
| Review, Bubblewrap, Forgejo, and configured-gate conditions remain attached to their claims | `README.md`, test `isBubblewrapAvailable warns once that the agent runs unsandboxed` | PENDING CP-2 |
| Inaccurate or uncaveated claims are qualified or removed | `missions/task-2486/CP-1.md`, `README.md` | PENDING CP-2 |
| README statements remain mutually consistent | `README.md` | PENDING CP-3 |
| Forgejo bootstrap is optional in README and setup help | `README.md`, `src/interfaces/cli/runtime.ts`, `src/adapters/review/setup-review.ts` | PENDING CP-2 |
| Lifecycle diagram retains its reviewer-availability qualification | `README.md`, `src/domain/review.ts` | PENDING CP-2 |
| Measurement remains labelled internal rather than external evidence | `README.md`, `docs/readme-rewrite-benchmark.md` | PENDING CP-3 |
| README standard remains satisfied | `docs/doc-standards.md`, `README.md` | PENDING CP-3 |
| Documentation and general verification pass on the final tree | `./scripts/verify-docs.mjs`, `./scripts/verify-local.sh all` | PENDING CP-3 |

Next action: Rewrite only the opening, lifecycle adjacency, Forgejo setup framing, npm description, and `px setup` summary against this inventory.
