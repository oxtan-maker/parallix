# Mission: Make mission worktrees retain the complete Codex MCP setup (task-2265)

## Goal
Ensure that a newly created mission worktree retains the Codex configuration and MCP access available in the originating local checkout, so the Codex process launched for the mission can use configured integrations such as Slack and Datadog without mission-specific blocking.

## Why Now
The current worktree workflow succeeds on the reporter's local machine but leaves work environments without expected MCP integrations. That prevents Codex from using organization-provided context and tools during missions, making mission execution unreliable across developer environments.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: The report identifies a concrete observable failure, but the implementation must first establish which worktree/bootstrap boundary omits the active Codex configuration.
- Main drivers: worktree creation lifecycle, Codex configuration discovery, MCP server availability, and a regression test that exercises a freshly created worktree.

## Scope
- Trace the repository-managed mission/worktree creation path and identify the configuration boundary that causes a child worktree's Codex invocation to lose otherwise available MCP integrations.
- Add a regression test under `test/` that creates or models a fresh mission worktree and demonstrates the lost MCP configuration before the fix.
- Change the worktree/bootstrap workflow so the Codex process in a newly created mission worktree receives the same required Codex configuration inputs as the originating checkout, without embedding user secrets in the repository or generated mission files.
- Cover both the preserved configuration path and the absence of optional MCP configuration, so environments without configured integrations continue to create missions.
- Update workflow-facing documentation only if the resulting setup has a user-visible configuration prerequisite or invocation change.

## Out of Scope
- Adding, removing, or configuring individual third-party MCP servers such as Slack or Datadog.
- Changing remote credentials, account permissions, network policy, or organization-level MCP authorization.
- Copying secrets, access tokens, or unredacted user-level Codex configuration into a worktree, mission artifact, or repository file.
- Reworking unrelated worktree lifecycle behavior, mission execution semantics, or MCP tool implementations.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test at `test/task-2265-codex-mcp-worktree-repro.test.js` fails against the mission parent commit because a newly created mission worktree lacks the expected Codex MCP configuration, and passes after the workflow change.
- The mission/worktree creation path supplies the Codex process in a new worktree with the configuration required to discover configured MCP servers, without writing secret values to the repository or mission worktree.
- The regression coverage asserts that no configured MCP input is handled as an error: mission worktree creation still completes when the optional MCP configuration is absent.
- The implementation changes only the identified worktree/bootstrap configuration handoff and its focused tests, except for documentation required by an externally observable workflow change.
- `./scripts/verify-local.sh all` completes successfully on the final tree.

## Risks and Assumptions
- Assumption: the reported discrepancy is caused by repository-controlled worktree/bootstrap configuration handoff rather than Slack, Datadog, or enterprise network permissions.
- Risk: Codex configuration may be intentionally user-scoped or include credentials; the fix must preserve only safe configuration discovery/forwarding semantics and must not serialize secrets into tracked or mission-local files.
- Risk: the mechanism that launches Codex may differ between local and work mission paths. Investigate the actual launcher before selecting the handoff point.
- Risk: test doubles that omit environment or filesystem behavior could mask the regression. The reproduction must assert the configuration visible to the launched Codex process, not merely that a helper was called.

## Checkpoints
- CP 1: Lock the bug before any production fix. Author `test/task-2265-codex-mcp-worktree-repro.test.js` to create or model a newly created mission worktree using the existing launcher path, with configured Codex MCP input available to the parent environment. Assert that the launched Codex process can discover that MCP configuration. At the mission parent commit this assertion must fail (red) because the new worktree loses the input; it must pass (green) after the handoff fix. Do not write the production fix in this checkpoint.
- CP 2: Identify the actual worktree/bootstrap and Codex-launch boundary, then implement the minimal safe configuration handoff. Preserve the no-optional-MCP-configuration behavior and keep credentials out of tracked and generated worktree files.
- CP 3: Complete focused regression coverage for configured and absent optional MCP inputs, document any user-visible setup change, and run the mission verification gate with checkpoint evidence.

Reproduction-Test: test/task-2265-codex-mcp-worktree-repro.test.js

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2265-codex-mcp-worktree-repro.test.js` ``, `` `node ...` ``, `` `git ...` ``, `` `px ...` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough. It may appear as supplemental context only when paired with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above.
- A non-generic `Next action:` line at the bottom; for CP 1 it must state whether the reproduction is red at the parent commit, and for later checkpoints it must name the next implementation or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Worktree MCP handoff is covered | `test/task-2265-codex-mcp-worktree-repro.test.js`, exact regression test name | PASS |
| Final verification gate ran | `./scripts/verify-local.sh all` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not copy, commit, log, or persist MCP credentials, access tokens, or full user-level Codex configuration.
- Do not modify individual Slack, Datadog, or other MCP server integrations to compensate for a worktree setup defect.
- Do not alter remote repository configuration or push mission-branch changes to `origin`.
- Keep changes outside the worktree/bootstrap launcher and its focused tests only when required by concrete user-facing documentation.

## Stop Rules
- Stop and request direction if the evidence shows that missing MCP access is caused by enterprise permissions, network policy, or external server authorization rather than repository-controlled worktree setup.
- Stop before any approach that requires copying secrets or user-level credentials into a mission worktree, tracked file, log, or test fixture.
- Stop and request direction if preserving the required configuration would change Codex configuration precedence for non-mission invocations or affect users who do not create mission worktrees.
- Stop and request direction if the required launcher or configuration handoff is owned by tooling outside this repository and cannot be changed here.
