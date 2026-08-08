# CP-4 — Docs and gate

## Summary

- Added `## Agent availability in the board (px UI)` to `docs/agents.md:133`, describing the
  strip's per-family entry (green/red dot, countdown, block reason, `sessions:N`) and the
  `families`-then-`steps.*.eligible` derivation with its fail-soft empty-list behaviour.
- Corrected the per-step eligibility example in `docs/agents.md:109`–`:112`, which listed a
  `mistral` family that `config/agents.json` does not declare; the doc's own rule is that the
  executable config is the source of truth, and the example now matches the shipped
  `codex`/`claude`/`custom`/`vibe` lists.
- Filed the out-of-scope divergence as
  `backlog/tasks/task-2345 - Reconcile-launcher-block-seam-with-the-SQLite-blocklist.md`:
  `defaultIsAgentBlockedNow` (`src/adapters/agents/agents.ts:216`) reads the config-file
  blocklist while `updateAgentBlockChecked` (`src/adapters/agents/agents.ts:228`) and
  `ConcreteAgentReadAdapter.loadAgentAvailability`
  (`src/adapters/backlog/concrete-agent-read-adapter.ts:72`) use the SQLite blocklist.
- Ticked the six Definition of Done checkboxes on
  `backlog/tasks/task-2336 - ensure-agent-availibility-is-visible-in-px-ui.md`; status,
  assignee, labels, and other lifecycle metadata are untouched.

Final gate: `./scripts/verify-local.sh all` exits 0 with `tests 1764 / pass 1764 / fail 0 /
skipped 0`. Baseline at the mission's parent commit `4c234193c` was `tests 1713 / pass 1713 /
fail 0`.

No `.only` and no `.skip` appear in any test file this mission added or changed
(`grep -rn "\.only(\|\.skip(" test/task-2336-repro.test.ts test/agent-config-resolver.test.ts test/agent-strip.test.ts`
returns nothing).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — `test/task-2336-repro.test.ts` exists, was red at the parent commit, passes on the final tree, and asserts the `steps.*.eligible` union `['claude','codex','custom','vibe']` | `test/task-2336-repro.test.ts`, `"resolveKnownAgentFamilies returns the steps.*.eligible union for the shipped config"`; CP-1 records the red line `known agent families must not be empty for the shipped config. Got: []`; `npm test -- test/task-2336-repro.test.ts` now passes | PASS |
| SC2 — explicit `config.families` wins; sorted `steps.*.eligible` union otherwise; both branches tested | `"resolveKnownAgentFamilies returns the explicit families array when the config declares one"` and `"resolveKnownAgentFamilies falls back to the sorted union of steps.*.eligible"` in `test/agent-config-resolver.test.ts`; `src/interfaces/tui/agent-config-resolver.ts:29` | PASS |
| SC3 — `[]` without throwing for missing config, non-JSON contents, and a config with neither key | `"resolveKnownAgentFamilies returns an empty list when config/agents.json is missing"`, `"resolveKnownAgentFamilies returns an empty list for non-JSON config contents"`, `"resolveKnownAgentFamilies returns an empty list when the config has neither families nor steps"`; `src/interfaces/tui/agent-config-resolver.ts:25` | PASS |
| SC4 — values failing `agentFamily()` (`"Claude Opus"`, `""`) are dropped, not returned | `"resolveKnownAgentFamilies drops entries that fail agentFamily() validation"` in `test/agent-config-resolver.test.ts`; `validFamilies` at `src/interfaces/tui/agent-config-resolver.ts:53` | PASS |
| SC5 — blocked family renders name, red dot, and `formatCountdown` output (`45m`), with no `agents: unavailable` | `"AgentStrip renders a red dot and countdown for a family blocked until a future timestamp"` and `"AgentStrip gives the blocked family a red dot and the available family a green dot"` in `test/agent-strip.test.ts`; `src/interfaces/tui/agent-strip.tsx:73` | PASS |
| SC6 — `agentAvailability: []` still renders `agents: unavailable` | `"AgentStrip renders \"agents: unavailable\" when the availability list is empty"`; `src/interfaces/tui/agent-strip.tsx:62` | PASS |
| SC7 — `projectAgentAvailability` covered for none / future-until / expired-until / indefinite | `"projectAgentAvailability reports an unblocked family as available with zero remaining time"`, `"...reports a future until-block as unavailable with the remaining time"`, `"...reports an expired until-block as available"`, `"...reports an indefinite block as unavailable for Infinity"` in `test/agent-strip.test.ts`; `src/application/projections/agent-status.ts:17` | PASS |
| SC8 — reason `"usage limit"` reaches the rendered strip | `"AgentStrip renders the block reason for a blocked family"`; `src/interfaces/tui/agent-strip.tsx:83`; `src/application/projections/board.ts:63` | PASS |
| SC9 — `launcherAvailable: false` with `{kind:'none'}` still renders unavailable | `"projectAgentAvailability keeps a launcher-unavailable family unavailable despite no block"` in `test/agent-strip.test.ts` | PASS |
| SC10 — `./scripts/verify-local.sh all` exits 0 with no `.only` and no unannotated `.skip` in changed test files | `./scripts/verify-local.sh all` exit 0, `pass 1764 / fail 0 / skipped 0`; `test/task-2336-repro.test.ts`, `test/agent-config-resolver.test.ts`, `test/agent-strip.test.ts` contain no `.only(`/`.skip(` | PASS |
| Docs — agent-availability behaviour documented where `config/agents.json` families are described | `docs/agents.md:133` (`## Agent availability in the board (px UI)`), `docs/agents.md:109` (eligibility example corrected to the shipped families) | PASS |
| Follow-up note filed for the out-of-scope block-seam divergence | `backlog/tasks/task-2345 - Reconcile-launcher-block-seam-with-the-SQLite-blocklist.md`, citing `src/adapters/agents/agents.ts:216` and `src/adapters/backlog/concrete-agent-read-adapter.ts:72` | PASS |
| ADR 0051 — config parsing stayed in the interface layer | `src/interfaces/tui/agent-config-resolver.ts:20`; `src/domain/agents.ts` and `src/application/projections/agent-status.ts` are read-only for this mission, `ADR 0051` | PASS |
| Restricted areas untouched | `config/agents.json` has no `families` key (pinned by `"shipped config/agents.json declares no top-level families key"`); `src/adapters/agents/agents.ts` and `src/adapters/sqlite/blocklist-repository.ts` are unmodified on this branch | PASS |
| DoD #2 — lint and static analysis clean on every changed file | `npm run typecheck` exit 0; `npx eslint src/interfaces/tui/agent-config-resolver.ts src/interfaces/tui/agent-strip.tsx src/application/projections/board.ts test/agent-strip.test.ts test/agent-config-resolver.test.ts test/task-2336-repro.test.ts` clean | PASS |

Next action: hand off `mission/task-2336` for review; the reviewer should confirm `px board` shows a red dot with countdown and reason for a family blocked in the SQLite blocklist, and triage `backlog/tasks/task-2345 - Reconcile-launcher-block-seam-with-the-SQLite-blocklist.md`.
