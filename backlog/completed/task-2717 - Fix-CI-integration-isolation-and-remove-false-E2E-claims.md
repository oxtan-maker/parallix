---
id: TASK-2717
title: Fix CI integration isolation and remove false E2E claims
status: done
assignee: [codex]
created_date: '2026-10-10 14:15'
labels:
  - bug
  - testing
  - ci
dependencies: []
priority: high
ordinal: 218008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GitHub CI fails in the former web-create-draft-start-e2e.test.ts (now test/integration/presentation/web-create-draft-start-contract.test.ts) (draft confinement rejection for custom with Bubblewrap unavailable) and pre-review-launcher-configuration.test.ts (shared-conflict diagnostic after fake implementer already resolved the rebase).

Investigate and fix the actual causes with focused reproductions. The workflow sets PARALLIX_NO_BUBBLEWRAP=1, which disables Bubblewrap but does not authorize unsandboxed mutation. The web fixture supplies a fake draft launcher yet reaches production confinement; trace all launch paths rather than assume the override covers them. Preserve production confinement.

The rebase fixture selects Forgejo and runs pre-review rebase with --push without isolating publication. Its assertions show launch, clean tree, finished rebase and resolved content before the diagnostic assertion fails. A missing Forgejo token is a suspected GitHub trigger, not yet confirmed from full runner logs. The wrapper retains historical conflict classification and may label a later publication failure as unresolved conflicts. A local focused run passed but attempted localhost Forgejo publication, proving a leaked external dependency.

Audit ALL tests under test/integration for filenames, suite/case names and comments claiming E2E or end-to-end coverage. Rename every such integration test around its actual integration contract and correct overstated claims. Inspect execution and dependency boundaries, not just names: tests remaining in integration must prove bounded adapter/component integration with controlled external boundaries. Genuine complete-user-journey or real-agent tests belong under test/e2e with the appropriate explicit lane; split mixed responsibilities if necessary. Preserve legitimate references to E2E commands/gates that an integration test tests as data.

Follow ADR 0057, existing owning suites, category registration, fixture cleanup and finite CPU budgets. Update discovery, registry, budget keys and executable references for renames. Do not weaken confinement, introduce ambient consent, skip failing checks, or claim mocked agents prove real-agent behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Both reported GitHub CI failures have focused reproductions retained in their owning suites, red on parent behavior and green with the fix; distinguish confirmed causes from hypotheses using runner output or controlled reproduction.
- [ ] #2 Draft integration uses an effective isolated launch boundary for every exercised launch path and passes with PARALLIX_NO_BUBBLEWRAP=1 without real agents, model access, operator state or weakened confinement.
- [ ] #3 Pre-review launcher integration isolates publication and credentials; a completed conflict resolution followed by a publication failure is classified with the actual failure, not stale resolved conflicts.
- [ ] #4 Every integration test claiming E2E coverage is audited and renamed to its integration contract, including filenames, suite/case names and misleading comments; legitimate references to tested E2E gates or command data remain accurate.
- [ ] #5 Tests remaining under test/integration are verified as bounded integration tests; genuine E2E behavior is moved or split into test/e2e and explicitly registered in the appropriate ADR 0057 execution lane.
- [ ] #6 All affected discovery, category registry, CPU-budget entries and executable references follow renamed/moved files; no coverage or regression checks silently disappear.
- [ ] #7 Run focused contract checks with GitHub-like no-Bubblewrap configuration and no operator credentials/services, plus static-analysis; manually exercise the repaired flow in disposable state and record evidence. Run docs verification if live docs change.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Implementation references

Retained draft isolation reproduction: `test/integration/presentation/web-create-draft-start-contract.test.ts`. Retained resolved-rebase publication and credential reproductions: `test/integration/rebase/pre-review-launcher-configuration.test.ts`. The free-text intake/activation CLI journey suite was removed under the authoritative round-2 human review correction to reduce test runtime; its lane registration and CPU-budget entries were removed as well. Bounded context-command coverage remains in `test/integration/cli/mission-context-cli-contract.test.ts`.
