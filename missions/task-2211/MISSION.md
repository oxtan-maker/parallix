# Mission: Repair Codex isolation so harness-owned state stays isolated without hiding operator-installed tools (task-2211)

Base-Branch: skunkworks

## Goal
Repair the Codex launcher environment so Parallix still isolates Codex-owned session, auth, config, and telemetry state inside the mission worktree, but does not break access to operator-installed tools that downstream mission commands legitimately invoke, specifically the OpenCode/custom-agent and Pi CLIs implicated by the smoke failure.

## Why Now
The current Codex launcher replaces `HOME` with `<worktree>/.workflow/codex-home` for non-interactive runs. Repo evidence shows that this was intentional for Codex-local state such as `.codex/config.toml`, copied `auth.json`, Graphify skill seeding, and rollout telemetry under `.workflow/codex-home` (`lib/agents/codex.ts`, `docs/agents.md`, `docs/operator-setup.md`). The backlog report adds the missing consequence: the same full-`HOME` replacement also changes what nested tooling sees, so a Parallix run launched from Codex can no longer reliably reach operator-installed OpenCode and Pi commands. That turns the real-agent smoke failure into a harness-environment bug, not a product-tree failure. This needs a narrow contract now because task-2209 is already tracking broader Codex MCP/bootstrap completeness, and this mission must fix the isolation boundary without turning into a general Codex setup rewrite.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Codex currently isolates by overriding the entire `HOME`; the bug is launcher-boundary behavior in `lib/agents/codex.ts`; the repo already has smoke and agent-launcher tests that can lock the regression with focused coverage rather than a broad workflow rewrite

## Scope
- Author a failing reproduction test under `test/` that demonstrates the current Codex launch environment hides operator-installed PATH/HOME-local tools needed by downstream mission commands, even though Parallix only needs Codex-owned state isolation.
- Trace the current Codex environment contract in `lib/agents/codex.ts` and any directly involved helpers/docs to separate two concerns explicitly: Parallix-owned Codex state (`.workflow/codex-home`, copied auth/config/skills, rollout telemetry) versus operator-owned tool resolution for nested commands such as `opencode` and `pi`.
- Implement the smallest launcher change set that preserves Codex state isolation while restoring access to operator-installed nested tools in non-interactive mission runs.
- Add focused regression coverage for the corrected environment contract, including at least one red-to-green reproduction and one preservation test proving Codex-specific state still lands under `.workflow/codex-home`.
- Update the concrete operator-facing docs that currently describe Codex’s isolated `HOME` behavior so they match the post-fix contract exactly.

## Out of Scope
- Broad “make Codex fully complete” bootstrap work such as Slack/Datadog/MCP coverage from task-2209.
- Reworking non-Codex agent launchers (`claude`, `custom`/OpenCode, `mistral`) unless a shared helper must change to preserve the corrected Codex contract.
- Changing agent eligibility, selection, retry policy, blocklist behavior, or review/integrate lifecycle logic.
- Replacing the real-agent smoke gate, changing its mission scenario, or downgrading it because the current failure is inconvenient.
- Any fix that relies on editing operator-global shell profiles, requiring manual workstation steps, or moving Parallix-owned state back into the operator’s real home.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC 1: `test/task-2211-codex-isolation-repro.test.js` fails on the mission parent commit by proving that the current non-interactive Codex launch environment makes a PATH/HOME-local nested tool resolution scenario for OpenCode or Pi fail when launched through the Codex harness contract.
- SC 2: After the fix, the reproduced nested-tool scenario in `test/task-2211-codex-isolation-repro.test.js` passes without requiring the operator’s real `~/.codex` directory or changing the mission worktree path.
- SC 3: Codex-owned state remains isolated after the fix. Focused tests prove the launcher still writes Codex config under `<worktree>/.workflow/codex-home/.codex/config.toml`, still copies `auth.json`/skill seed into the worktree-local Codex area when present, and still reads rollout telemetry from the worktree-local Codex home rather than the operator’s real home.
- SC 4: The fix does not broaden the contract into “use the operator’s full home for everything.” Evidence must show that only the environment pieces required for nested tool resolution are restored, while Parallix-owned Codex files remain worktree-local.
- SC 5: Operator-facing docs that currently describe the Codex isolated-home behavior are updated to name the corrected boundary precisely, including what remains isolated and what nested tools still resolve from operator-local installation paths.
- SC 6: Because the expected implementation touches `lib/agents/`, `./scripts/verify-local.sh static-analysis` passes on the final tree.
- SC 7: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions
- Risk: a naive fix that simply stops overriding `HOME` could leak Codex session/config/telemetry state into the operator’s real home and regress the isolation guarantees documented today. Mitigation: require explicit preservation tests for config/auth/skill/telemetry paths.
- Risk: OpenCode and Pi may depend on slightly different environment variables or path conventions, so the first reproduction must identify which part of the inherited environment is actually required before the fix is designed.
- Risk: docs currently describe the whole-`HOME` override as the mechanism. If the implementation changes that mechanism, the docs must describe the new boundary concretely instead of repeating “isolated HOME” loosely.
- Assumption: the bug can be locked with hermetic tests by controlling environment variables and stub command locations, without depending on live Codex/OpenCode/Pi provider access.
- Assumption: the correct solution is localized to the Codex launcher environment contract, not to the smoke test’s basic expectations that operator-installed tools remain reachable.

