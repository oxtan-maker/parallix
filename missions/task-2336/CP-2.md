# CP-2 — Fix the derivation

## Summary

Rewrote `resolveKnownAgentFamilies` (`src/interfaces/tui/agent-config-resolver.ts`) so the
board's family list is derived from the config as shipped:

- an explicit top-level `families` array wins when present (`declaredFamilies`,
  `src/interfaces/tui/agent-config-resolver.ts:34`);
- otherwise the de-duplicated, sorted union of every `steps.<step>.eligible` entry
  (`eligibleUnion`, `src/interfaces/tui/agent-config-resolver.ts:40`);
- every candidate passes through `agentFamily()` validation and invalid entries are
  dropped instead of blind-cast (`validFamilies`, `src/interfaces/tui/agent-config-resolver.ts:53`);
- missing file, unparsable JSON, and a config with neither key all return `[]` without
  throwing (`src/interfaces/tui/agent-config-resolver.ts:25`).

`config/agents.json` was not modified — the fix works against the shipped `steps`-only
shape, as the mission's Restricted Areas require. No parsing moved into `src/domain/` or
`src/application/`, so ADR 0051 still holds.

Added `test/agent-config-resolver.test.ts` covering Success Criteria 2–4, and CP 1's
reproduction test is now green.

Verification run: `npm test -- test/agent-config-resolver.test.ts test/task-2336-repro.test.ts test/persistence-characterization.test.ts`
→ `tests 35 / pass 35 / fail 0`. `npm run typecheck` exits 0 and
`npx eslint src/interfaces/tui/agent-config-resolver.ts test/agent-config-resolver.test.ts test/task-2336-repro.test.ts`
reports clean.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — repro test now passes on the fixed tree | `test/task-2336-repro.test.ts`, `"resolveKnownAgentFamilies returns the steps.*.eligible union for the shipped config"` and `"AgentStrip does not render \"agents: unavailable\" for the shipped config families"` both `✔` under `npm test -- test/task-2336-repro.test.ts` | PASS |
| SC2 — explicit `families` wins when declared | `"resolveKnownAgentFamilies returns the explicit families array when the config declares one"`, `src/interfaces/tui/agent-config-resolver.ts:29` | PASS |
| SC2 — sorted `steps.*.eligible` union otherwise | `"resolveKnownAgentFamilies falls back to the sorted union of steps.*.eligible"`, `src/interfaces/tui/agent-config-resolver.ts:30` | PASS |
| SC3 — missing `config/agents.json` returns `[]`, no throw | `"resolveKnownAgentFamilies returns an empty list when config/agents.json is missing"`, `src/interfaces/tui/agent-config-resolver.ts:25` | PASS |
| SC3 — non-JSON contents return `[]`, no throw | `"resolveKnownAgentFamilies returns an empty list for non-JSON config contents"` in `test/agent-config-resolver.test.ts` | PASS |
| SC3 — config with neither `families` nor `steps` returns `[]` | `"resolveKnownAgentFamilies returns an empty list when the config has neither families nor steps"`, `src/interfaces/tui/agent-config-resolver.ts:42` | PASS |
| SC4 — values failing `agentFamily()` are dropped | `"resolveKnownAgentFamilies drops entries that fail agentFamily() validation"` (asserts `"Claude Opus"`, `""`, `42`, `null`, `"-bad"` are dropped), `src/interfaces/tui/agent-config-resolver.ts:53` | PASS |
| Malformed step entries do not break the union | `"resolveKnownAgentFamilies ignores steps whose eligible field is missing or not an array"`, `src/interfaces/tui/agent-config-resolver.ts:46` | PASS |
| Existing resolver characterization still passes | `test/persistence-characterization.test.ts`, `"SC3: TUI resolveKnownAgentFamilies reads config/agents.json and returns family list"` `✔` | PASS |
| Shipped config unchanged (Restricted Areas) | `config/agents.json` has no `families` key; pinned by `"shipped config/agents.json declares no top-level families key"` in `test/task-2336-repro.test.ts` | PASS |
| DoD #2 — lint/static analysis clean on changed files | `npm run typecheck` exit 0; `npx eslint src/interfaces/tui/agent-config-resolver.ts test/agent-config-resolver.test.ts test/task-2336-repro.test.ts` clean | PASS |

Next action: add the block `reason` to the `AgentStrip` entry in `src/interfaces/tui/agent-strip.tsx` and write the rendering/projection tests for Success Criteria 5–9 (CP 3).
