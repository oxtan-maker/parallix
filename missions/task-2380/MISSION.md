# Mission: Recover from stale Claude resume sessions without blocking the agent (task-2380)

## Goal
Make a missing Claude conversation referenced by a resume marker recoverable: remove the stale marker, relaunch Claude without `--resume`, and prevent that deterministic stale-session condition from creating an `AgentBlock`.

## Why Now
Task-2377.04 stalled when Claude returned its real missing-conversation error. The narrow detector let the launch failure reach generic failure handling, which blocklisted Claude for one hour and exhausted the available implementer fallback path.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: a verified Claude CLI error string, an existing stale-marker recovery path, shared launch-failure blocklist classification, and focused agent-adapter tests

## Scope
- Add Claude stale-session recognition for `No conversation found with session ID: <id>` while retaining recognition of `Session not found`, for output received on stdout or stderr.
- Recover a Claude resume launch that returns either recognized missing-session signal by deleting its stored session marker and relaunching the same Claude agent without `--resume`.
- Classify recognized stale-session resume errors as non-blocking in shared launch-failure handling so no `AgentBlock` is persisted.
- Verify the real missing-session diagnostics of Codex and opencode, and align each adapter only when its observed CLI diagnostic supports a concrete detector change.
- Add focused unit coverage for the red-to-green reproduction, marker removal, fresh relaunch, and no-blocklist behavior.

## Out of Scope
- Changing quota, crash, authentication, or other agent-blocklist policies.
- Altering session-marker storage formats, retention policy, or unrelated agent selection/fallback behavior.
- Adding unverified error-message patterns for Codex or opencode.
- Manually removing historical runtime blocklist rows or modifying the incident's expired block.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A Claude resume attempt whose stdout or stderr contains `No conversation found with session ID: <id>` is recognized as stale-session input alongside the existing `Session not found` signal.
- For each recognized Claude stale-session resume result, the stored marker for that launch is deleted and the same Claude agent is relaunched without `--resume`; the flow does not select another agent family before that fresh relaunch.
- Shared launch-failure classification returns non-persisting behavior for recognized stale-session resume failures, and the exercised flow records no `AgentBlock` for that error.
- The first committed test for this mission is `test/claude.test.ts`; at the parent commit it fails by reproducing the real Claude missing-conversation resume result, and after implementation it passes while asserting stale-marker deletion and fresh no-resume relaunch.
- Codex and opencode missing-session diagnostics are recorded from verification; only diagnostics actually verified are incorporated into their stale-session detectors and covered by focused tests where code changes.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` complete successfully on the final tree without focused or bare skipped tests.

## Risks and Assumptions
- Assumption: a Claude missing-conversation result is recoverable only when the failed launch was attempting to resume a stored session; fresh-launch failures must retain their existing handling.
- Risk: an overly broad error pattern could mask genuine launch failures. Match the verified missing-session diagnostics narrowly and retain regression coverage for ordinary exit-1 failures.
- Risk: Codex and opencode may emit different diagnostics by version or transport. Do not change their detectors without directly verified messages.
- Risk: marker deletion must target only the failed agent/mission/phase marker so another active session marker is not removed.

## Checkpoints
- CP 1: Author a failing reproduction in `test/claude.test.ts` before any fix. Simulate a Claude launch resumed from a stored marker whose stdout or stderr reports `No conversation found with session ID: <id>`; assert at the parent commit that the test is red because the marker is not removed and the same agent is not relaunched fresh without `--resume`. Preserve that assertion as the green regression test after the fix.
Reproduction-Test: test/claude.test.ts
- CP 2: Implement the narrowly scoped Claude detector and recovery path, then extend shared launch-failure classification so the recognized stale-session resume result cannot persist an `AgentBlock`.
- CP 3: Verify Codex and opencode real missing-session diagnostics, make only evidence-supported alignment changes, add focused coverage for every changed adapter, and run the required gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Lead each evidence row with durable evidence Parallix verifies today: exact test names, ADR references, test file paths such as `test/claude.test.ts`, and recognized repo commands or paths such as `./scripts/verify-local.sh all`, `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when needed, but are discouraged because line numbers rot.
- Use the exact heading `## Goal Check` followed by the exact 3-column table header `| Criterion | Evidence | Status |`.
- Include one evidence row for every Success Criterion and state whether it is PASS, FAIL, or BLOCKED.
- Raw `stat`/`ls` output or generic prose alone is not sufficient evidence; if included, pair it with an accepted command, path, exact test name, or ADR reference above.
- Summarize the work done and end with a concrete `Next action:` line.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Claude stale-session regression is locked | `test/claude.test.ts`, exact reproduction test name | PASS |
| Fresh relaunch prevents a runtime block | exact shared-launch test name, `test/claude.test.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change agent quota, authentication, generic crash, or selection policy outside the recognized stale-session resume path.
- Do not modify runtime databases, historic session markers, or blocklist rows as part of the fix or tests.
- Do not broaden Codex or opencode detection without captured verification of their actual missing-session diagnostic.
- Do not add documentation changes unless the supported operator-visible behavior or its durable rationale changes.

## Stop Rules
- Stop and obtain direction if reproducing the Claude message requires a real CLI account, network access, or a non-mocked external agent session; unit tests must remain mocked and must not contact real Forgejo or agents.
- Stop before changing Codex or opencode if their missing-session diagnostic cannot be verified or differs by unsupported versions; record the finding and leave that adapter unchanged.
- Stop and escalate if making the stale-session result non-blocking would also suppress blocklisting for fresh launches, authentication failures, quota failures, or unrelated exit-1 results.
- Stop and investigate before proceeding if the reproduction test does not fail at the mission parent commit or if marker deletion cannot be scoped to the precise Claude resume marker.
