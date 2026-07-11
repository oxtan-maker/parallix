# Mission: Carry MCP config into worktree codex-home (task-2209)

Base-Branch: skunkworks

## Goal

Extend `ensureCodexHome` in `lib/agents/codex.ts` so that MCP server configuration from the operator's real `~/.codex/` directory is copied into the isolated worktree codex-home. After this change, codex launched inside a mission worktree will have the same MCP server definitions (Slack, Datadog, etc.) that the operator configured on their primary machine, eliminating the "codex fails on mcp" failure at work.

## Why Now

The worktree isolation model sets `HOME=.workflow/codex-home` so codex runs sandboxed. That works for auth.json and the graphify skill — both are already copied — but MCP server definitions live in `~/.codex/config.toml` (or adjacent config files) and are not transferred. Every mission that relies on MCP tools silently fails on machines where those tools are not locally available, blocking operators who depend on Slack, Datadog, or other MCP services at work.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single-function change in `lib/agents/codex.ts`, existing copy pattern for auth.json and graphify skill, small test surface

## Scope
- Modify `ensureCodexHome` in `lib/agents/codex.ts` to copy MCP-relevant configuration files from the operator's real `~/.codex/` into the worktree codex-home `~/.codex/`
- Preserve the existing `auth.json` and graphify-skill copy logic unchanged
- Add unit tests in `test/codex.test.js` covering the new MCP copy behavior (present source, absent source, idempotent re-run)
- Add a reproduction test that asserts MCP config is absent from codex-home before the fix and present after

## Out of Scope
- Modifying the codex CLI or its upstream configuration schema
- Adding, removing, or validating specific MCP server definitions
- Changes to worktree creation flow outside `ensureCodexHome`
- Changes to `lib/agents/opencode.ts` or other agent modules
- Network proxy or firewall configuration

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `ensureCodexHome` copies `~/.codex/config.toml` from the operator's real home into `<worktree>/.workflow/codex-home/.codex/config.toml` when the source file exists (verified by unit test asserting `fs.existsSync` on the destination path after the call)
- SC2: `ensureCodexHome` skips the MCP config copy without throwing when the source `~/.codex/config.toml` does not exist (verified by unit test with a fake home directory that has no `.codex/config.toml`)
- SC3: The existing `auth.json` copy behavior remains unchanged — `test/codex.test.js` tests for auth copy still pass after the change
- SC4: The existing graphify-skill seeding behavior remains unchanged — `test/codex.test.js` tests for skill seeding still pass after the change
- SC5: `./scripts/verify-local.sh all` exits 0 on the final tree
- SC6: The reproduction test at `test/codex-mcp-worktree-repro.test.js` fails on the parent commit (no MCP config in codex-home) and passes after the fix (MCP config present in codex-home)

## Risks and Assumptions
- Risk: the operator's `~/.codex/config.toml` contains project-specific paths that break in the worktree context; assumption: codex resolves relative to the worktree `--cd` arg, so absolute paths in the config remain valid
- Risk: overwriting an existing codex-home config.toml could erase worktree-specific settings; assumption: `headlessCodexConfig` writes the file before any copy, so the copy must merge or append MCP sections rather than replacing the whole file
- Assumption: MCP server definitions in codex live in `~/.codex/config.toml` under an `[mcp]` or `[mcp_servers]` TOML section
- Assumption: the operator's real `~/.codex/config.toml` is the authoritative source of truth for MCP servers (not a separate file like `~/.codex/mcp.toml`)

## Checkpoints
- CP 1: Author reproduction test `test/codex-mcp-worktree-repro.test.js` that creates a fake home with an `~/.codex/config.toml` containing an `[mcp]` section, calls `ensureCodexHome`, and asserts the MCP config is present in the worktree codex-home. This test must fail on the parent commit (red) and pass after the fix (green).
- CP 2: Implement the MCP config copy logic in `ensureCodexHome` at `lib/agents/codex.ts`. The implementation must preserve the existing `headlessCodexConfig` write (sandbox, multi_agent, trust) and the `auth.json` copy, then read the operator's real `~/.codex/config.toml` and merge its MCP-related TOML sections into the worktree config. If the source file is absent, skip silently.
- CP 3: Add unit tests in `test/codex.test.js` for the new MCP copy behavior: (a) source present → destination has MCP content, (b) source absent → no error, existing config intact, (c) idempotent re-run → config content stable.
- CP 4: Run `./scripts/verify-local.sh all` and confirm clean exit.

Reproduction-Test: test/codex-mcp-worktree-repro.test.js

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/agents/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.js` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all` — static-analysis + test hygiene

## Restricted Areas
- `lib/agents/opencode.ts` — do not modify; this mission is scoped to codex only
- `lib/core/mission-utils/worktree.ts` — worktree creation path is not the failure point
- `lib/tools/sessions.ts` — session management is unrelated to MCP config
- `prompts/` directory — do not modify prompts in this mission
- `config/integration-pipelines.json` — do not change gate configuration

## Stop Rules
- Stop if `./scripts/verify-local.sh all` reports failures that cannot be resolved by editing only `lib/agents/codex.ts` and `test/codex.test.js`
- Stop if the reproduction test does not fail on the parent commit (indicates the bug is already fixed or the test is mis-specified)
- Stop if merging MCP TOML sections into the worktree config.toml introduces invalid TOML that causes codex to refuse startup
- Do not proceed to execution or review until all success criteria have verifiable evidence