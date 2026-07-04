# CP-3: End-to-end test confirming MISSION.md with invalid gate produces validation-failed error

## Summary

Performed end-to-end testing to confirm that:
1. A MISSION.md with an invalid gate command (non-existent file reference) produces a `validation-failed` error during handoff
2. A MISSION.md with all-valid gates proceeds through normal execution

## Round 1 Fix (Reviewer: claude, REQUEST_CHANGES)

The original CP-3 "end-to-end" testing only exercised the mission's own two gates (`./scripts/verify-local.sh docs`, `./scripts/verify-local.sh static-analysis`) plus synthetic single-line examples. The reviewer correctly identified this as insufficient — no test used the kind of complex/prose gate text that already exists in the repo's mission corpus.

After fixing the validator (CP-1), all 12 regression tests using realistic gate text now pass, confirming no false positives on:
- Glob patterns: `test/*.test.js`
- Directory references with trailing slashes: `lib/agents/`
- Apostrophes inside double-quoted strings: `echo "it's a test"`
- Escaped quotes: `echo "say \"hi\" to me"`
- Multi-clause prose: `npm run prepublishOnly && npm pack --dry-run 2>&1 | grep -q 'lib/agents/'`

## End-to-End Test 1: Invalid Gate Command

Created a test MISSION.md with a non-existent file reference:
```markdown
## Gates
- [ ] ./scripts/nonexistent.sh
```

Result: `runDeclaredGates` returned:
```json
{
  "ok": false,
  "reason": "validation-failed",
  "error": "Gate command references non-existent file: \"./scripts/nonexistent.sh\" in command \"./scripts/nonexistent.sh\"",
  "gate": "./scripts/nonexistent.sh"
}
```

**Status: PASS** - Validation correctly caught the non-existent file and returned `validation-failed` reason.

## End-to-End Test 2: Syntax Error in Gate Command

Created a test MISSION.md with unclosed quotes:
```markdown
## Gates
- [ ] echo 'unclosed
```

Result: `runDeclaredGates` returned:
```json
{
  "ok": false,
  "reason": "validation-failed",
  "error": "Gate command has unclosed single quotes: \"echo 'unclosed\"",
  "gate": "echo 'unclosed"
}
```

**Status: PASS** - Validation correctly detected syntax error and returned `validation-failed` reason.

## End-to-End Test 3: Valid Gate Commands

Created a test MISSION.md with valid gate commands:
```markdown
## Gates
- [ ] echo hello
- [ ] true
```

Result: `runDeclaredGates` returned:
```json
{
  "ok": true,
  "skipped": false,
  "count": 2,
  "reason": "all-gates-passed"
}
```

**Status: PASS** - Valid gates passed validation and executed successfully.

## End-to-End Test 4: Mixed Valid and Invalid Gates

Created a test MISSION.md with mixed gates:
```markdown
## Gates
- [ ] echo hello
- [ ] ./scripts/nonexistent.sh
```

Result: `runDeclaredGates` returned:
```json
{
  "ok": false,
  "reason": "validation-failed",
  "error": "Gate command references non-existent file: \"./scripts/nonexistent.sh\" in command \"./scripts/nonexistent.sh\"",
  "gate": "./scripts/nonexistent.sh"
}
```

**Status: PASS** - Validation failed on the first invalid command as expected.

## End-to-End Test 5: Realistic Historical Gate Text (Round 1 Regression)

Tested against gate commands actually found in the repo's mission history:

| Gate Command | Result |
|---|---|
| `All 108+ tests in \`test/*.test.js\` pass via \`npm test\`` | PASS (glob pattern not flagged) |
| `npm run prepublishOnly && npm pack --dry-run 2>&1 \| grep -q 'lib/agents/'` | PASS (quoted dir ref not flagged) |
| `echo "it's a test"` | PASS (apostrophe in double quotes not flagged) |
| `echo "it's Bob's test"` | PASS (multiple apostrophes OK) |
| `./scripts/verify-local.sh static-analysis && echo "All checks passed"` | PASS (multi-clause OK) |
| `./scripts/verify-local.sh docs --verbose` | PASS (valid path + args OK) |
| `echo "say \"hi\" to me"` | PASS (escaped quotes OK) |

