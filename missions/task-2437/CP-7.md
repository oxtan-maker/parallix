# CP-7: `px ui` cutover + TUI fallback

## Summary

Verified the user-facing launch contracts per ADR 0054 and existing CLI
conventions, and confirmed the Ink TUI remains the proven rollback/fallback path
that shares the same production projection/controller contracts as the web board.

Design (unchanged, correct at the parent commit):
- **Primary operator UI — web board via `px web`.** `px web` binds an ephemeral
  loopback port only (`127.0.0.1`/`::1`), serves the built `build/web` shell from
  a manifest allowlist, validates JSON-Schema command requests, and invokes the
  application use cases. This is ADR 0054's primary surface.
- **Fallback — Ink TUI via `px ui`.** `px ui` renders the interactive Ink board
  (read-only, `q`/Ctrl+C to exit) and stays launchable as the rollback path
  (ADR 0054 authorizes no TUI deletion; `tui-rollback-proof.test.ts` proves the
  `ui` command is a removable dynamic import).

Shared production contracts (SC10): both commands compose via
`createProductionApplicationServices(rootDir)` → `presentationCapabilities`, and
the board projection and command controller are a single shared instance:
`capabilities.boardProjection === capabilities.tui.boardProjection`
(`test/production-composition-capabilities.test.ts`), and one shared
`BoardCommandController` (`src/composition/board-projection.ts`) is used by both
the web mutation route (`capabilities.commandController`,
`src/composition/create-cli.ts`) and the TUI (`capabilities.commandControllerFactory`,
`src/interfaces/tui/ui-command.ts`). The web board adds a route, never a second
dispatch path, and never touches Git/SQLite/files/agents/subprocesses from the
browser.

Live launch verified this session: `node build/px.mjs web --host 127.0.0.1`
serves the shell with the full protection header set on a loopback origin.

No code change required: the cutover architecture is already in place and green.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `px web` is the primary loopback web launch | `test/web-host.integration.test.ts` "binds explicit loopback and reports the actual origin" | PASS |
| `px ui` TUI fallback launches, removable dynamic import | `test/tui-rollback-proof.test.ts` "rollback-proof: ui command uses dynamic import (not static require)" | PASS |
| Web and TUI share one board projection | `test/production-composition-capabilities.test.ts` "production composition gives CLI and TUI identical board and active capability instances" | PASS |
| Web and TUI share one command controller | `src/composition/board-projection.ts` shared `commandController` used by web route and TUI | PASS |

## Next action: commit CP-7, then CP-8 design fidelity (reference design zip is absent — stop rule → follow-up).
