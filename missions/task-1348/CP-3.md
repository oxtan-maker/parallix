# CP-3: Regression Tests & Verification

## Work Done

### 1. Fixed test isolation bug in `test/agents.test.js:1725`

Added overrides to prevent stale global blocklist from affecting test:
```javascript
isAgentBlockedFn: () => false,
updateAgentBlockFn: () => ({})
```

Without these, global `agents.local.json` entries (mistral, codex blocked until 20:00) caused `selectAgent` to throw "All eligible agents exhausted" prematurely.

### 2. Fixed regression test agent selection

Changed regression tests to use `mistral`/`qwen` instead of `codex`:
- `codex` resolves to system binary via `resolveCodexCommand()` → returns `'codex'`
- `withPathLaunchers` creates temp binaries named `opencode` and `vibe`
- System `codex` NOT in temp PATH → spawn errors
- `mistral` resolves to `vibe` (temp PATH binary) ✓
- `qwen` resolves to `opencode` (temp PATH binary) ✓

### 3. Added 2 regression tests (agents.test.js:1816-1879)

**Test 1:** `non-limit launch failure triggers updateAgentBlockFn with 1-hour block`
- Verifies `updateAgentBlockFn` called exactly once for failed non-qwen agent
- Validates block `until` format matches `YYYY-MM-DD HH`
- Uses `mistral` agent (resolved to temp `vibe` binary)

**Test 2:** `qwen is excluded from non-limit block logic`
- Verifies `qwen` NOT in block calls when it fails
- Verifies `mistral` IS blocked as expected
- Uses `qwen` as primary agent (excluded), `mistral` as fallback (blocked)

### 4. Test Suite Results

```
1648 pass, 0 fail, 22 skipped
```

Full suite passes with zero regressions.

## Goal Check

| Success Criterion | Evidence |
|-------------------|----------|
| SC1: Zero regressions in existing test suite | 1648 pass, 0 fail, 22 skipped |
| SC2: Regression test for non-limit block behavior added | `test/agents.test.js:1816` — "non-limit launch failure triggers updateAgentBlockFn with 1-hour block" |
| SC3: Regression test for qwen exclusion added | `test/agents.test.js:1847` — "qwen is excluded from non-limit block logic" |
| SC4: Test isolation verified — global blocklist does not affect tests | `test/agents.test.js:1725` — `isAgentBlockedFn: () => false` override |

## Next action: Verify review fallback path works when all reviewers blocked (manual/integration testing)
