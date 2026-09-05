# CP-3: Schema, setup, `px config`, and configuration reference alignment

## Summary

Aligned every user-facing surface with the `backlog-md`-only task-provider
contract implemented in CP 2:

- `config/workflow.config.schema.json` constrains `adapters.tasks.provider` to
  `"enum": ["backlog-md"]` and says any other value is rejected.
- `src/adapters/review/setup-review.ts` no longer prompts for a free-text task
  provider in the custom-layout wizard path; `collectWizardAnswers`,
  `buildNonInteractiveAnswers`, and the standard-defaults path all produce
  `tasksProvider: 'backlog-md'`, so generated `workflow.config.json` files can
  only carry the supported value.
- `adapterChecklist()` in `src/adapters/config/product-config.ts` now points
  operators at `adapters.tasks.storage` / `adapters.tasks.stateMap` for layout
  overrides and states that `adapters.tasks.provider` only accepts `backlog-md`.
- `px config` needed no new code: `src/adapters/cli/commands/config.ts` already
  prints `validateWorkflowConfig` issues and exits non-zero, so the CP 2
  provider rule makes an unsupported provider a reported failure instead of an
  echoed effective value.
- `docs/config.md` documents the provider under `## Tasks`, includes it in the
  tasks example, drops `adapters.tasks.provider` from "Known configuration
  gaps", and records it as a validated field in the remaining validation gap.
- `test/setup-review.test.ts` no longer asserts that setup can emit a
  `forgejo-tasks` provider; the custom-layout wizard test now pins
  `backlog-md`.

## Gate result

`./scripts/verify-local.sh all` passes: `tests 2383 / pass 2383 / fail 0`,
exit code 0. `./scripts/verify-local.sh static-analysis` reports
`=== Static Analysis Gate: ALL STAGES PASSED ===` and
`./scripts/verify-local.sh docs` reports `PASS: authored documentation contains
no volatile implementation evidence and relative links resolve`.

Three tests were red before this repair and were also red at the mission parent
commit `763db33a4` and on `main`. Each was a stale test assertion, not a
production defect, so the repair updated the test to the behavior production
already implements — no production code was changed to green them:

- `BoardProjectionBuilder queues a gate-failed mission behind its runnable resume`
  (`test/board-readers.test.ts`) expected the `active` command label `resume`.
  `src/application/projections/mission-board.ts` labels a gate-failed resume
  `resume ▸`, matching its sibling affordance labels `power ▸` and
  `findings ↩`. The expectation now reads `resume ▸`.
- `performStaticReview accepts a bare repo path whose file exists (may contain spaces)`
  (`test/review-static-evidence.test.ts`) built its fixture under a temp root
  but resolved evidence against the live checkout, so it depended on
  `backlog/tasks/task-2437.01 - design-fidelity-audit-vs-reference.md` still
  sitting in `backlog/tasks/`. That task has since completed and the file moved
  to `backlog/completed/`. The test now passes `rootDir` and `resolveWorktree`
  as its own fixture root, making it hermetic.
- `board unavailable action ignores pointer and keyboard activation`
  (`test/web-board-interaction.test.ts`) clicked a
  `button[aria-disabled="true"]` that no longer exists: a card with no runnable
  action omits its action control entirely, which is the behavior pinned by
  `"a card with no runnable action omits its disabled lifecycle controls"` in
  `test/web-board-render.test.ts`. The test now asserts that no action button
  is rendered and that activating the card dispatches no command.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `other` override fails validation and does not compose the backlog-Markdown adapter | Tests `"an unsupported adapters.tasks.provider is rejected by configuration validation"` and `"an unsupported adapters.tasks.provider stops the backlog-Markdown task file adapter"` in `test/task-2455.02-task-provider-config-repro.test.ts` | Done |
| `backlog-md` selects the backlog-Markdown adapter through provider selection | Test `"the supported adapters.tasks.provider selects the backlog-Markdown task adapter"`; `resolveTaskProvider` gates `resolveTaskStorage` in `src/adapters/config/product-config.ts` | Done |
| Named regression test red at parent, green after the fix | Red at `763db33a4` (recorded in `missions/task-2455.02/CP-1.md`); `npx tsx --test test/task-2455.02-task-provider-config-repro.test.ts` reports `pass 5 / fail 0` | Done |
| `config/workflow.config.schema.json` exposes only the supported value | `adapters.tasks.provider` declares `"enum": ["backlog-md"]` in `config/workflow.config.schema.json` | Done |
| Setup output exposes only the supported value | `src/adapters/review/setup-review.ts` sets `tasksProvider: 'backlog-md'` on every wizard path; test `"collectWizardAnswers supports custom layout and skipping bootstrap"` asserts `backlog-md` | Done |
| `px config` describes only supported provider behavior | `src/adapters/cli/commands/config.ts` reports `validateWorkflowConfig` issues and exits 1; `adapterChecklist()` in `src/adapters/config/product-config.ts` names `backlog-md` as the only accepted provider | Done |
| Configuration reference matches the contract | `docs/config.md` `## Tasks` section documents `backlog-md`; the `adapters.tasks.provider` entry is removed from `## Known configuration gaps`; `./scripts/verify-local.sh docs` passes | Done |
| `./scripts/verify-local.sh all` succeeds | `tests 2383 / pass 2383 / fail 0`, exit 0; `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh docs` also pass | Done |
| Stale tests repaired without patching production to green them | Test-only edits in `test/board-readers.test.ts`, `test/review-static-evidence.test.ts`, and `test/web-board-interaction.test.ts`; behavior pinned by `"a card with no runnable action omits its disabled lifecycle controls"` in `test/web-board-render.test.ts` and by `activeLabel` in `src/application/projections/mission-board.ts` | Done |

Next action: Hand off task-2455.02 for review with `./scripts/verify-local.sh all` green at `pass 2383 / fail 0`.
