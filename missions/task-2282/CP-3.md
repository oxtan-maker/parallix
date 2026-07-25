# CP-3: Import-boundary guardrails, bundle baseline, rollback proof

## Summary

Installed three guardrail tests enforcing ADR 0051 (no react/ink in application/domain layers), verified the canonical ESM bundle builds with Ink included (3.3 MB, within 5 MB stop rule), captured rollback proof demonstrating headless independence from TUI, and added SC7 component tests and runtime spawn tests.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Import-boundary test: no react/ink in src/application/ (.ts + .tsx) | `test/tui-import-boundary.test.ts` — `"import-boundary: no react/ink imports in src/application/ (ADR 0051)"` | PASS |
| Import-boundary test: no react/ink in src/domain/ (.ts + .tsx) | `test/tui-import-boundary.test.ts` — `"import-boundary: no react/ink imports in src/domain/ (ADR 0051)"` | PASS |
| Import-boundary test: TUI is allowed source of react/ink | `test/tui-import-boundary.test.ts` — `"import-boundary: tui directory is the allowed source of react/ink imports"` | PASS |
| Headless-isolation: no react/ink in headless entry module graph | `test/tui-headless-isolation.test.ts` — `"headless-isolation: headless entry module graph contains no react or ink"` | PASS |
| Headless-isolation: ui command imported in index.ts | `test/tui-headless-isolation.test.ts` — `"headless-isolation: ui command is imported in index.ts"` | PASS |
| Headless-isolation: ui in COMMANDS map | `test/tui-headless-isolation.test.ts` — `"headless-isolation: ui command is in the COMMANDS map"` | PASS |
| Rollback proof: ui uses dynamic import | `test/tui-rollback-proof.test.ts` — `"rollback-proof: ui command uses dynamic import (not static require)"` | PASS |
| Rollback proof: COMMANDS valid without ui | `test/tui-rollback-proof.test.ts` — `"rollback-proof: COMMANDS map structure is valid without ui entry"` | PASS |
| Rollback proof: dist build includes TUI independently | `test/tui-rollback-proof.test.ts` — `"rollback-proof: dist build includes TUI files but headless entry does not depend on them"` | PASS |
| Rollback proof: removing ui leaves COMMANDS intact | `test/tui-rollback-proof.test.ts` — `"rollback-proof: removing ui entry leaves COMMANDS structure intact"` | PASS |
| SC7: Component tests with mocked BoardProjection | `test/tui-shell-component.test.ts` — 5 tests rendering BoardShell via Ink `renderToString` with typed BoardProjection mock | PASS |
| Runtime spawn test: px ui exits 0 from dist/px.js | `test/tui-spawn.test.ts` — `"dist/px.js ui exits 0 (CJS rollback artifact)"` | PASS |
| Runtime spawn test: px ui exits 0 from build/px.mjs | `test/tui-spawn.test.ts` — `"build/px.mjs ui exits 0 (ESM single-file bundle)"` | PASS |
| Runtime spawn test: px status unchanged | `test/tui-spawn.test.ts` — `"dist/px.js status still exits 0 (headless path unchanged)"` | PASS |
| Bundle builds with Ink (under 5 MB stop rule) | `npm run build` produces `build/px.mjs` at 3.3 MB; gate in `scripts/build-canonical-bundle.js` | PASS |
| dist/ ESM tree: dynamic imports rewritten to .mjs | `emitEsmTree()` regex handles both static `from "..."` and dynamic `import("...")` | PASS |
| dist/ ESM tree: parallel runtime lib documented | 131 .mjs alongside 87 .js (11 MB total); documented in CP-2 | PASS |
| react-devtools-core removed from production deps | `package.json` — optional peer of ink, not shipped | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` — ESLint clean, tsc clean, test typecheck clean, test-hygiene clean | PASS |
| All tests pass | `npm test` — 1206 tests, 0 failures (round 3) | PASS |

## Notes

- The dynamic import pattern (`await import('../../interfaces/tui/ui-command.js')`) at `src/platform/runtime/index.ts:71` is the key rollback mechanism. It ensures Ink and React are never loaded unless `px ui` is explicitly invoked.
- The headless-isolation test walks the full module graph from `src/platform/runtime/index.ts` and confirms no react/ink module is reachable through static imports.
- Bundle size (3.3 MB) is within the 5 MB stop rule threshold defined in MISSION.md. The build script enforces this with a hard gate.
- The dist/ CJS tree carries a parallel ESM tree (131 .mjs) for TUI dependencies. This is documented as a deliberate trade-off for Wave 1; full ESM migration is deferred to TASK-2285.
- `react-devtools-core` was removed from production dependencies (it's an optional peer of ink, not required).
