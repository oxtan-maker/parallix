# Mission: Make agent availability and blocks visible in the px board top row (task-2336)

Reproduction-Test: test/task-2336-repro.test.ts

## Goal
The `px` board must show one entry per known agent family in the agent strip above the board, with a red dot plus remaining-block countdown for blocked families and a green dot for available ones. Today the strip renders the literal fallback `agents: unavailable` on a stock checkout because the read path that supplies known agent families (`resolveKnownAgentFamilies`, `src/interfaces/tui/agent-config-resolver.ts:14`) looks for a `families` array in `config/agents.json`, and the shipped config has no such key — it only declares per-step `steps.<step>.eligible` lists. With zero known families, `ConcreteAgentReadAdapter.loadAgentAvailability` (`src/adapters/backlog/concrete-agent-read-adapter.ts:72`) queries the SQLite blocklist for an empty family list, `BoardMetrics.agentAvailability` is `[]`, and both `AgentStrip` (`src/interfaces/tui/agent-strip.tsx:59`) and the FLOW panel Agents column (`src/interfaces/tui/flow-panel.tsx:67`) degrade to the "unavailable" placeholder. Fix the back-end derivation so real families and real block state reach the UI, and lock the behaviour with tests.

## Why Now
Blocks are already written to the operator SQLite blocklist at runtime — `updateAgentBlockChecked` in `src/adapters/agents/agents.ts:231` persists a block whenever a launch hits a usage limit. That state is invisible to the operator, so when an agent family is quota-blocked the board looks identical to a fully healthy board and the operator cannot tell why missions stop being picked up. The whole read chain (domain `blockedForMs`, `projectAgentAvailability`, `BoardMetrics.agentAvailability`, `AgentStrip` countdown rendering) already exists and is unit-testable; only the family list at the composition seam is missing, so a small back-end fix unlocks a UI surface that is otherwise dead code with no test coverage (`grep -rl AgentStrip test` returns nothing today).

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one resolver rewrite plus its composition seam, a reproduction test, and new coverage for `AgentStrip` rendering and `projectAgentAvailability`; no schema change, no new port, no migration.

## Scope
- `src/interfaces/tui/agent-config-resolver.ts` — derive known agent families from the shipped `config/agents.json` shape. Accept an explicit top-level `families` array when present; otherwise fall back to the sorted union of every `steps.<step>.eligible` entry. Reject entries that fail `agentFamily()` validation (`src/domain/agents.ts:3`) instead of blind-casting `string` to `AgentFamily`.
- Keep the existing fail-soft behaviour for a missing or malformed `config/agents.json` (return `[]`, no throw), but make it observable in tests.
- `src/interfaces/tui/agent-strip.tsx` — render the block reason (from `AgentAvailabilityRow.reason`) alongside the countdown for blocked families, and keep the green/red dot and `sessions:N` fields unchanged.
- Tests: reproduction test at `test/task-2336-repro.test.ts` (CP 1), plus unit coverage for the resolver fallback, for `projectAgentAvailability` blocked/indefinite/expired cases, and for `AgentStrip` rendering a red dot + countdown for a blocked family.
- Docs: update the agent-availability behaviour description wherever `config/agents.json` families are documented (`docs/`), if such a description exists; otherwise add one short paragraph to the board/TUI doc that owns the agent strip.

