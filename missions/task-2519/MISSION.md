# Mission: Remove automatic CodeQL from local integration (task-2519)

## Goal
Stop Parallix's own local integration workflow from automatically running CodeQL, while preserving the manual `npm run test:codeql` security scan and every non-CodeQL integration gate.

## Why Now
The locally enforced CodeQL scan is correct but materially slows ordinary Parallix integration. It should remain available for deliberate security checks rather than block every local integration.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: remove two configuration entries, retain the manual SAST command, and lock the integration-plan contract with focused coverage.

## Scope
- Remove the `codeql` entry from `workflow.config.json` `adapters.gates.preIntegration`, the merge-gate authority used by `px integrate`.
- Remove the `codeql` entry from `config/integration-pipelines.json`, which supplies the standalone `./scripts/verify-local.sh integrate` sequence.
- Add or update focused repository-gate coverage proving the final pre-integration plan excludes `codeql` and retains `build`, `verification`, `integration-suite`, `workflow`, and `agent-smoke`.
- Verify that `npm run test:codeql` remains defined and that the affected local integration commands complete without invoking CodeQL.

## Out of Scope
- Removing `scripts/codeql-sast.sh`, the `test:codeql` package script, CodeQL suppressions, query configuration, or manual local CodeQL use.
- Changing the commands, order, or required status of `build`, `verification`, `integration-suite`, `workflow`, or `agent-smoke`.
- Changing remote CI, GitHub Code Scanning, review policy, merge ownership, or the general verification command.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `workflow.config.json` `adapters.gates.preIntegration` contains no gate whose key is `codeql` or command is `npm run test:codeql` and retains exactly the `build`, `verification`, `integration-suite`, `workflow`, and `agent-smoke` gates.
- `config/integration-pipelines.json` contains no `codeql` gate and retains its `build`, `integration-suite`, `workflow`, and `custom-agent-smoke` entries with their existing commands and ordering relationships.
- `package.json` continues to define `test:codeql` as `bash scripts/codeql-sast.sh`.
- Focused test coverage asserts that this repository's loaded `preIntegration` plan excludes `codeql` while retaining `build`, `verification`, `integration-suite`, `workflow`, and `agent-smoke`.
- `./scripts/verify-local.sh integrate` completes without executing `npm run test:codeql`.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` exit zero on the final tree.

## Risks and Assumptions
- `workflow.config.json` is the `px integrate` authority, while `config/integration-pipelines.json` feeds the standalone local integration verifier; both must agree or one integration path will still run CodeQL.
- Removing a configuration entry can accidentally alter neighbouring gate order or omit a required gate; focused plan assertions must enumerate the retained keys.
- The mission assumes manual CodeQL remains sufficient for deliberate local SAST runs. Stop if removing the automatic gate conflicts with a mandatory security policy.

## Checkpoints
- CP 1: Inspect the two integration configuration consumers and extend `test/repository-gates.test.ts` (or the existing nearest focused gate test) to assert that the repository plan has the five retained `preIntegration` gate keys and no `codeql` key. Record the exact test name and its result before and after the configuration edits.
- CP 2: Remove only the CodeQL gate entries from `workflow.config.json` and `config/integration-pipelines.json`; confirm `package.json` still exposes `npm run test:codeql` and that all retained commands and ordering relationships match the success criteria.
- CP 3: Run the declared gates, record whether `./scripts/verify-local.sh integrate` avoided `npm run test:codeql`, and complete the final Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Evidence led by durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- The exact heading `## Goal Check` followed by the 3-column table `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion, citing `test/repository-gates.test.ts`, the exact focused test name, `workflow.config.json`, `config/integration-pipelines.json`, `package.json`, `./scripts/verify-local.sh integrate`, `./scripts/verify-local.sh static-analysis`, or `./scripts/verify-local.sh all` as applicable. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair shell output with an accepted command, exact test name, ADR reference, or test file path above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Repository integration plan excludes CodeQL | `test/repository-gates.test.ts`, exact focused test name | PASS |
| Manual CodeQL command remains available | `package.json`, `npm run test:codeql` | PASS |
| Final integration path ran without CodeQL | `./scripts/verify-local.sh integrate` | PASS |

## Gates
- [ ] npm test -- --unit-test-headroom
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh integrate
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not remove or weaken `npm run test:codeql`, `scripts/codeql-sast.sh`, its query suite, suppressions, or manual execution behavior.
- Do not remove, rename, reorder, or alter the commands of retained integration gates.
- Do not change source code, remote CI, review policy, repository remotes, or integration ownership flow.

## Stop Rules
- Stop and request direction if repository policy requires CodeQL to remain an unconditional pre-integration gate.
- Stop if removing the two entries would remove or change any retained gate, its command, or its ordering relationship.
- Stop if proving the integration path avoids CodeQL requires deleting or disabling the manual `npm run test:codeql` command.
