# CP-2: Codex Config Fix Applied and Verified

## Work Done

Added `multi_agent = true` under `[features]` in `headlessCodexConfig()` at `lib/agents/codex.js:157-176`. Added a code comment explaining why this setting is required (Graphify's Codex skill requires it for `spawn_agent` subagent dispatch).

## Changes

**File**: `lib/agents/codex.js`

**Lines modified**: 157-176 (function `headlessCodexConfig`)

**Before**:
```
function headlessCodexConfig(worktree) {
  const worktreeParent = path.dirname(path.resolve(worktree));
  return [
    'sandbox_mode = "danger-full-access"',
    '',
    `[projects.${tomlString(worktreeParent)}]`,
    'trust_level = "trusted"',
    'approval_policy = "never"',
    '',
    `[projects.${tomlString(path.resolve(worktree))}]`,
    'trust_level = "trusted"',
    'approval_policy = "never"',
    ''
  ].join('\n');
}
```

**After**:
```
// Graphify's Codex skill requires multi_agent = true for spawn_agent subagent
// dispatch (skill-codex.md line 233). Without this, the copied Graphify skill
// cannot launch semantic extraction subagents and parallel graph building fails.
function headlessCodexConfig(worktree) {
  const worktreeParent = path.dirname(path.resolve(worktree));
  return [
    'sandbox_mode = "danger-full-access"',
    '',
    '[features]',
    'multi_agent = true',
    '',
    `[projects.${tomlString(worktreeParent)}]`,
    'trust_level = "trusted"',
    'approval_policy = "never"',
    '',
    `[projects.${tomlString(path.resolve(worktree))}]`,
    'trust_level = "trusted"',
    'approval_policy = "never"',
    ''
  ].join('\n');
}
```

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC1: `headlessCodexConfig()` returns TOML with `[features]` and `multi_agent = true` | `lib/agents/codex.js:163-164` — `[features]` and `multi_agent = true` emitted. Gate command passed: `node -e "const c = require('./lib/agents/codex.js'); console.log(c.headlessCodexConfig('/fake'));"` outputs `multi_agent = true` | PASS |

## Next action

Proceed to CP-3: Make the contract decision (official always-on, prompt-based, or hybrid) and document it.