## Out of Scope
- The legacy synchronous block seam `defaultIsAgentBlockedNow` (`src/adapters/agents/agents.ts:216`), which reads blocks from the agent config file rather than the SQLite blocklist. That divergence is real but is a launcher-selection concern, not a board-visibility concern; record it as a follow-up backlog note instead of changing it here.
- Any change to `AgentBlocklistRepository`, `SqliteBlocklistRepository`, or the blocklist table schema.
- Any change to how blocks are written (limit detection, `updateAgentBlockChecked`, block TTL policy).
- Rewriting the FLOW panel layout or the board layout to match the design zip pixel-for-pixel; only the agent-strip data path and its reason/countdown text change.
- Adding a new CLI command for listing or clearing blocks.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. `test/task-2336-repro.test.ts` exists, fails at the mission's parent commit, and passes on the final tree, asserting that `resolveKnownAgentFamilies(<repo root>)` returns a non-empty list containing exactly the union of `steps.*.eligible` in the repository's `config/agents.json` — at the current config that union is `['claude', 'codex', 'custom', 'vibe']`.
2. `resolveKnownAgentFamilies` returns the explicit `config.families` array when the config declares one, and the sorted `steps.*.eligible` union when it does not; both branches are asserted in tests.
3. `resolveKnownAgentFamilies` returns `[]` (no throw) for each of: missing `config/agents.json`, non-JSON file contents, and a JSON object with neither `families` nor `steps`; all three cases are asserted in tests.
4. Values that fail `agentFamily()` validation (for example `"Claude Opus"` or `""`) are dropped from the returned list rather than returned as invalid `AgentFamily` values; asserted in a test.
5. A test renders `AgentStrip` with one available family and one family blocked until a fixed future timestamp, and asserts the rendered frame contains the blocked family name, a red-dot entry, and the countdown string produced by `formatCountdown` (for example `45m`) — and does not contain the string `agents: unavailable`.
6. A test renders `AgentStrip` with `agentAvailability: []` and asserts the frame still contains `agents: unavailable`, so the empty-state fallback survives.
7. `projectAgentAvailability` has direct test coverage for three block kinds: `{kind:'none'}` → `available: true, blockedForMs: 0`; `{kind:'until'}` with `untilMs` in the future → `available: false` and `blockedForMs` equal to `untilMs - nowMs`; `{kind:'until'}` with `untilMs` already past → `available: true, blockedForMs: 0`. Indefinite blocks yield `available: false, blockedForMs: Infinity`.
8. A blocked family's `reason` string reaches the rendered strip: a test blocks a family with reason `"usage limit"` and asserts that string appears in the `AgentStrip` frame.
9. `launcherAvailable: false` still renders as unavailable even with `{kind:'none'}` block, asserted in a test, so launcher probes are not masked by the new family derivation.
10. `./scripts/verify-local.sh all` exits 0 on the final tree, with no `.only` and no unannotated `.skip` introduced in any changed test file.

## Risks and Assumptions
- The design archive named in the backlog task (`/tmp/Parallix Kanban Board Controller.zip`) is not present on this machine (`ls /tmp | grep -i parall` shows only test scratch dirs). Assumption: the existing `AgentStrip` layout — dot, family, `sessions:N`, countdown — is the intended top-row shape, and this mission only makes it carry real data plus the block reason. If the archive later dictates a different layout, that is a separate mission.
- Assumption: `config/agents.json` `steps.*.eligible` is the authoritative list of families the operator cares about. Risk: a family that appears in no step's `eligible` list will not be shown. Mitigation is the explicit `families` key, which takes precedence when present.
- Risk: widening the family list changes `AgentBlockService.queryAll` inputs and therefore `BoardMetrics.agentAvailability` length, which other TUI snapshot-style tests may assert. Check `test/` for board-projection assertions that pin metric shape before changing the resolver.
- Risk: the blocklist read path is async and TUI-facing; a slow or locked SQLite file would delay board render. The path is unchanged by this mission, but do not add extra per-render queries.
- Assumption: ADR 0051 (UI-neutral application boundary) still holds — family derivation is a composition/interface concern and must not push config parsing into `src/domain/` or `src/application/`.

