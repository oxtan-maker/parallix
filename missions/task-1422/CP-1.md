# CP-1: Rename files and update all module imports/exports in lib/

## Work Done

1. Renamed `lib/agents/mistral.ts` → `lib/agents/vibe.ts`
2. Renamed `lib/agents/mistral-telemetry.ts` → `lib/agents/vibe-telemetry.ts`
3. Updated all exported identifiers in both files:
   - `parseMistralMeta` → `parseVibeMeta`
   - `extractMistralTelemetry` → `extractVibeTelemetry`
   - `getMistralProviderModel` → `getVibeProviderModel`
   - `DEFAULT_MISTRAL_LOG_DIR` → `DEFAULT_VIBE_LOG_DIR`
   - `buildMistralInvocation` → `buildVibeInvocation`
   - `extractMistralSessionId` → `extractVibeSessionId`
   - `resolveMistralCommand` → `resolveVibeCommand`
   - `startMistralAgent` → `startVibeAgent`
   - `isSpuriousMistralExit` → `isSpuriousVibeExit`
   - Type names: `MistralInvocationOptions` → `VibeInvocationOptions`, `StartMistralAgentOptions` → `StartVibeAgentOptions`
4. Updated all JSDoc comments and inline comments referencing "mistral" → "vibe"
5. Updated `lib/index.ts`: import and export renamed from `mistral` to `vibe`
6. Updated `lib/agents/agents.ts`: import, LAUNCHERS, RESOLVERS, HEALTH_PROBE_ARGS keys all changed from `mistral` to `vibe`
7. Preserved `'mistral'` model string in `vibe.ts:250` and `vibe-telemetry.ts:158` unchanged

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `lib/agents/vibe.ts` exists | File present at `lib/agents/vibe.ts` |
| 2 | `lib/agents/vibe-telemetry.ts` exists | File present at `lib/agents/vibe-telemetry.ts` |
| 3 | `lib/index.ts` exports `vibe` | `lib/index.ts:84` → `export const vibe = vibeMod;` |
| 4 | `lib/index.ts` imports from `./agents/vibe.js` | `lib/index.ts:25` → `import * as vibeMod from './agents/vibe.js';` |
| 5 | `lib/agents/agents.ts` uses `vibe` agent key | `lib/agents/agents.ts:84` → `vibe: startVibeAgent` |
| 6 | `lib/agents/agents.ts` imports from `./vibe.js` | `lib/agents/agents.ts:7` → `import { startVibeAgent, resolveVibeCommand, isSpuriousVibeExit } from './vibe.js';` |
| 7 | Exports correct identifiers | `lib/agents/vibe.ts:341-352` exports `buildVibeInvocation, startVibeAgent, resolveVibeCommand, isSpuriousVibeExit, extractVibeSessionId, processResult, ensureVibeHome, vibeConfigPath, vibeHomeRoot, vibeSessionLogDir` |
| 8 | Telemetry exports correct identifiers | `lib/agents/vibe-telemetry.ts` exports `parseVibeMeta, extractVibeTelemetry, getVibeProviderModel, DEFAULT_VIBE_LOG_DIR` |
| 9 | `'mistral'` model string preserved in stats | `lib/agents/vibe.ts:250` → `'? 'mistral' : pm.model` |
| 10 | `'mistral'` model string preserved in telemetry | `lib/agents/vibe-telemetry.ts:158` → `return { provider: 'mistral', model: 'mistral' }` |

## Next action
Execute CP-2: Update all functional references in agents.ts call sites, review-prompts.ts agent key, stats-backfill.ts normalizer, and limit-hit.ts key.
