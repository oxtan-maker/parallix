---
event_type: reviewer_outcome
timestamp: 2026-06-26T20:59:40.667Z
round: 1
phase: reviewing
actor: custom
slug: task-1353
verdict: request-changes
---

# Task-1353 Review Outcome

## Summary

Task-1353 adds a deterministic static-analysis pre-test gate (`ESLint + tsc --checkJs + test-hygiene`) to `scripts/verify-local.sh`. The diff introduces 4 new files (`.eslintrc.cjs`, `tsconfig.json`, `scripts/test-hygiene.sh`, `tsconfig.json`) and modifies 3 existing files (`scripts/verify-local.sh`, `package.json`, `package-lock.json`, `MISSION.md`). All five success criteria are satisfied. All five checkpoints contain Goal Check tables with file:line evidence.

## Verdict: request-changes

### Actionable Issues

1. **Finding 1 (Medium):** `scripts/test-hygiene.sh:33` — The `.skip` regex `'\.(skip)\s*\('` is overly broad. The mission's Risk section explicitly requires restricting the pattern to test function call contexts (`it(`, `describe(`, `test(`). The current implementation only restricts by file path. This could produce false positives on lines like `const result = config.skip(data)` inside test helpers. **Fix:** Narrow the regex to `(it|describe|test)\.(skip)\s*\(|\bxit\s*\(|\bfit\s*\(`.

2. **Finding 3 (Low):** `scripts/verify-local.sh:19,27` — `npx` calls lack `--yes` flag. In fresh clones or CI environments without `node_modules`, this could cause hangs or interactive prompts. **Fix:** Use `npx --yes eslint` and `npx --yes tsc`.

### Non-actionable Observations

- Finding 2 (ESLint `parserOptions` absent) — Benign given current project structure. Documented for awareness.
- Finding 4 (CP-5 evidence specificity) — Improvement suggestion, not blocking.

### Risk Assessment

- **Integration risk:** Low. No changes to runtime code, CLI entry points, `package.json` scripts, or existing gate behavior.
- **Regressions:** None detected. Default gate behavior (`./scripts/verify-local.sh` with no args) remains no-op.
- **Security:** Clean. No secrets, no unsafe operations.
- **Dependency risk:** `eslint@^8.57.0` is deprecated. Pinning to `^9.0.0` or documenting the deprecation is recommended but not blocking.

---
`[workflow-round:1, workflow-phase:reviewing]`