# CP-2: Launcher modules converted to ESM/TypeScript

## Summary

Converted the 5 launcher modules in `lib/agents/` from CommonJS to ESM/TypeScript
via faithful `git mv` renames:

- `mistral.js` → `.ts` — `import { spawnAndTee } from '../core/spawn-tee.js'`, `MistralInvocationOptions`/`StartMistralAgentOptions` interfaces, typed callback param, `module.exports` → `export`.
- `claude.js` → `.ts` — converted-sibling/builtin `import`s (`spawn-tee`, `claude-telemetry`), `ClaudeInvocationOptions`/`StartClaudeAgentOptions` interfaces, `any`-typed injectable I/O + nested result/invocation params, `module.exports` → `export`.
- `codex.js` → `.ts` — `import … from 'node:fs'|'node:os'|'node:path'`, sibling imports (`spawn-tee`, `codex-telemetry`), `CodexInvocationOptions`/`StartCodexAgentOptions` interfaces, typed path/config helpers, `module.exports` → `export`.
- `opencode.js` → `.ts` — sibling imports (`spawn-tee`, `opencode-telemetry`, `opencode-export`, `limit-hit`), `BuildOpencodeInvocationOptions`/`StartOpencodeAgentOptions` interfaces, typed cache vars (`_jsonFormatSupported: boolean | null`), converted JSDoc casts to `as any`, `module.exports` → `export`.
- `stage-telemetry.js` → `.ts` — internal dep resolved via `import { codexHomeRoot, extractCodexTelemetry } from './codex.js'` (CP-2 sibling), `StageTelemetryOptions` interface, `module.exports` → `export`.

**Cross-boundary CJS deps:** `tools/sessions.js` and `core/subagent-limit.js`
are *not* converted in this wave, so they remain `require()`'d (returns `any`,
bypasses `allowJs:false` without pulling a non-included `.js` into the typecheck
program) — the established repo pattern (`lib/core/persistent-data-migration.ts:10`).

## Goal Check

| Goal | Evidence | Status |
|------|----------|--------|
| `module.exports` eliminated in 5 launcher `.ts` (SC1) | `grep -c 'module.exports'` returns 0 for claude/codex/mistral/opencode/stage-telemetry | PASS |
| ESM `export`/`import` present | `lib/agents/mistral.ts:1,79`, `lib/agents/stage-telemetry.ts:17,47`; `claude.ts:1-2`, `codex.ts:1-5`, `opencode.ts:1-4` | PASS |
| `stage-telemetry` internal codex dep resolved within wave (CP-2 risk) | `lib/agents/stage-telemetry.ts:17` imports `codexHomeRoot`/`extractCodexTelemetry` from `./codex.js` | PASS |
| TS option interfaces added | `lib/agents/codex.ts` (`CodexInvocationOptions`/`StartCodexAgentOptions`), `opencode.ts` (`BuildOpencodeInvocationOptions`/`StartOpencodeAgentOptions`), `claude.ts`, `mistral.ts` | PASS |
| `tsc --noEmit` clean across all 11 converted (SC3) | `npm run typecheck` exit 0, no `error TS` lines | PASS |
| Tests identical to baseline (SC2) | `npm test`: 1751 / 1729 pass / 0 fail / 22 skip — matches baseline; covers `test/claude.test.js`, `test/codex.test.js`, `test/mistral.test.js`, `test/opencode.test.js`, `test/opencode-retry.test.js`, `test/opencode-launcher-telemetry.test.js` | PASS |
| Faithful rename ≥50% (SC7) | `git diff -M --summary`: claude 75%, codex 76%, mistral 80%, opencode 76%, stage-telemetry 80%; combined changes ≤ 50% line budget for all 5 | PASS |
| No committed `.js` for 5 launchers (SC6) | compiled outputs gitignored; `git mv` removed originals from index | PASS |

## Next action

Execute CP-3: convert the aggregator `agents.js` → `agents.ts` (imports all 11
now-converted modules plus core/tools deps), resolving any circular dependency
with lazy `require()` if `tsc`/runtime reveals one, then run the full Gate set
(`verify-local.sh static-analysis`, `npm test`, `typecheck`, `prepublishOnly` +
`npm pack`, `node -e require('./lib/agents/agents')`).
