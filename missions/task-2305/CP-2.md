# CP-2 — View-only navigation, focus, and mission detail

Implemented the Wave 3 view-state layer. `navigation.ts` holds the selected mission and per-lane window offsets; it has no command or infrastructure dependency. The shell maps arrow keys and `h/j/k/l` to that reducer, shows a cyan `▶` focus marker, and passes the selected mission detail projection to a dedicated panel. The composition root creates the detail projections, preserving the UI-neutral application boundary. Enter, `a`, `r`, and `c` now render a specific “not yet available” message.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Keyboard movement has deterministic wrapping, empty-lane skipping, vertical boundaries, and visible windows | `src/interfaces/tui/navigation.ts:68`, "navigation: horizontal movement wraps, skips empty lanes, and preserves the row when possible", "navigation: overflowing lane changes selected id and visible window without rendering commands" | PASS |
| Focus is visibly distinct in wide and narrow layouts | `src/interfaces/tui/mission-card.tsx:105`, "component: selected mission has an explicit focused marker in wide and narrow board layouts" | PASS |
| Selected detail is rendered from the shared mission-detail projection and stale/missing data is explicit | `src/interfaces/tui/mission-detail-panel.tsx:11`, `src/interfaces/tui/ui-command.ts:130`, "component: selected mission detail renders the shared projection and stale source is explicit" | PASS |
| Navigation changes view state only and has no command/workflow/filesystem/Git/agent/Forgejo capability | `src/interfaces/tui/navigation.ts:68`, "navigation: reducer is view-state only and imports no board command, workflow, filesystem, Git, agent, or Forgejo capability" | PASS |
| Reserved future-action keys show an explicit unavailable affordance | `src/interfaces/tui/shell.tsx:276`, "component: every reserved future-action key renders an unavailable affordance without a workflow action" | PASS |
| Targeted component and semantic checks pass | `npm test -- --test-name-pattern='navigation:|component:' test/tui-navigation.test.ts test/tui-wave-3-component.test.ts`, `npm run typecheck` | PASS |

Next action: add a local real-PTY harness with timeout and terminal-restoration assertions, then drive the built UI through navigation, resize, and clean exit.
