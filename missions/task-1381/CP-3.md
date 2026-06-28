# CP-3: Guard integrate.js nextActionMessage emission

## Summary

Added `fs.existsSync(baseWorktree)` guards around all three `nextActionMessage` assignments in `lib/commands/integrate.js`. When the base worktree directory does not exist, the `Next: cd …` signal is not emitted, so the shell function never receives a missing-directory path to process.

Changes:
- `lib/commands/integrate.js:602-604` — Variant A closeout path (fast-path)
- `lib/commands/integrate.js:649-651` — Variant B resumed partial state path
- `lib/commands/integrate.js:776-778` — Variant B normal success path

Each guard wraps only the `nextActionMessage` assignment; `recordPostIntegrationStatsOrAbort` and all downstream logic remain unchanged.

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Variant A guard | `lib/commands/integrate.js:602-604` — `if (fs.existsSync(baseWorktree))` wraps `nextActionMessage = \`Next: cd ${baseWorktree}\`` |
| 2 | Variant B resumed guard | `lib/commands/integrate.js:649-651` — same guard pattern around `nextActionMessage` assignment |
| 3 | Variant B normal guard | `lib/commands/integrate.js:776-778` — same guard pattern around `nextActionMessage` assignment |
| 4 | Stats recording unaffected | `lib/commands/integrate.js:605`, `652`, `779` — `recordPostIntegrationStatsOrAbort` calls remain outside the `if` guard |
| 5 | No other integrate.js lines modified | Restricted areas preserved; only `nextActionMessage` emission points touched |

## Next action: Run `npm test` to verify all 1729+ tests pass including the new reproduction test (CP-4).
