# Mission: Preserve config-command failure exit status (task-2455.04)

## Goal
Make the `px config` process retain a non-zero exit status when configuration
validation fails, while retaining its current fallback configuration output.

## Why Now
Automation invoking `px config` currently receives success for malformed or
structurally invalid configuration even though the command reports an error.
That masks invalid configuration and makes command-level tests disagree with
the executable boundary users rely on.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one shared CLI exit-status assignment overwrites the config
  command's failure status; focused process-boundary coverage is required.

## Scope
- Add a process-boundary regression test under `test/` that runs `px config`
  from a temporary directory with malformed JSON and asserts a non-zero exit
  status.
- Extend that boundary coverage to a structurally invalid
  `workflow.config.json` and assert the same non-zero status.
- Change the CLI entry flow so a failure status set during config validation is
  not overwritten after `run()` resolves.
- Preserve the current diagnostic and fallback-output behavior for both
  invalid-configuration cases.

## Out of Scope
- Changing validation rules, fallback defaults, or the `px config` output
  format.
- Changing exit-status behavior for commands other than the status-overwrite
  path shared with `px config`.
- Documentation, configuration-schema, or dependency changes.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A process-boundary regression test proves that `px config` run with malformed
  `workflow.config.json` exits non-zero while still emitting its invalid-JSON
  diagnostic and fallback output.
- The same test coverage proves that `px config` run with structurally invalid
  `workflow.config.json` exits non-zero while retaining its validation
  diagnostic and fallback output.
- Existing config-command tests and the process-boundary tests assert the same
  non-zero failure outcome for both invalid-configuration scenarios.
- `./scripts/verify-local.sh all` succeeds on the completed mission tree.

## Risks and Assumptions
- Assumption: config validation intentionally emits fallback output after a
  failure; that behavior is contractual and must remain unchanged.
- Risk: preserving a pre-set `process.exitCode` in the entry flow could affect
  other commands that set it. Limit the change to retaining an existing
  non-zero status rather than altering successful-command status handling.
- Risk: subprocess tests can be slow or environment-sensitive. Reuse existing
  CLI process-test helpers and keep all external boundaries mocked where the
  established test pattern permits.

## Checkpoints
- CP 1: Author `test/task-2455-config-exit-status-repro.test.ts` before any
  production fix. From a temporary directory, invoke `px config` with a
  malformed `workflow.config.json` and with a structurally invalid one; assert
  each child process exits non-zero and retains its error and fallback output.
  These assertions must fail at the mission parent commit (red) because the
  real process exits zero, then pass once the fix lands (green).

Reproduction-Test: test/task-2455-config-exit-status-repro.test.ts

- CP 2: Trace all callers of the CLI entry status assignment, apply the
  smallest shared correction that retains config-validation failure status, and
  keep successful command completion behavior unchanged.
- CP 3: Run the repository verification gate and record criterion-by-criterion
  evidence in the final checkpoint.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST lead its evidence with durable
references Parallix verifies today: exact test names, ADR references, test file
paths, and recognized repository commands or paths such as `npm ...`, `node
...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when
needed but discouraged because line numbers rot.

Every checkpoint document MUST include a summary of work done, then the exact
heading `## Goal Check` and this 3-column table:

| Criterion | Evidence | Status |
|---|---|---|

Include at least one durable evidence reference per success criterion. Raw
`stat`/`ls` output or generic prose alone is not enough; pair any shell output
with an accepted command, path, test name, or ADR reference. End with a
non-generic `Next action:` line. For CP 1, record the red result using
`test/task-2455-config-exit-status-repro.test.ts`; for the final checkpoint,
record the green process-boundary result and `./scripts/verify-local.sh all`.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change validation semantics, fallback defaults, diagnostics, or the
  configuration schema.
- Do not add dependencies, modify authored documentation, or alter workflow
  lifecycle behavior outside the CLI exit-status path.
- Keep test work under `test/`; do not use real Forgejo or other external
  services from unit coverage.

## Stop Rules
- Stop and request direction if retaining an existing non-zero exit status
  changes a successful command's process result.
- Stop and request direction if malformed or structurally invalid configuration
  does not currently emit fallback output, because preserving that behavior
  would conflict with the mission premise.
- Stop and request direction if a process-boundary regression test cannot be
  made deterministic with the repository's established CLI test helpers.
