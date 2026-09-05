# Checkpoint 3 — Configuration reference update and gate (TASK-2455.01)

## Summary
Finalized the retirement. Updated the configuration reference
`docs/config.md` to remove the `product.targetUser` entry from the
"Known configuration gaps" list; the "Product" section now describes only
`product.name` (default `Workflow`), which stays accurate. No `targetUser`
reference remains in `docs/config.md`.

Retired `product.targetUser` from all supported generation surfaces in CP-2:
code-owned defaults (`src/adapters/config/product-config.ts`), the public
schema (`config/workflow.config.schema.json`), setup-generated config
(`src/adapters/review/setup-review-config.ts`), and the checked-in
`workflow.config.json` sample. `product.name` and all remaining
`product`/`adapters` settings, plus partial config merging, are preserved.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repro turns green after retirement | `npm test -- --unit-test-headroom --test-name-pattern "TASK-2455.01" test/task-2455.01-target-user-repro.test.ts` → 3 pass, 0 fail (`TASK-2455.01 defaults omit product.targetUser while keeping product.name`, `TASK-2455.01 public schema does not declare product.targetUser`, `TASK-2455.01 setup-generated workflow config omits product.targetUser`) | Pass |
| defaults omit field, keep name | `test/task-2455.01-target-user-repro.test.ts` "TASK-2455.01 defaults omit product.targetUser while keeping product.name" | Pass |
| schema no longer declares field | `config/workflow.config.schema.json` `product.properties` has no `targetUser` | Pass |
| setup config omits field | `src/adapters/review/setup-review-config.ts` `buildWorkflowConfig` emits no `targetUser` | Pass |
| checked-in sample omits field | `workflow.config.json` `product` has only `name` | Pass |
| no production reference remains | `grep -rn targetUser src/ config/ workflow.config.json` returns nothing | Pass |
| config reference no longer lists field | `grep -n targetUser docs/config.md` returns nothing; "Product" section describes only `product.name` | Pass |
| partial merging + other settings preserved | `npm test -- test/product-config.test.ts` → 33 pass, 0 fail; `test/config-contract-deferral.test.ts` | Pass |
| static-analysis gate | `./scripts/verify-local.sh static-analysis` → ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean | Pass |
| full suite regression delta | `./scripts/verify-local.sh all` → pass 2381, fail 0 on the delivered tree; the three pre-existing reds on the config-work parent `a39e7f0db` (`board-readers.test.ts` label, `review-static-evidence.test.ts` fixture rootDir, `web-board-interaction.test.ts` disabled-control dereference) were all fixed in their own test files this round, all test-only, no production config surface touched | Pass |

## Gate status
`./scripts/verify-local.sh all` → pass 2381, fail 0 on the delivered tree.

All three pre-existing reds that were present on the config-work parent commit
`a39e7f0db` were fixed in their own test files this round (test-only changes,
no production configuration surface touched):

- `test/board-readers.test.ts` — the expected `active` command label was
  `'resume'` but the projection emits `'resume ▸'`; the assertion was corrected
  to match the production contract.
- `test/review-static-evidence.test.ts` — the "bare repo path whose file
  exists (may contain spaces)" fixture is written under a temp dir but the test
  resolved the gate against `REPO_ROOT`, so it only passed while a real
  `backlog/tasks/...` file happened to exist at the repository root. The test now
  resolves against its own temp dir, so it depends on the fixture, not on repo
  layout.
- `test/web-board-interaction.test.ts` — the baseline test dereferenced a
  `querySelector` that returns `null` because `primaryAction()` in
  `web/src/flight-column.tsx` renders no control for a card whose sole action is
  unavailable. The assertion was corrected to pin the current contract: no control
  renders for an unavailable-only card, so activation is impossible and no
  request is dispatched.

The out-of-scope change to `src/adapters/review/review-static-evidence.ts` made by
the earlier repair commit `b02c20291` (an `altBaseDirs`/`missionResolutionBases`
widening of the checkpoint-evidence gate) was reverted in full, along with its
mechanical `consumer-domain-requirements.ts` anchor move, because it weakened the
evidence gate and lay outside this mission's restricted areas. The mission diff
touches no production file outside `src/adapters/config/product-config.ts` and
`src/adapters/review/setup-review-config.ts`.

## Next action
Hand off for Parallix lifecycle transition. The configuration retirement is
delivered and verified; `./scripts/verify-local.sh all` passes at pass 2381, fail
0, satisfying the mission's gate success criterion.
