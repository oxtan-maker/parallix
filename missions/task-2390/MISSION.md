# Mission: agents.config is unchangeable in published parallix (task-2390)

## Goal
Diagnose why, in a published/installed parallix, the operator can no longer change which agent families are eligible per workflow step, then fix the config-read path so `config/agents.json` (`steps.*.eligible`) and the local override actually govern per-step eligibility in installed builds.

Concretely: the operator edits `config/agents.json` (or adds entries to `agents.local.json`) to change the per-step agent pool, but the running workflow ignores the edit. The mission confirms the root cause in the code and removes it so edits to the working-tree `config/agents.json` take effect without a rebuild/reinstall.

## Why Now
The backlog reports a live production regression: "on published parallix its not possible to change the agents anymore, its hardcoded". This blocks the operator's ability to steer agent selection (e.g. drop `qwen`, pin `claude`, or reorder the draft/reviewer pool) through configuration, forcing source edits or a rebuild to change workflow behaviour. It is a configuration-integrity regression, not a feature request.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: production regression report; configuration file is silently ignored, so the fix restores the documented `config/agents.json` contract.

## Scope
- In scope:
  - Trace how per-step agent eligibility is resolved at runtime: `src/adapters/agents/agent-config.ts` (`readAgentConfig` / `parseAgentConfigFile`), `src/adapters/agents/launcher-selection.ts` (`eligibleAgentsForStep` / `selectAgent`), `src/adapters/agents/runtime-matrix.ts`, and `src/adapters/assets/runtime-assets.ts` + `src/adapters/filesystem/package-root.ts`.
  - Pinpoint exactly which read path loads `config/agents.json` and why an edit to the working tree is ignored in an installed/published build (bundled `runtimeAssetStore` vs. working-tree file; `packageRoot` resolution).
  - Confirm whether `agents.local.json` merges only `blocklist` and never `steps`, so local overrides cannot change eligibility.
  - Implement the minimal fix so editing `config/agents.json` in the working tree governs `steps.*.eligible` in installed builds, without regressing the bundled-asset distribution model (ADR 0044) or the `agents.local.json` blocklist merge.
  - Add/adjust tests in `test/agents.test.ts` and `test/runtime-matrix.test.ts` that assert the working-tree config is read and that a changed eligible list is honored.
  - Update `config/agents.json` `_comment` / any docs if the documented override contract changes.

## Out of Scope
- Changing the default eligible agent lists themselves (keep the current draft/review/active pools unless the diagnosis shows the default is the bug).
- Adding new agent families or launchers.
- Changing model resolution (`workflow.config.json` `adapters.agents.models` / `resolveAgentModel`) — out of scope unless the diagnosis shows the model path shares the same broken read.
- Touching blocklist enforcement semantics, session markers, telemetry, or the Forgejo identity path.
- Any change to `custom` runner selection beyond what is required to keep the eligibility fix honest.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC1: Editing `config/agents.json` `steps.<stage>.eligible` in the working tree changes the agent pool returned by `eligibleAgentsForStep("<stage>")` with no rebuild. Falsified if a changed eligible list is still ignored at runtime.
- SC2: `test/agents.test.ts` gains a test that writes a distinct eligible list into a working-tree `config/agents.json` and asserts `selectAgent` / `eligibleAgentsForStep` returns that list. Falsified if no such test exists or it passes only because the bundled config is used.
- SC3: Existing behaviour survives unchanged: `isAgentBlocked` blocklist resolution, `agents.local.json` blocklist merge, launcher health probing, and the `custom` runner path all keep their current semantics. Falsified if any existing `test/agents.test.ts` or `test/runtime-matrix.test.ts` case regresses.
- SC4: `runtime-matrix.ts` still reports eligibility from the working-tree config (the `configPresent` / per-agent lines reflect the edited file). Falsified if the matrix still reads a stale bundled copy.
- SC5: `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs + test-hygiene) on the final tree. Falsified if the gate reports any error.
- SC6: No `.only` and no bare `.skip` in any touched test file. Falsified if test-hygiene flags either.

## Risks and Assumptions
- ADR 0044 requires package-owned assets (including `config/`) to resolve from the installed package root. Assumption: the fix is to make the working-tree `config/agents.json` authoritative (or to merge it over the bundle), not to remove the bundled-asset boundary. Verify ADR 0044 before changing resolution order.
- The bundled `runtimeAssetStore.readText(CONFIG_PATH)` is the likely culprit: it always reads from `packageRoot`, so a published install ignores working-tree edits. This is a hypothesis to confirm, not yet proven — the trace may instead show the merge logic drops `steps`.
- `agents.local.json` currently merges only `blocklist`; extending it to merge `steps` is in scope only if the diagnosis requires a local override path.
- Assumption: the operator's published build is the distributed package where `packageRoot` ≠ working tree. In the dev checkout `packageRoot` resolves to the repo root, so the bug may be invisible locally — do not rely on local reproduction alone.

## Checkpoints
- CP 1 (Diagnose): Trace the config-read path end to end, confirm the exact statement that loads `config/agents.json` and why working-tree edits are ignored in an installed build; record the root cause and the minimal fix plan.
- CP 2 (Fix): Implement the minimal change so working-tree `config/agents.json` governs per-step eligibility in installed builds; add regression tests.
- CP 3 (Verify): Run the full verification gate, update docs/config comment if the override contract changed, and close out the Goal Check.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `npm test -- test/agents.test.ts` ``, `` `git show --stat <commit>` ``
  2. **Test names** — must match a real test name in the repo, e.g. `"isAgentBlocked returns false when no blocklist"` (see `test/agents.test.ts`) or your new reproduction test's name
  3. **Test file paths** — e.g., `test/agents.test.ts`, `test/runtime-matrix.test.ts` (must be existing test files)
  4. **ADR references** — e.g., `ADR 0044` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Example of the weak failure mode to avoid: dumping `` `ls config` `` or `` `cat config/agents.json` `` with no test name, ADR, repo command, or test path attached is not sufficient evidence.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Config-read path traced and root cause pinned | `docs/adr/0044-workflow-distribution-model.md` (ADR 0044); `src/adapters/agents/agent-config.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- Do not modify the bundled-asset distribution boundary outside what ADR 0044 permits (`src/adapters/assets/`, `src/adapters/filesystem/package-root.ts`) without re-reading ADR 0044.
- Do not touch launcher binaries, telemetry, session markers, blocklist enforcement semantics, or the Forgejo identity path.
- Do not alter `config/state-map.json`, `config/workflow.config.schema.json` structure, or the `review`/`integrate`/`verification` adapter blocks.
- Do not push to `origin` (main only); mission work stays on the mission branch / review remote.

## Stop Rules
- Stop before implementing if the trace shows the bug is elsewhere (e.g. the operator's actual issue is `workflow.config.json` models, not `config/agents.json`); re-scope the mission contract rather than forcing a fix.
- Stop if the fix would require changing the ADR 0044 bundled-asset boundary in a way that breaks the distributed build; escalate via a revised contract instead.
- Do not run anything beyond the single `./scripts/verify-local.sh all` gate during drafting.
- Do not transition the task to `ready` — the harness does that after a clean draft.
