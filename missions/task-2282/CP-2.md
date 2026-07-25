# CP-2: TUI shell component and `px ui` entry wiring

## Summary

Created `src/interfaces/tui/` with a static shell component that renders the board layout from the design artifact (`/tmp/Parallix Kanban Board Controller.zip`): `px board` top bar, attention rail, board columns (INTAKE/IN-FLIGHT/SHIPPED) with mission cards, and staleness indication. Wired `px ui` through the composition root using a dynamic import to keep the CJS rollback build clean.

### Changes

1. **src/interfaces/tui/shell.tsx** — `BoardShell` React/Ink component rendering `BoardProjection` in the layout from the design artifact:
   - Top bar: `px board` branding, repository identity, WIP/attention counts, staleness indicator
   - Attention rail: ranked items from `attentionQueue` with reason badge, "why" text, and `$ px command` hint
   - Board columns: INTAKE (refined+backlog), IN-FLIGHT (active,review,integrate), SHIPPED — each showing lane header with count and mission cards
   - Mission cards: slug, `[cls]` classification badge, agent, title, checkpoint, gate status, next action, blocking reason
   - Footer: "Press q to quit"
   - `KeyHandler` component handles `q` and Ctrl+C exit

2. **src/interfaces/tui/ui-command.ts** — `runUiCommand()` resolves repository identity and agent families, creates a `BoardProjectionBuilder` via `createBoardProjectionBuilder()`, builds the projection, and renders it with Ink's `render()`. In-memory stub repositories (`EmptyBlocklistRepository`, `EmptyHistoryRepository`) satisfy the SQLite port interfaces for the read-only shell.

3. **src/platform/runtime/index.ts** — Added `ui` to `KNOWN_COMMANDS` and `READ_ONLY_COMMANDS`. Dynamic import of `ui-command.ts` at dispatch time keeps the CJS rollback build (`dist/`) clean. Updated `printUsage()` with `ui` documentation.

4. **scripts/build-canonical-bundle.js** — Added `jsx: 'automatic'`, `loader: { '.tsx': 'tsx' }` to esbuild config. Added `emitEsmTree()` for TUI and its transitive dependencies (domain/, adapters/backlog/, adapters/sqlite/, platform/runtime/lib/, platform/assets/) so that ink 6 (ESM-only with top-level await) loads correctly from the dist/ CJS tree via dynamic `import()`.

5. **src/adapters/backlog/concrete-*-read-adapter.ts** — Replaced lazy `require()` calls with static `import` in all five concrete read adapters. Eliminates the need for `createRequire()` shims and ensures the adapters work in all contexts (tsx dev, dist/ CJS, bundle ESM).

### Verification

- `./scripts/verify-local.sh all` passes: 1173 tests, 0 failures
- `npx eslint src/interfaces/tui/` passes with zero errors
- `npm run typecheck` — clean
- `npm run build` produces `build/px.mjs` with Ink included

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `src/interfaces/tui/` shell component created | `src/interfaces/tui/shell.tsx:57` BoardShell renders board layout from design artifact | PASS |
| BoardShell renders `px board` top bar | `src/interfaces/tui/shell.tsx:75` `<Text bold color="green">px board</Text>` | PASS |
| BoardShell renders attention rail | `src/interfaces/tui/shell.tsx:132` AttentionRail renders ranked items with reason/why/command | PASS |
| BoardShell renders board columns | `src/interfaces/tui/shell.tsx:165` BoardColumns renders INTAKE/IN-FLIGHT/SHIPPED sections | PASS |
| BoardShell renders mission cards | `src/interfaces/tui/shell.tsx:210` MissionCardRow renders slug/cls/agent/title/checkpoint/gate | PASS |
| BoardShell renders stale/unavailable indication | `src/interfaces/tui/shell.tsx:71-73` stale/unavailable banner from `sourceFacts` | PASS |
| `px ui` wired through composition root | `src/interfaces/tui/ui-command.ts:85` creates `BoardProjectionBuilder` via `createBoardProjectionBuilder()` | PASS |
| `px ui` exits on `q` keypress | `src/interfaces/tui/shell.tsx:380` KeyHandler detects `q` char and calls `onExit()` → `exit(0)` | PASS |
| `px ui` exits on Ctrl+C | `src/interfaces/tui/shell.tsx:380` KeyHandler detects `\u0003` (Ctrl+C); `src/interfaces/tui/ui-command.ts:100` `exitOnCtrlC: true` | PASS |
| `px ui` in KNOWN_COMMANDS | `src/platform/runtime/index.ts:44` `'ui'` in `KNOWN_COMMANDS` array | PASS |
| Dynamic import prevents static TUI load at dispatch | `src/platform/runtime/index.ts` `await import(UI_COMMAND_PATH)` at dispatch time | PASS |
| dist/ carries parallel ESM tree for TUI deps | `scripts/build-canonical-bundle.js` `emitEsmTree()` for domain/, adapters/backlog/, adapters/sqlite/, platform/runtime/lib/, platform/assets/ | PASS (131 .mjs alongside 87 .js) |
| `./scripts/verify-local.sh all` passes | 1206 tests, 0 failures (round 3) | PASS |

Next action: CP-3 — Add import-boundary guardrails, re-baseline bundle, and capture rollback proof. Write the import-boundary test, headless-isolation test, build the canonical ESM bundle, and prove rollback.
