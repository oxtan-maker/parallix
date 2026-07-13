# CP 3 — Documentation and verification

Documented the integration-branch ownership rule and completed final verification. Review repair removed the unrelated custom-capacity behavior change, aborts and reports a failed mission rebase, migrates integration promotion to the base worktree, and tests the real draft implementer transition path. The shared transition seam covers draft (`backlog`/`ready` plus implementer recording), active launch/rollback/fallback, handoff, review commands and review loop; integration completes state on its resolved base worktree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every production state-operation path is enumerated and uses shared integration-branch selection | `lib/tools/backlog.ts:584`, `lib/tools/backlog.ts:607`, `lib/commands/draft.ts:423`, `lib/commands/active.ts:180`, `lib/commands/handoff.ts:567`, `lib/review/review-loop.ts:362`, `lib/review/review-commands.ts:243`, `lib/commands/integrate.ts:727` | PASS |
| Each lifecycle transition updates main or the selected feature base, then rebases the mission branch or aborts a conflicted rebase | `lib/tools/backlog.ts:621`, `lib/tools/backlog.ts:630`, `"transitionTaskOnIntegrationBranch aborts a conflicted rebase after updating the integration branch"` | PASS |
| Automated coverage covers state routes, default main, selected feature branch, metadata, integration promotion, and ordering | `test/backlog.test.js`, `"recordDraftImplementer routes the actual implementer through the shared transition path"`, `"promoteTaskForIntegrationIfNeeded writes the integration checkout instead of the mission task copy"`, `test/active.test.js`, `test/handoff.test.js`, `test/review.test.js`, `test/e2e-mission-lifecycle.test.js` | PASS |
| Task metadata remains unchanged except for the requested state transition | `test/backlog.test.js`, `"transitionTaskOnIntegrationBranch writes main metadata first and rebases the mission worktree afterward"` | PASS |
| User-facing documentation states backlog branch ownership and post-update rebase | `docs/agents.md:226` | PASS |
| Required final verifier passes | `./scripts/verify-local.sh all` | PASS |

Next action: provide the tracked review-resolution artifacts for workflow consumption, then hand off the clean mission branch for review.
