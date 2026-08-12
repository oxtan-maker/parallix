# Mission: Codex launcher HOME isolation broken — operator-installed tools unreachable (task-2266)

Base-Branch: main

## Goal
Fix the Codex launcher environment so that `HOME` is never overridden by the caller-supplied `env` parameter, ensuring operator-installed tools (OpenCode, Pi) remain resolvable by nested processes spawned under a Codex-run mission. Parallix needs `CODEX_HOME` for telemetry and session isolation — not a full `HOME` replacement.

## Why Now
The Codex launcher's `buildCodexDraftInvocation` spreads `{ ...process.env, ...env, CODEX_HOME: ... }`. When `env` carries a `HOME` key (from any caller that injects workflow-specific variables), it silently overrides the operator's `HOME`. This breaks nested tool resolution: commands installed under `~/.local/bin/` or resolved via `os.homedir()` become unreachable. Task-2211 already fixed the explicit `HOME` override in the Codex launcher, but the `env`-spread vulnerability remains — any downstream caller passing `HOME` in `env` re-introduces the same break. The smoke test failure proves the bug is live: the Codex-run harness cannot reach operator-installed OpenCode and Pi because `HOME` was replaced with a worktree-local directory.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single-expression fix in `src/adapters/agents/codex.ts` env spread; focused repro test; task-2211 already established the isolation contract and test patterns to reuse

## Scope
- Author a failing reproduction test under `test/` that proves the `env` parameter's `HOME` key overrides the operator's `HOME` in the Codex launch environment, breaking nested tool resolution for OpenCode/Pi.
- Fix `buildCodexDraftInvocation` in `src/adapters/agents/codex.ts` so `HOME` is always preserved from `process.env` regardless of the `env` parameter.
- Apply the same guard to `startCodexDraftAgent`'s `ensureCodexHome` call path where `env` flows into `originatingCodexStateRoot`.
- Add focused regression coverage proving `HOME` is preserved and `CODEX_HOME` isolation still works.
- Update any operator-facing doc that describes the Codex HOME isolation contract if the fix changes the documented boundary.

## Out of Scope
- Non-Codex agent launchers (opencode, pi, vibe, claude) — they share the `{ ...process.env, ...env }` pattern but are not implicated by this smoke failure.
- Broader Codex MCP/bootstrap completeness (task-2209, task-2265).
- Changing agent eligibility, selection, retry policy, blocklist, or review/integrate lifecycle.
- Replacing or weakening the real-agent smoke gate.
- Operator-global shell profile edits or manual workstation steps.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC 1: `test/task-2266-codex-isolation-repro.test.ts` fails on the mission parent commit by proving that when `env` carries a `HOME` key, the Codex launch environment's `HOME` differs from `process.env.HOME`, causing a nested tool resolution path (e.g. `~/.local/bin/opencode`) to be unreachable.
- SC 2: After the fix, the same test passes — `invocation.options.env.HOME` equals `process.env.HOME` regardless of `env.HOME`, and the nested tool path resolves correctly.
- SC 3: `CODEX_HOME` isolation is preserved: `invocation.options.env.CODEX_HOME` still equals `codexStateRoot(worktree)` and Codex-owned state (config, auth, telemetry, skill seed) remains under `<worktree>/.workflow/codex-home/`. Existing tests `test/task-2211-codex-isolation-repro.test.ts` and `test/task-2265-codex-mcp-worktree-repro.test.ts` still pass.
- SC 4: The fix is a single-expression change per code path in `src/adapters/agents/codex.ts` — no new abstractions, no shared helper extraction unless an existing helper already covers the pattern.
- SC 5: `./scripts/verify-local.sh static-analysis` passes on the final tree (ESLint + tsc --checkJs clean on changed files).
- SC 6: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions
- Risk: a caller legitimately needs to override `HOME` for a specific scenario. Mitigation: the Codex launcher contract does not document `HOME` as a caller-controllable input; if a scenario emerges, add an explicit option rather than leaving it implicit in `env`.
- Risk: the `env` parameter is used for more than `FORGEJO_USER` in some callers, and a hidden `HOME` is intentional. Mitigation: grep all callers of `startCodexDraftAgent` / `buildCodexDraftInvocation` — current callers pass empty `env` or workflow-only keys.
- Assumption: the bug is localized to the Codex launcher env spread in `src/adapters/agents/codex.ts`, not to the smoke test's PATH setup or to a missing codex binary.
- Assumption: task-2211's existing tests (`test/task-2211-codex-isolation-repro.test.ts`) and task-2265's tests (`test/task-2265-codex-mcp-worktree-repro.test.ts`) provide the preservation coverage for CODEX_HOME isolation and need no changes.

## Checkpoints
- CP 1: Author the failing reproduction test at `test/task-2266-codex-isolation-repro.test.ts`. The test must model a Codex launch where the `env` parameter carries a `HOME` key set to a worktree-local directory, and prove that `invocation.options.env.HOME` is overridden (not the operator's `process.env.HOME`), causing a nested tool path under `~/.local/bin/` to be unreachable. The assertion must fail on the mission parent commit (red) and pass after the fix (green).

Reproduction-Test: test/task-2266-codex-isolation-repro.test.ts

- CP 2: Fix `buildCodexDraftInvocation` in `src/adapters/agents/codex.ts` so `HOME` is always preserved from `process.env` in the final env spread. Apply the same guard to both the resume and non-resume code paths. Verify `ensureCodexHome`'s `originatingCodexStateRoot` call also uses the correct `HOME` when `env` carries a `HOME` key. Run existing tests to confirm no regression.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `node --test test/task-2266-codex-isolation-repro.test.ts` ``, `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"codex launcher keeps operator-home nested tool resolution while isolating Codex state"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2266-codex-isolation-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Repro test fails on parent commit | `test/task-2266-codex-isolation-repro.test.ts`, `"codex launch env HOME preserved from process.env despite env.HOME override"` | PASS |
| CODEX_HOME isolation preserved | `test/task-2211-codex-isolation-repro.test.ts`, `test/task-2265-codex-mcp-worktree-repro.test.ts` | PASS |
| Static analysis clean | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- Keep changes inside `src/adapters/agents/codex.ts` and `test/task-2266-codex-isolation-repro.test.ts`.
- Do not fix this by rewriting the smoke test, weakening its assertions, or changing unrelated agent launchers.
- Do not move Codex auth, config, Graphify skill seeding, or rollout telemetry out of the worktree-local `.workflow/codex-home/` directory.
- Do not introduce a shared env-helper or abstraction layer for the HOME guard unless an existing helper already covers it.

## Stop Rules
- Stop if investigation shows the smoke failure is not caused by `env.HOME` override but by an independent PATH, binary-location, or smoke-test fixture bug.
- Stop if the only viable fix requires a cross-agent environment-contract redesign (not a Codex-local change).
- Stop if `env.HOME` override is documented intentional behavior for a specific caller and the smoke test's expectation is the incorrect one.
