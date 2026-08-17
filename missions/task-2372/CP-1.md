# CP-1: Retarget the four stale test references

## Summary

Retargeted every live reference to the inactive duplicate module before deleting
anything, keeping all assertion logic byte-identical:

- `test/task-2203-publish-proof-refresh-order.test.ts` — the `path.join(...)` source
  path now reads `src/adapters/cli/commands/integrate.ts`. The `indexOf`
  ordering assertion (`runPostIntegrateHookOrAbort` before `captureVerifiedTreeProof`)
  is unchanged.
- `test/forgejo-independence.test.ts` — both `fs.readFileSync(path.join(ADAPTERS, 'cli',
  'commands', ...))` reads now target `integrate.ts`. Only the assertion *message*
  string changed from `integrate-command.ts should gate…` to `integrate.ts should gate…`;
  the `assert.ok(src.includes('isForgejoReviewEnabled'))` condition and the
  `src.slice(src.indexOf('function printIntegrationPreflight'))` slice are unchanged.
- `test/task-2204-integrate-no-variant-a.test.ts` and `test/task-2242-backlog-drift.test.ts` —
  removed the dead `mockModule<typeof import('../src/adapters/cli/commands/integrate-command.js')>`
  registration. Neither file referenced the returned facade; `test/lib/module-mock.ts`
  states "Only declare modules you actually patch." Their live
  `integrate.js` registrations are untouched.

No `src/` file was touched in this checkpoint.

### Test command

```
FORCE_COLOR=0 node --import tsx --import ./test/bootstrap-parallix-home.ts \
  --experimental-test-module-mocks --test-force-exit --test-timeout=30000 --test \
  test/task-2203-publish-proof-refresh-order.test.ts test/forgejo-independence.test.ts \
  test/task-2204-integrate-no-variant-a.test.ts test/task-2242-backlog-drift.test.ts
```

(flags mirror `test/lib/test-run-plan.ts`; the aggregate gate remains
`./scripts/verify-local.sh all` at CP 3.)

Result **before** retarget: `tests 35 / pass 35 / fail 0`.
Result **after** retarget: `tests 35 / pass 35 / fail 0`.
Identical counts prove the retarget preserved the invariants rather than changing
what is asserted.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4 (source-reading tests retargeted, assertions unchanged) | `test/task-2203-publish-proof-refresh-order.test.ts` test `Variant B: post-integrate hook runs before proof capture (task-2203 fix)` and `test/forgejo-independence.test.ts` tests `integrate gates syncMerged behind isForgejoReviewEnabled` and `integrate printIntegrationPreflight gates Forgejo checks` all read `src/adapters/cli/commands/integrate.ts` and pass (`✔` in the run above) | Done |
| SC4 (dead `mockModule` registrations removed) | `git grep -nE "integrate-command\.(ts\|js)" -- test/task-2204-integrate-no-variant-a.test.ts test/task-2242-backlog-drift.test.ts` returns nothing; both files still register `../src/adapters/cli/commands/integrate.js` and pass in the run above | Done |
| Retarget preserves invariants (CP 1 requirement: pass before **and** after) | Same command, same four test paths: `pass 35 / fail 0` at parent `c51cc7d70f000b1d18342a44eee4d437ef64f390` and `pass 35 / fail 0` after the edits | Done |
| Stop rule 2 (retargeted ordering test must not be weakened) | `Variant B: post-integrate hook runs before proof capture (task-2203 fix)` passes against `integrate.ts` with its original `indexOf` comparison; no assertion was relaxed | Not triggered |
| SC7 (no `src/` change yet) | `git status --short` shows only the four `test/` files (plus pre-existing `package-lock.json`); no path under `src/` is modified | On track |

Next action: CP 2 — delete `src/adapters/cli/commands/integrate-command.ts` and rerun the four retargeted files plus `test/task-2369-regressions.test.ts` (R1–R4) and `test/integrate.test.ts`.
