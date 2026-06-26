---
event_type: reviewer_findings
timestamp: 2026-06-26T21:03:56.606Z
round: 2
phase: reviewing
actor: custom
slug: task-1353
---

# Task-1353 Review Findings (Round 2)

## Scope and Acceptance Criteria

All five success criteria are satisfied by the current diff:

| # | Criterion | Status |
|---|-----------|--------|
| 1 | ESLint gate with 8 rules at `error` | IMPLEMENTED |
| 2 | Test-hygiene guard detects violations | IMPLEMENTED |
| 3 | TypeScript checkJs on target dirs | IMPLEMENTED |
| 4 | Gate runs before test suite, <10s avg | IMPLEMENTED (1.16s avg) |
| 5 | Opt-in per repo config, existing repos unaffected | IMPLEMENTED |

## Round 1 Findings — Resolution Status

### Finding 1 (Medium) — RESOLVED
**Issue:** `scripts/test-hygiene.sh:33` had overly broad `.skip` regex `'\.(skip)\s*\('` that matched `.skip(` outside test function call contexts.
**Fix verified:** Line 33 now reads `grep -n -E '(it|describe|test)\.(skip)\s*\(|\bxit\s*\(|\bfit\s*\('` — context-aware as required by the mission's Risk section. CP-3 adds a negative test confirming `config.skip(data)` does not trigger a false positive.

### Finding 2 (Low) — RESOLVED
**Issue:** `.eslintrc.cjs` omitted `parserOptions`, defaulting to `ecmaVersion: 2017` / `sourceType: "script"`.
**Fix verified:** `.eslintrc.cjs:6-9` now includes `parserOptions: { ecmaVersion: 2024, sourceType: "module" }`. CP-1 documents this with file:line evidence.

### Finding 3 (Low) — RESOLVED
**Issue:** `npx eslint` and `npx tsc` lacked `--yes` flag, risking interactive prompts in CI.
**Fix verified:** `scripts/verify-local.sh:19` uses `npx --yes eslint`, line 27 uses `npx --yes tsc`. CP-4 documents this with file:line evidence.

### Finding 4 (Informational) — ADDRESSED
**Issue:** CP-5 runtime evidence cited only prose, not raw command output.
**Fix verified:** CP-5 now includes raw `time` output in a fenced code block (lines 7-27), showing `real`, `user`, and `sys` for each run.

## Final Checkpoint Claims vs Actual Diff

All five checkpoints contain Goal Check tables with file:line evidence, verified against current source files:

- **CP-1** (26 lines): `.eslintrc.cjs:8-15` confirms 8 rules; `.eslintrc.cjs:3-4` confirms `env`; `.eslintrc.cjs:6-9` confirms `parserOptions`. eslint in `package.json:54`. All verified.
- **CP-2** (30 lines): `tsconfig.json:3-14` confirms all compilerOptions and include arrays. typescript in `package.json:56`. All verified.
- **CP-3** (36 lines): `test-hygiene.sh:10-11` confirms `find` target; line 18 confirms `.only` regex; line 33 confirms context-aware `.skip`/`xit`/`fit` regex. Includes new negative test evidence (line 16 of Work Done, table row `No false positive on non-test .skip`). All verified.
- **CP-4** (29 lines): `verify-local.sh:19` confirms `npx --yes eslint`; line 27 confirms `npx --yes tsc`; line 35 confirms hygiene call. All verified.
- **CP-5** (46 lines): Raw `time` output in code block; average 1.16s under 10s target. All verified.

## New Findings (Round 2)

### Finding 5 — Low: ESLint 8.x is deprecated

**File:** `package.json:54`
**Value:** `"eslint": "^8.57.0"`

npm reports eslint 8.57.1 as deprecated: "This version is no longer supported." The `^8.57.0` range resolves to 8.57.1 (the last 8.x release). This is a devDependency and does not affect runtime, but it means the gate will start warning developers about the deprecation on every run.

**Recommendation:** Consider pinning to `^9.0.0` or documenting the deprecation as a known issue for follow-up. Not blocking — the gate works correctly with 8.x.

### Finding 6 — Informational: Dated review artifacts from round 1

**Files:** `missions/task-1353/2026-06-26T205940-reviewer_findings-1-custom.md`, `missions/task-1353/2026-06-26T205940-reviewer_outcome-1-custom.md`, `missions/task-1353/2026-06-26T205941-reviewer_outcome-1-unknown.md`

Round 1 review artifacts (findings, outcome) are persisted in dated subdirectories within the mission directory. These are historical records and do not affect the current review. No inconsistency detected — the `review-state.json` correctly shows round 2.

### Finding 7 — Informational: Task-1352 cleanup in diff

**Files removed:** `missions/task-1352/CP-1.md`, `missions/task-1352/MISSION.md`, `missions/task-1352/review-state.json`

The diff includes deletion of an unrelated task-1352 mission. This is outside the scope of task-1353 but does not introduce risk. No workflow inconsistency detected.

## Security and Unsafe Operations

- No secrets, credentials, or sensitive data in the diff.
- `npx --yes` flags are safe for dev tooling — no runtime impact.
- `set -euo pipefail` in all shell scripts — correct.
- No file writes, network calls (beyond `npx` registry resolution), or privilege escalation.
- `eslint@^8.57.0` and `typescript@^5.4.0` are standard dev tooling — no security concerns.

## Integration with Existing Code

- `scripts/verify-local.sh` — new `gate_static_analysis()` function and `static-analysis` case added alongside existing `docs` case. Default `*)` no-op behavior preserved at line 70-73. No regression risk.
- `package.json` — only `devDependencies` modified (lines 54, 56). No changes to `scripts.test` or any runtime dependency.
- `scripts/test-hygiene.sh` — new file, executable bit set. No conflicts with existing scripts.
- `lib/` files untouched — no logic changes to command handlers or adapters.
- `px.js`, `index.js`, `templates/` untouched — consistent with Restricted Areas.
- `npm test` script unchanged — consistent with Restricted Areas.

## Maintainability

- Gate structure (`gate_static_analysis()` with numbered stages) is clean and easy to extend.
- Each stage has clear PASS/FAIL output for debugging.
- The `static-analysis` subcommand is opt-in, keeping the default gate lightweight.
- ESLint and TypeScript are standard tooling — familiar to most developers.
- Context-aware `.skip` regex (Finding 1 fix) reduces false positives and improves maintainability.

## Workflow State Consistency

The `review-state.json` shows round 2, phase `reviewing`, disposition `null`. Round 1 artifacts are in dated subdirectories. This is consistent with a second-round review of the same task. No inconsistencies detected between workflow state, mission scope, or diff content.

---
`[workflow-round:2, workflow-phase:reviewing]`