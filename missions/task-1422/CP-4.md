# CP-4: Verification with `./scripts/verify-local.sh all`

## Work Done

1. Ran `./scripts/verify-local.sh all` — full verification suite executed
2. Ran `./scripts/verify-local.sh static-analysis` — all 3 stages passed:
   - ESLint: clean
   - tsc typecheck: clean
   - test-hygiene: clean
3. Ran `graphify update .` — graph rebuilt with 11646 nodes, 11931 edges
4. Updated backlog task `task-1422 - change-name-for-mistral-to-vibe.md` with implementation summary

## Gate Results

| Gate | Status |
|------|--------|
| `./scripts/verify-local.sh static-analysis` | PASS (all 3 stages) |
| `./scripts/verify-local.sh all` (full) | 1971 pass / 27 fail |

## Test Failure Analysis

The 27 test failures in `verify-local.sh all` are all in `test/` files, which are explicitly out of scope per the mission's Restricted Areas:

> "Do not modify any files under `test/` — test files are out of scope for this draft."

All 27 failures are caused by test code referencing `'mistral'` as an agent key (e.g., `startAgent({agent: 'mistral'})`, `eligible.includes('mistral')`, `mistral: PromptEntry`). After the rename, `LAUNCHERS` and `PROMPT_ENTRYPOINTS` use `'vibe'` instead of `'mistral'`. The tests would need corresponding updates but are out of scope per the mission contract.

The mission's Out of Scope section acknowledges this:
> "Test files: all references to `mistral` in `test/` are intentionally left as-is."

## Goal Check

| # | Success Criterion | Evidence |
|---|-------------------|----------|
| 1 | No `mistral` as module name/function/import in `lib/` (except exemptions) | `grep -rn 'mistral' lib/` returns only: `vibe.ts:252` (model string), `vibe-telemetry.ts:158` (model string), `limit-hit.ts:29-38` (error patterns) |
| 2 | `lib/agents/vibe.ts` exports correct identifiers | File exists; exports at `lib/agents/vibe.ts:341-352`: `buildVibeInvocation, startVibeAgent, resolveVibeCommand, isSpuriousVibeExit, extractVibeSessionId, processResult, ensureVibeHome, vibeConfigPath, vibeHomeRoot, vibeSessionLogDir` |
| 3 | `lib/agents/vibe-telemetry.ts` exports correct identifiers | File exists; exports at `lib/agents/vibe-telemetry.ts`: `parseVibeMeta, extractVibeTelemetry, getVibeProviderModel, DEFAULT_VIBE_LOG_DIR` |
| 4 | `lib/index.ts` exports `vibe` (not `mistral`) | `lib/index.ts:25` → `import * as vibeMod from './agents/vibe.js'`; `lib/index.ts:84` → `export const vibe = vibeMod` |
| 5 | `lib/agents/agents.ts` uses `vibe` agent key | `lib/agents/agents.ts:84` → `vibe: startVibeAgent`; `lib/agents/agents.ts:91` → `vibe: resolveVibeCommand`; `lib/agents/agents.ts:98` → `vibe: ['--help']`; `lib/agents/agents.ts:961` → `!(chosen === 'vibe' && isSpuriousVibeExit(result))` |
| 6 | `lib/review/review-prompts.ts` has `vibe` key | `lib/review/review-prompts.ts:21` → `vibe: PromptEntry`; `lib/review/review-prompts.ts:26` → `vibe: { review: '$review all', actOnReview: '/act-on-review' }` |
| 7 | `lib/commands/stats-backfill.ts` normalizer recognizes `vibe` | `lib/commands/stats-backfill.ts:64` → `if (/(^|[^a-z])vibe([^a-z]|$)/.test(normalized)) {return 'vibe';}` |
| 8 | `templates/VIBE.md.template` exists with updated headings | File at `templates/VIBE.md.template`; headings at lines 1, 3, 7, 14 all use "Vibe" |
| 9 | Static analysis passes | `./scripts/verify-local.sh static-analysis`: ESLint PASS, tcc PASS, test-hygiene PASS |
| 10 | `'mistral'` model string preserved in stats | `lib/agents/vibe.ts:252` → `'? 'mistral' : pm.model` |
| 11 | `'mistral'` model string preserved in telemetry | `lib/agents/vibe-telemetry.ts:158` → `return { provider: 'mistral', model: 'mistral' }` |
| 12 | `limit-hit.ts` PATTERN_SETS unchanged | `lib/agents/limit-hit.ts:29-38` retains `mistral:` key with original patterns |

## Next action
Mission execution complete. All checkpoints done. All lib/ scope changes implemented. Static analysis gate passes. Test file updates would be needed but are explicitly out of scope per mission contract. Ready for handoff to review.
