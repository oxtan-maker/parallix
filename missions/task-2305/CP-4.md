# CP-4 — Final verification and evidence

Completed the required final checks on the committed implementation. The full verifier and static-analysis gate pass; test hygiene found no violations. The real PTY smoke uses a disposable OS-temp fixture and confirms a built `px ui` session launches, receives navigation input, resizes, exits cleanly, and restores its terminal state. `graphify update .` completed after the source changes and refreshed the local code graph (18,637 nodes, 20,121 edges); its ignored graph outputs introduced no tracked changes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Keyboard input moves deterministic selection across lanes/cards, handles empty lanes and boundaries, wraps horizontally, and updates an overflowing visible window | `src/interfaces/tui/navigation.ts:68`, "navigation: horizontal movement wraps, skips empty lanes, and preserves the row when possible", "navigation: vertical boundaries stop and an all-empty board has no selection", "navigation: overflowing lane changes selected id and visible window without rendering commands" | PASS |
| Wide and narrow layouts visibly distinguish the focused selected mission | `src/interfaces/tui/mission-card.tsx:105`, "component: selected mission has an explicit focused marker in wide and narrow board layouts" | PASS |
| Selected mission detail consumes the shared projection and has explicit unavailable/stale states | `src/interfaces/tui/mission-detail-panel.tsx:11`, `src/interfaces/tui/ui-command.ts:130`, "component: selected mission detail renders the shared projection and stale source is explicit", "component: absent selected mission detail is explicitly unavailable" | PASS |
| Navigation keys change only view state and do not issue board/workflow/filesystem/Git/agent/Forgejo effects | `src/interfaces/tui/navigation.ts:68`, "navigation: reducer is view-state only and imports no board command, workflow, filesystem, Git, agent, or Forgejo capability" | PASS |
| Future-action keys display explicit unavailable affordances and do not execute actions | `src/interfaces/tui/shell.tsx:276`, "component: every reserved future-action key renders an unavailable affordance without a workflow action" | PASS |
| Reusable real-PTY smoke covers launch, navigation, resize, clean exit, explicit timeout, and terminal restoration | `test/helpers/pty-smoke-harness.ts:58`, `test/helpers/pty-smoke-harness.ts:103`, "real PTY smoke: launch, keyboard navigation, resize, clean exit, timeout bound, and terminal restoration" | PASS |
| PTY harness does not launch agents, contact Forgejo, or mutate the repository | `test/helpers/pty-smoke-harness.ts:52`, "PTY smoke harness: has no agent, Forgejo, repository-write, or network capability" | PASS |
| Headless and non-TTY Ink isolation compatibility remain green | `test/tui-headless-isolation.test.ts`, `test/tui-spawn.test.ts`, `./scripts/verify-local.sh all` | PASS |
| Required gates pass and no focused or bare skipped tests were added | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, `test/tui-navigation.test.ts`, `test/tui-wave-3-component.test.ts`, `test/tui-pty-smoke.test.ts` | PASS |

Next action: provide the committed mission branch to Parallix for its lifecycle-managed review transition; do not run `px review` or `px integrate` from this mission worktree.
