# Checkpoint 1 — Failing help-grouping assertions

## Summary
Added three focused assertions to `test/index.test.ts` that encode the target
grouping **before** the formatter changes, so they fail red on the current flat
output and turn green only once `printUsage` is restructured.

- `printUsage orders Core Commands before Advanced Commands before Utility Commands` — asserts the three headings exist and appear in that order (`Core Commands:` < `Advanced Commands:` < `Utility Commands:`).
- `printUsage Core Commands contains exactly the seven lifecycle commands in order` — slices the output between the Core and Advanced headings and asserts the leading command token of each core line is exactly `[mission-start, draft, active, checkpoint, review, handoff, integrate]` in that lifecycle order.
- `printUsage documents every KNOWN_COMMANDS exactly once across all sections` — regression guard asserting each `KNOWN_COMMANDS` entry is the leading token of exactly one help line.

Verified red on the current tree: the two ordering/membership tests fail
(`Advanced Commands heading must be present`; core-section membership mismatch),
the exactly-once guard passes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Three heading order (Core < Advanced < Utility) | `test/index.test.ts`, `printUsage orders Core Commands before Advanced Commands before Utility Commands` | FAIL (red, pre-fix) |
| Exact seven-command Core membership and order | `test/index.test.ts`, `printUsage Core Commands contains exactly the seven lifecycle commands in order` | FAIL (red, pre-fix) |
| One-time presence of every documented command | `test/index.test.ts`, `printUsage documents every KNOWN_COMMANDS exactly once across all sections` | PASS (regression guard) |

Run to reproduce the red state:
`FORCE_COLOR=0 npx tsx --test --test-name-pattern="Core Commands|before Advanced" test/index.test.ts`

## Next action
CP 2: restructure only `printUsage` grouping/order in `src/interfaces/cli/runtime.ts`, update install-smoke expectations, and audit live docs for a verbatim help listing.
