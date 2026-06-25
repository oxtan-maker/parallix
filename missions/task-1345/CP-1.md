# CP-1: Confirm Worktree Propagation

## Work Done

Verified the `_captureExport` call site and `captureOpencodeExport` signature:

### Call site (`lib/agents/opencode.js:262`)
```js
const exportJson = await _captureExport(result.sessionId, { worktree, env });
```
**Finding: `worktree` IS passed.** The mission doc claimed "currently `worktree` is NOT passed in `opencode.js:262`" — this was incorrect. The variable `worktree` flows from `startOpencodeAgent` → `processResult` → `_captureExport`.

### Function signature (`lib/agents/opencode-export.js:30-37`)
```js
function captureOpencodeExport(sessionId, opts = {}) {
  const { worktree, env, timeoutMs = 30000, maxBytes = 32 * 1024 * 1024, spawn = childProcess.spawn } = opts;
```
**Finding: `worktree` IS accepted** and used as `cwd` at line 64:
```js
child = spawn('opencode', ['export', sessionId], {
  cwd: worktree,
  env: { ...process.env, ...(env || {}) },
  stdio: ['ignore', 'pipe', 'ignore'],
});
```

## Next action: Reproduce truncation with controlled test comparing stdio configurations
