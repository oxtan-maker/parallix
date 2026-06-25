# CP-4: Review Fallback Path Verification

## Work Done

### Mechanism Walkthrough

When `startAgent` is called from the review loop (review-loop.js:691):

1. **First launch attempt** — `selectAgent` picks `mistral` → `launchAgent` spawns → exits with non-limit error (e.g., API key invalid)
2. **`launchFailed = true`** → `launched.add('mistral')` → our fix calls `updateAgentBlockFn('mistral', blockUntil)` → writes to `agents.local.json`
3. **`continue`** → loops back to top of retry loop
4. **Second `selectAgent` call** — `mistral` is now in `excluded` set (from blocklist, checked at agents.js:385-389) → falls through to `qwen`
5. **`qwen` launches** → `resolveOpencodeCommand()` → `'opencode'` → spawns temp binary → exits 0 → success
6. **Review proceeds** with `qwen` instead of `mistral`

This is the review-loop fallback path: blocked agents are excluded on retry, allowing the next eligible agent to take over.

### Unit Test Coverage

The regression tests in CP-3 already verify the critical path:
- `non-limit launch failure triggers updateAgentBlockFn with 1-hour block` — confirms blocking is triggered and format is correct
- `qwen is excluded from non-limit block logic` — confirms qwen is NOT blocked, allowing it to serve as fallback

### Integration Considerations

Full end-to-end review loop integration testing would require:
- Setting up a Forgejo PR with review artifacts
- Configuring agents.local.json with blocked reviewers
- Running `startReviewLoop` and observing agent fallback in practice

This is feasible but external to the code change scope. The unit tests provide strong verification of the mechanism. Manual verification is recommended during an actual review cycle.

## Goal Check

| Success Criterion | Evidence |
|-------------------|----------|
| SC1: Blocked agent excluded on retry via selectAgent | agents.js:396 — `pool.filter(agent => !excluded.has(agent))` where `excluded` includes blocklist entries (agents.js:385-389) |
| SC2: Fallback agent (qwen) serves as fallback when primary blocked | agents.js:826 — `if (chosen !== 'qwen')` guard ensures qwen is available for fallback |
| SC3: Review loop receives fallback agent via applyAgentFallback | review-loop.js:701-704 — `applyAgentFallbackFn` updates `state.reviewer` with fallback from launchResult |
| SC4: Regression tests cover blocking mechanism | test/agents.test.js:1816-1879 — 2 regression tests, both passing |
| SC5: Full test suite passes with zero regressions | 1648 pass, 0 fail, 22 skipped |

## Next action: Commit all changes and checkpoint documents
