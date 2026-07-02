# CP-1: Add tsx devDependency

## Summary

Added `tsx` (`^4.22.4`, matching the already-cached `node_modules/tsx@4.22.4`) as a `devDependency` in `package.json`. Verified `npx tsx --version` resolves and runs against the local Node 24 runtime.

## Goal Check

| Criterion | Evidence |
|---|---|
| `tsx` added to `devDependencies` | `package.json:64` — `"tsx": "^4.22.4",` |
| `npx tsx --version` works | Command output: `tsx v4.22.4` / `node v24.15.0` |

Next action: CP-2 — remove `pretest` from `package.json`, switch `test` script to `tsx --test`, and verify a single test file (`test/draft.test.ts` after rename) runs under `tsx`.