## Checkpoints
- CP 1: Author the failing reproduction test at `test/task-2211-codex-isolation-repro.test.js`. The test must model a Codex non-interactive launch environment that uses worktree-local Codex state while a downstream nested command must still resolve an operator-installed OpenCode or Pi binary. The assertion must fail on the mission parent commit (red) because the current full-`HOME` replacement hides that nested tool path, and it must be the same assertion that passes after the fix (green).

Reproduction-Test: test/task-2211-codex-isolation-repro.test.js

- CP 2: Trace the current Codex launcher contract in `lib/agents/codex.ts`, identify which state must remain under `.workflow/codex-home`, and identify the minimum environment restoration required so nested OpenCode/Pi command resolution survives a Codex-run mission.
- CP 3: Implement the smallest correct launcher change and add preservation tests proving Codex config/auth/skill/telemetry isolation still uses worktree-local paths after the environment fix.
- CP 4: Update the named docs that describe Codex isolated-home behavior so they match the corrected contract, then run the required verification gates and capture proof for handoff.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include:
- A summary of the concrete work done in that checkpoint, naming the launcher/environment behavior that changed or was preserved
- A `## Goal Check` section using that exact heading
- A 3-column pipe-delimited markdown table using exactly: `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/agents/codex.ts:74` (must point to an existing file and line)
  2. **Exact test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2211-codex-isolation-repro.test.js` or `test/e2e-real-agent-smoke.test.js` (must be existing test files)
  4. **ADR references** — e.g., `ADR 0044` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `node --test test/task-2211-codex-isolation-repro.test.js` ``, `` `git diff --stat` ``, `` `px review task-2211 --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough. If shell output is useful, pair it with one of the accepted references above so the evidence is machine-checkable.
- A non-generic `Next action:` line at the bottom naming the next checkpoint task or unresolved launcher question

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction stays red on the parent commit | `test/task-2211-codex-isolation-repro.test.js`, `"codex isolation repro fails when nested tool resolution depends on operator-local install paths"` | PASS |
| Codex state still lands in worktree-local home | `lib/agents/codex.ts:158`, `test/codex-telemetry.test.js` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- Keep the implementation inside the Codex launcher/environment contract, its focused tests, and directly affected docs.
- Do not fix this by rewriting the smoke test to avoid nested tools, by weakening the smoke gate, or by changing unrelated agent families’ launcher contracts.
- Do not move Codex auth, config, Graphify skill seeding, or rollout telemetry back into the operator’s global home as the price of restoring nested tool access.
- Do not fold task-2209’s broader MCP/bootstrap concerns into this mission.

## Stop Rules
- Stop if repo-local investigation shows the smoke failure is not caused by the Codex launcher environment and instead comes from an independent OpenCode/Pi installation or smoke-test bug.
- Stop if the only viable fix is “stop isolating Codex state entirely” rather than restoring only the environment inputs needed for nested tool resolution.
- Stop if OpenCode/Pi access requires undocumented operator-global shell initialization that Parallix cannot model or test hermetically from the current tree.
- Stop if the change would require a broad cross-agent environment-contract redesign instead of a Codex-local fix with focused preservation tests.