## Checkpoints
- CP 1 — Lock the bug. Author `test/task-2336-repro.test.ts` and nothing else. The test loads the repository's real `config/agents.json` (or a fixture that is a byte-copy of its current shape: a `steps` map with `eligible` arrays and no top-level `families` key) into a temp dir and calls `resolveKnownAgentFamilies(tempRoot)`. Assertion: the returned array is non-empty and equals `['claude', 'codex', 'custom', 'vibe']`. At the parent commit this fails with an empty array (red). Add a second assertion in the same file that rendering `AgentStrip` with the availability rows derived from that list does not produce `agents: unavailable`. Do not touch `src/` in this checkpoint. Record the red output in CP-1.md.
- CP 2 — Fix the derivation. Rewrite `resolveKnownAgentFamilies` for the `families`-or-`steps.*.eligible` precedence, `agentFamily()` validation filtering, and the three fail-soft cases. Add the resolver unit tests (Success Criteria 2–4). CP 1's reproduction test turns green here.
- CP 3 — Surface block state in the strip. Add the block `reason` to the `AgentStrip` entry, and add the rendering and projection tests (Success Criteria 5–9). Verify no existing board-projection test regresses from the longer availability list.
- CP 4 — Docs and gate. Update the doc that describes agent availability in the board (or add the paragraph if absent), file the follow-up note about the `defaultIsAgentBlockedNow` config/SQLite divergence in the backlog, and run `./scripts/verify-local.sh all` on the final tree. CP-4.md carries the full Goal Check table for all ten criteria.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section — use that exact heading
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status (header row exactly `| Criterion | Evidence | Status |`)
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/interfaces/tui/agent-config-resolver.ts:14` (must point to an existing file and line)
  2. **Test names** — e.g., `"resolveKnownAgentFamilies falls back to the union of steps.*.eligible"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2336-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2336-repro.test.ts` ``, `` `px board` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but never on its own: a row whose evidence is only `stat test/task-2336-repro.test.ts`, only a directory listing, or only a sentence such as "the resolver now works" is rejected. Pair such output with one of the five accepted references above — for example, quote the failing/passing line from `npm test -- test/task-2336-repro.test.ts` AND cite the test name plus `src/interfaces/tui/agent-config-resolver.ts:<line>`.
- For CP 1 specifically, the red evidence must be the exact assertion failure line from `npm test -- test/task-2336-repro.test.ts` together with the test file path and the test name.
- A non-generic `Next action:` line at the bottom (name the next file or command, not "continue with the mission").

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Repro test locks the empty-family bug | `test/task-2336-repro.test.ts`, `"resolveKnownAgentFamilies returns the steps.*.eligible union for the shipped config"` | PASS |
| Resolver derives families from steps | `src/interfaces/tui/agent-config-resolver.ts:14` | PASS |
| Blocked family renders countdown | `test/agent-strip.test.ts`, `"blocked family renders a red dot and countdown"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/adapters/sqlite/blocklist-repository.ts` and the blocklist table schema — read-only for this mission.
- `src/adapters/agents/agents.ts` — do not change `updateAgentBlockChecked`, `shouldPersistLaunchFailureBlock`, or `defaultIsAgentBlockedNow`.
- `src/domain/agents.ts` — `blockedForMs`, `selectableAgents`, and `selectAgent` stay behaviourally unchanged; only read from them.
- `config/agents.json` — do not add a `families` key to the shipped config as the fix. The point is that the derivation works on the config as shipped; a `families` fixture belongs in a test, not in the repository config.
- `backlog/tasks/task-2336 - ensure-agent-availibility-is-visible-in-px-ui.md` — update Definition of Done checkboxes only; do not rename or move the file.

## Stop Rules
- Stop and report if the `steps.*.eligible` union does not match the families the blocklist actually stores (for example, the blocklist holds an agent name absent from every `eligible` list) — that means the family source of truth is elsewhere and the mission's premise needs revisiting.
- Stop if fixing the resolver breaks more than two existing tests in ways that require changing production code outside `src/interfaces/tui/`; that signals a wider coupling than this mission scopes.
- Stop if the fix would require moving config parsing into `src/domain/` or `src/application/`, which would violate ADR 0051.
- Stop if `./scripts/verify-local.sh all` fails on the parent commit before any change is made — report the baseline failure rather than repairing unrelated red tests inside this mission.
- Do not expand into the design-archive layout work; if the archive appears and disagrees with the current strip layout, stop and file a follow-up task.
