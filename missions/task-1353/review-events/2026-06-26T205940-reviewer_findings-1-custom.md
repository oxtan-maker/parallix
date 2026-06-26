---
event_type: reviewer_findings
timestamp: 2026-06-26T20:59:40.666Z
round: 1
phase: reviewing
actor: custom
slug: task-1353
---

# Task-1353 Review Findings

## Scope and Acceptance Criteria

The mission adds a deterministic static-analysis pre-test gate to `scripts/verify-local.sh` consisting of three stages: ESLint on `lib/**/*.js`, `tsc --checkJs --noEmit` on `lib/core` and `lib/commands`, and a test-hygiene scanner for `.only`/unannotated `.skip`/`xit`/`fit`.

All five success criteria are addressed by the diff:

| # | Criterion | Status |
|---|-----------|--------|
| 1 | ESLint gate with 8 rules at `error` | IMPLEMENTED |
| 2 | Test-hygiene guard detects violations | IMPLEMENTED (see Finding 2) |
| 3 | TypeScript checkJs on target dirs | IMPLEMENTED |
| 4 | Gate runs before test suite, <10s avg | IMPLEMENTED (1.16s avg) |
| 5 | Opt-in per repo config, existing repos unaffected | IMPLEMENTED |

## Final Checkpoint Claims vs Actual Diff

All five checkpoint documents (CP-1 through CP-5) contain Goal Check tables with file:line evidence. Verified against the diff:

- **CP-1**: `.eslintrc.cjs` contains all 8 required rules at `"error"` — confirmed at lines 7-14. Node.js env at lines 2-4 — confirmed. eslint in devDependencies — confirmed at `package.json:54`.
- **CP-2**: `tsconfig.json` has `allowJs`, `checkJs`, `noEmit`, `strict`, `include` covering both dirs — confirmed at `tsconfig.json:3-13`. typescript in devDependencies — confirmed.
- **CP-3**: `scripts/test-hygiene.sh` scans `test/**/*.test.js` for `.only` and unannotated `.skip`/`xit`/`fit` — confirmed at lines 11-34.
- **CP-4**: `gate_static_analysis()` runs all three stages sequentially, `static-analysis` case in case statement — confirmed at `verify-local.sh:14-43, 66-69`.
- **CP-5**: Runtime measured at 1.16s average over 3 runs — confirmed claim is well under 10s target.

## Finding 1 — Medium: Test-hygiene `.skip` regex is overly broad

**File:** `scripts/test-hygiene.sh:33`
**Pattern:** `grep -n -E '\.(skip)\s*\('`

The `.skip` regex matches `.skip(` anywhere in a line, not only within test function call contexts. The mission's Risk section (paragraph 3) explicitly states: "Mitigation: restrict the scan to `test/**/*.test.js` files only **and use a line-level regex that requires the pattern to appear inside an `it(`, `describe(`, or `test(` call context.**" The current implementation only restricts by file path, not by call context.

**Impact:** False positives are unlikely in practice (`.skip(` is rare outside test APIs), but a line like `const result = config.skip(data)` inside a test helper would trigger a violation.

**Recommendation:** Narrow the regex to match only `it\.skip(`, `describe\.skip(`, `test\.skip(`, `xit(`, and `fit(`. Alternatively, use a broader context check: `grep -n -E '(it|describe|test)\.(skip)\s*\(|\bxit\s*\(|\bfit\s*\('`.

## Finding 2 — Low: ESLint `parserOptions` absent

**File:** `.eslintrc.cjs`

The configuration sets `env: { node: true, es2024: true }` but omits `parserOptions`. Without `sourceType` or `ecmaVersion`, ESLint defaults to `script` mode with `ecmaVersion: 2017`. Since the project targets ES2024 (per `tsconfig.json:9`), this mismatch is benign — Node.js globals are covered by `env.node: true`, and modern syntax in `lib/` won't be misparsed by ESLint's conservative defaults. However, it is technically incomplete.

**Recommendation:** Add `parserOptions: { ecmaVersion: 2024, sourceType: "module" }` to avoid silent mismatches if the project ever uses top-level await or ES modules in `lib/`.

## Finding 3 — Low: `npx` used without `--yes` flag in gate

**File:** `scripts/verify-local.sh:19, 27`

The gate uses `npx eslint` and `npx tsc` without `--yes`. If `node_modules/.bin/eslint` or `tsc` are not present locally (fresh clone, missing `npm install`), `npx` will prompt or download from the registry. In CI or automation contexts, this could cause hangs or unexpected network calls.

**Recommendation:** Use `npx --yes eslint` and `npx --yes tsc` to ensure non-interactive behavior.

## Finding 4 — Informational: CP-5 evidence could be more specific

**File:** `missions/task-1353/CP-5.md`

The runtime evidence cites `verify-local.sh:13-37` (line range of the function) rather than concrete command outputs. The actual timings (1.229s, 1.121s, 1.132s) are stated in prose but not embedded as verbatim command output. This makes the evidence harder to independently verify.

**Recommendation:** Include the raw `time ./scripts/verify-local.sh static-analysis` output in the checkpoint for auditability.

## Security and Unsafe Operations

- No secrets, credentials, or sensitive data exposed in the diff.
- `npx` calls are dev-only and do not affect runtime behavior.
- `set -euo pipefail` is used in all shell scripts — correct.
- No file writes, network calls (beyond `npx` registry resolution), or privilege escalation.
- `eslint@^8.57.0` is deprecated (8.57.1 is end-of-life per npm notice). Consider pinning to `^9.0.0` or documenting the deprecation.

## Integration with Existing Code

- `scripts/verify-local.sh` — new `gate_static_analysis()` function and `static-analysis` case added alongside existing `docs` case. Default `*)` no-op behavior preserved. No regression risk.
- `package.json` — only `devDependencies` modified. No changes to `scripts.test` or any runtime dependency.
- `scripts/test-hygiene.sh` — new file, executable bit set. No conflicts with existing scripts.
- `lib/` files untouched — no logic changes to command handlers or adapters.
- `px.js`, `index.js`, `templates/` untouched — consistent with Restricted Areas.

## Maintainability

- Gate structure (`gate_static_analysis()` with numbered stages) is clean and easy to extend.
- Each stage has clear PASS/FAIL output for debugging.
- The `static-analysis` subcommand is opt-in, keeping the default gate lightweight.
- ESLint and TypeScript are standard tooling — familiar to most developers.

## Workflow State Consistency

The `review-state.json` shows round 1, phase `reviewing`, disposition `null`. This is consistent with a first-round review. No inconsistencies detected between workflow state, mission scope, or diff content.

---
`[workflow-round:1, workflow-phase:reviewing]`