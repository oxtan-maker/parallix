# CP-1: Leaf telemetry modules converted to ESM/TypeScript

## Summary

Converted the 6 leaf modules in `lib/agents/` (no dependencies on other agent
launchers) from CommonJS to ES Module / TypeScript syntax via faithful `git mv`
renames:

- `mistral-telemetry.js` → `.ts` — `module.exports` → named `export` (no other change; stub has no params).
- `limit-hit.js` → `.ts` — added TS param/option annotations (`DetectLimitHitOptions` interface), replaced the JSDoc cast `/** @type {keyof…} */(agent)` with `agent as keyof typeof PATTERN_SETS`, `module.exports` → `export`.
- `claude-telemetry.js` → `.ts` — added param annotations (`num`, `unwrapEvent`, `parseClaudeStreamJson`, `extractClaudeTelemetryFromStdout`), `module.exports` → `export`.
- `codex-telemetry.js` → `.ts` — `require('fs'|'path')` → `import … from 'node:fs'|'node:path'`, param annotations on all 4 functions, converted JSDoc casts to `(fs as any)` / `as Array<…>`, `module.exports` → `export`.
- `opencode-export.js` → `.ts` — node-protocol imports, `CaptureOpencodeExportOptions` interface, typed `Promise<string | null>`, annotated locals/closures, `module.exports` → `export`.
- `opencode-telemetry.js` → `.ts` — param annotations on all functions, explicit recursive return type on `findTokenUsage`, `module.exports` → `export` (alias `parseOpencodeExport`).

Added `lib/agents/*.js` to `.gitignore` and `.eslintignore` (no `!` negations
needed — all 12 in this wave are converted). Compiled `.js` outputs untracked.

## Goal Check

| Goal | Evidence | Status |
|------|----------|--------|
| `module.exports`/`require` eliminated in 6 leaf `.ts` (SC1) | `grep -c 'module.exports\|require('` returns 0 for all 6 files | PASS |
| ESM `export` present | `lib/agents/limit-hit.ts:243`, `lib/agents/codex-telemetry.ts:200`, `mistral-telemetry.ts:41`, `claude-telemetry.ts:234`, `opencode-export.ts:160`, `opencode-telemetry.ts:346` | PASS |
| Node builtins use `node:` protocol | `lib/agents/codex-telemetry.ts:16-17`, `lib/agents/opencode-export.ts:1-4` | PASS |
| TS interfaces/types added | `lib/agents/limit-hit.ts:178` (`DetectLimitHitOptions`), `lib/agents/opencode-export.ts:6` (`CaptureOpencodeExportOptions`) | PASS |
| `tsc --noEmit` clean (SC3) | `npm run typecheck` exit 0, no `error TS` lines | PASS |
| Tests identical to baseline (SC2) | `npm test`: 1751 tests / 1729 pass / 0 fail / 22 skip — matches pre-conversion baseline; covers `test/limit-hit.test.js`, `test/agents-limit-hit.test.js`, `test/codex-telemetry.test.js`, `test/opencode-export.test.js`, `test/opencode-telemetry.test.js`, `test/opencode-launcher-telemetry.test.js` | PASS |
| Faithful rename ≥50% (SC7) | `git diff -M --summary`: claude-telemetry 97%, codex-telemetry 88%, limit-hit 83%, mistral-telemetry 98%, opencode-export 85%, opencode-telemetry 94% — all combined changes ≤ 50% line budget | PASS |
| No committed `.js` for 6 leaves (SC6) | compiled outputs gitignored; `git mv` removed originals from index | PASS |

## Next action

Execute CP-2: convert launcher modules `claude.ts`, `codex.ts`, `mistral.ts`,
`opencode.ts`, and `stage-telemetry.ts` (the latter resolving its internal
`codex` dependency within this wave), then re-run typecheck + full test suite.
