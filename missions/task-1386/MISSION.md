# Mission: Validate declared mission gates are executable commands before handoff (task-1386)

## Goal

Add pre-validation of declared gate commands in MISSION.md's `## Gates` section so that invalid commands (missing file references, obviously malformed syntax) are caught and reported with a distinct failure reason before any gate command is executed. This prevents the confusing shell errors that currently obscure whether a gate failure is a configuration error (bad command) or a genuine code issue (gate logic broke).

## Why Now

Currently `runDeclaredGates` in `lib/commands/handoff.ts:433-487` executes each gate line directly via `spawnSync('bash', ['-c', cmd])` with no pre-validation. When a gate command references a non-existent file or has obvious syntax issues, the shell error is indistinguishable from a genuine gate failure (e.g., a lint error or test failure). This wastes reviewer cycles and implementer time because the root cause is not immediately visible. ADR 0048 classifies this as Control C4 — "Declared-gate pre-validation (syntax + file existence)" — with low complexity and low risk. It is sequenced after C1-C3 (TASK-1385/1387/1389) because those close larger fail-open paths first, but it is explicitly in backlog and not deferred.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR 0048 C4 classification (low complexity, low risk), clear code seam at `runDeclaredGates` in handoff.ts, existing handoff.test.js has extensive runDeclaredGates tests that provide a safe integration surface

## Scope

- Add a `validateDeclaredGates` function in `lib/commands/handoff.ts` that performs pre-validation on gate commands before execution
- File-existence checks: for any file path appearing in a gate command (e.g., `./scripts/verify-local.sh static-analysis`), check that the file exists at the expected location relative to `rootDir`
- Basic syntax checks: detect obviously broken commands such as single tokens with no arguments that are not valid shell builtins (e.g., `nonexistent-binary`), unclosed quotes, unmatched parentheses
- Integrate pre-validation into `runDeclaredGates` so it runs before any gate command is executed via `spawnSync`
- Return a distinct failure reason (`validation-failed`) from the existing `gate-failed` reason so callers can distinguish the two
- Produce clear error messages that identify the specific gate command and the validation issue (file not found vs. syntax error)
- Add unit tests in `test/handoff.test.js` covering: valid gates pass validation, invalid file paths fail validation with correct reason, invalid syntax fails validation, mixed valid/invalid gates fail on the first invalid command

## Out of Scope

- Auto-send-back with fix instructions (covered by TASK-1387)
- Error classifier and dispatch table replacing `repair-handoff.ts` binary classification (covered by TASK-1389)
- Gate-failure auto-send-back with captured output (covered by TASK-1387)
- Pre-review-round gate enforcement (covered by TASK-1385)
- Changing the `## Gates` section parsing logic beyond adding pre-validation
- Modifying `repair-handoff.ts` or any other handoff phase
- Changing gate execution semantics, exit codes, or the `skipGate` flag behavior

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various").

- `validateDeclaredGates` function exists in `lib/commands/handoff.ts` and accepts `(commands, rootDir)` parameters, returning `{ ok: boolean, reason: string, error?: string, gate?: string }`
- When a gate command references a non-existent file path, `validateDeclaredGates` returns `{ ok: false, reason: 'validation-failed', error: <message containing the command and file path>, gate: <the command> }`
- When a gate command has obviously malformed syntax (unclosed quotes, unmatched parentheses), `validateDeclaredGates` returns `{ ok: false, reason: 'validation-failed', error: <message containing the command and issue type>, gate: <the command> }`
- `runDeclaredGates` calls `validateDeclaredGates` before executing any gate command via `spawnSync`, and propagates `validation-failed` results without executing further commands
- Existing `runDeclaredGates` tests in `test/handoff.test.js` (lines 841-1115) continue to pass after the change, confirming backward compatibility
- New unit tests cover at minimum: (1) valid gates pass validation, (2) missing file path fails with `validation-failed` reason, (3) syntax error fails with `validation-failed` reason, (4) mixed valid/invalid gates fail on first invalid command

## Risks and Assumptions

- **Risk:** Overly aggressive syntax validation could flag legitimate commands as invalid (false positives). Mitigation: keep syntax checks minimal — only catch obviously broken patterns (unclosed quotes, unmatched parens) rather than attempting full shell parsing.
- **Risk:** File-existence checks may fail for commands that generate files dynamically. Mitigation: only check file paths that appear as literal arguments in the command string, not output paths or generated artifacts.
- **Assumption:** Gate commands follow the documented format — each line in `## Gates` is a shell command string, parsed by stripping checkbox prefixes.
- **Assumption:** The existing `runDeclaredGates` caller in `performHandoff` (handoff.ts:348) will correctly propagate the new `validation-failed` reason through the existing error handling path.
- **Assumption:** The `validation-failed` reason string does not conflict with any existing pattern matching in downstream consumers (e.g., repair-handoff.ts error classifiers).

## Checkpoints

- CP 1: Implement `validateDeclaredGates` function with file-existence and basic syntax checks, with unit tests proving it returns `validation-failed` for invalid inputs and passes for valid commands
- CP 2: Integrate `validateDeclaredGates` into `runDeclaredGates` so validation runs before execution, and confirm that `validation-failed` results are propagated with distinct error messages
- CP 3: End-to-end test confirming that a MISSION.md with an invalid gate command (e.g., referencing a non-existent file) produces a `validation-failed` error during handoff, and that a MISSION.md with all-valid gates proceeds through normal execution

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas

- Do not modify `lib/commands/repair-handoff.ts` — error classification is covered by TASK-1389
- Do not change gate execution semantics, exit codes, or the `skipGate` flag behavior
- Do not modify the `## Gates` section Markdown parsing logic in `runDeclaredGates` (lines 443-457 of handoff.ts) beyond adding the pre-validation call
- Do not add new dependencies or modify `package.json`

## Stop Rules

- If pre-validation introduces false positives on legitimate gate commands used in existing missions, stop and reassess the validation scope
- If the validation logic grows beyond approximately 80 lines of new code, simplify the approach
- If existing handoff tests fail and cannot be fixed with test updates alone, stop and escalate
