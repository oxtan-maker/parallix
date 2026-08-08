# CP-1 — Lock the bug

## Summary

Authored `test/task-2336-repro.test.ts` only; no `src/` file was touched in this checkpoint.

The test copies the repository's real `config/agents.json` (a `steps` map with `eligible`
arrays and no top-level `families` key) into a temp root and calls
`resolveKnownAgentFamilies(tempRoot)`. It asserts the result is non-empty and equals
`['claude', 'codex', 'custom', 'vibe']`, the sorted union of `steps.*.eligible`. A second
test renders `AgentStrip` with availability rows derived from that list and asserts the
frame does not contain `agents: unavailable`. A third test pins that the shipped config
still declares no top-level `families` key, so the derivation must keep working on the
config as shipped (mission Restricted Areas).

Baseline before any change: `./scripts/verify-local.sh all` exited 0 at the mission's
parent commit (`4c234193c`) with `tests 1713 / pass 1713 / fail 0`, so the mission's
"stop on baseline red" rule does not trigger.

Red evidence — `npm test -- test/task-2336-repro.test.ts` at the parent commit:

```
✖ resolveKnownAgentFamilies returns the steps.*.eligible union for the shipped config (2.326043ms)
  AssertionError [ERR_ASSERTION]: known agent families must not be empty for the shipped config. Got: []
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-2336/test/task-2336-repro.test.ts:39:12)

✖ AgentStrip does not render "agents: unavailable" for the shipped config families (545.009819ms)
  AssertionError [ERR_ASSERTION]: AgentStrip must not fall back to the unavailable placeholder. Got: agents: unavailable
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-2336/test/task-2336-repro.test.ts:71:12)
```

Cause confirmed at `src/interfaces/tui/agent-config-resolver.ts:19` — the resolver only
accepts `config.families` and returns `[]` for the shipped `steps`-only config, which makes
`AgentStrip` take the empty-state branch at `src/interfaces/tui/agent-strip.tsx:59`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — repro test exists and fails at the parent commit with an empty family list | `test/task-2336-repro.test.ts`, `"resolveKnownAgentFamilies returns the steps.*.eligible union for the shipped config"`; `npm test -- test/task-2336-repro.test.ts` prints `AssertionError [ERR_ASSERTION]: known agent families must not be empty for the shipped config. Got: []` | RED (expected at CP 1) |
| SC1 — repro asserts the exact `steps.*.eligible` union `['claude','codex','custom','vibe']` | `test/task-2336-repro.test.ts:43` (`assert.deepEqual`) against `config/agents.json` | RED (expected at CP 1) |
| CP 1 — strip fallback is part of the reproduction | `"AgentStrip does not render \"agents: unavailable\" for the shipped config families"`, failure line `Got: agents: unavailable`, source branch at `src/interfaces/tui/agent-strip.tsx:59` | RED (expected at CP 1) |
| Root cause located in the resolver read path | `src/interfaces/tui/agent-config-resolver.ts:19` (only `config?.families` is accepted) | PASS |
| No `src/` change in this checkpoint | `test/task-2336-repro.test.ts` is the only added file; `src/interfaces/tui/agent-config-resolver.ts` still returns `[]` at line 26 | PASS |
| Baseline gate green at the parent commit (mission stop rule) | `./scripts/verify-local.sh all` exit 0, `pass 1713 / fail 0` at commit `4c234193c` | PASS |

Next action: rewrite `resolveKnownAgentFamilies` in `src/interfaces/tui/agent-config-resolver.ts` for `families`-then-`steps.*.eligible` precedence with `agentFamily()` filtering, and add the resolver unit tests for Success Criteria 2–4 (CP 2).