## Round 3 Fix (Reviewer: claude, REQUEST_CHANGES)

The original test suite hardcoded `rootDir = '/home/magnus/code/parallix-task-1386'` — the reviewer's absolute filesystem path — in all 23 new `validateDeclaredGates` tests. This made tests non-portable: they would fail in CI or on any machine where that path doesn't exist, and even when they "passed" they checked file existence against a different directory than the code under test.

Fix: replaced all 23 occurrences with `path.join(__dirname, '..')` to derive the repo root relative to the test file's location, consistent with the rest of the test suite.

## Round 4 Fix (Reviewer: claude, REQUEST_CHANGES)

The `mission/task-1386` branch was cut from an old point in history and was never rebased onto main after the `task-1269` mission landed a fix for backtick/em-dash handling in `runDeclaredGates` (commits `9cda8717`/`0c220abb`). That fix — stripping surrounding backticks and trailing em-dash descriptions from gate command lines — was absent from this branch. Integrating the branch as-is would silently revert it, reintroducing a bug where gate lines like `` `npm run typecheck` — zero errors `` fail with confusing shell errors (backticks trigger bash command substitution, em-dash text parsed as shell redirect).

Fix: restored the em-dash/backtick stripping logic in `runDeclaredGates` command extraction (lines 580-586 of handoff.ts), and added 4 regression tests asserting the pattern parses and executes correctly:
- `` `npm run typecheck` — zero errors `` → bare command executes
- `true — some description` → stripped and executes
- `echo hello -– brief note` → en-dash stripped and executes
- `` `true` — all good `` → full pipeline: strip → validate → pass

## Mission Gates Verification

Verified that the mission's declared gates pass:
- `./scripts/verify-local.sh docs` - PASS: all required documentation present
- `./scripts/verify-local.sh static-analysis` - PASS: ESLint clean, tsc typecheck clean, test-hygiene clean

## Files Modified

- `lib/commands/handoff.ts`: Complete implementation with validation
- `lib/commands/handoff.js`: Compiled JavaScript output
- `test/handoff.test.js`: Comprehensive test suite (28 new tests: 24 validation + 4 backtick/em-dash regression)
- `missions/task-1386/CP-1.md`: Checkpoint 1 documentation
- `missions/task-1386/CP-2.md`: Checkpoint 2 documentation

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| `validateDeclaredGates` function exists with `(commands, rootDir)` parameters | lib/commands/handoff.ts:435-544 | PASS |
| Returns `{ ok: false, reason: 'validation-failed', error, gate }` for non-existent file paths | lib/commands/handoff.ts:530-538, test/handoff.test.js:1139-1146 | PASS |
| Returns `{ ok: false, reason: 'validation-failed', error, gate }` for syntax errors | lib/commands/handoff.ts:437-501, test/handoff.test.js:1148-1189 | PASS |
| `runDeclaredGates` calls `validateDeclaredGates` before executing any gate command | lib/commands/handoff.ts:567-570 | PASS |
| `validation-failed` results are propagated without executing further commands | lib/commands/handoff.ts:567-570, test/handoff.test.js:1223-1237 | PASS |
| Existing `runDeclaredGates` tests (lines 841-1115) continue to pass | test/handoff.test.js:841-1123 (11 tests pass) | PASS |
| New unit tests cover valid gates pass, missing file path fails, syntax error fails, mixed valid/invalid gates | test/handoff.test.js:1130-1370 (24 tests) | PASS |
| End-to-end: MISSION.md with invalid gate produces `validation-failed` error | Test results above | PASS |
| End-to-end: MISSION.md with all-valid gates proceeds through normal execution | Test results above | PASS |
| End-to-end: No false positives on historical mission gate text | 12 regression tests all pass | PASS |
| Backtick/em-dash gate-line stripping preserved | 4 new regression tests (test/handoff.test.js:1359-1426) | PASS |
| Static-analysis gate passes | ./scripts/verify-local.sh static-analysis: all stages clean | PASS |

All checkpoints complete. Ready for re-review.
