# CP-3: Test-Hygiene Scanner

## Work Done

1. Created `scripts/test-hygiene.sh` that:
   - Scans `test/**/*.test.js` for `it.only`, `describe.only`, `test.only` patterns → fails gate
   - Scans for `.skip`, `xit`, `fit` without inline comment containing `skip-reason:` or `reason:` → fails gate
   - Uses context-aware regex `(it|describe|test)\.(skip)\s*\(|\bxit\s*\(|\bfit\s*\(` to avoid false positives on non-test `.skip` calls (e.g., `config.skip(data)`)
   - Exits 0 when no violations exist
2. Made script executable (`chmod +x`)
3. Verified clean baseline: `bash scripts/test-hygiene.sh` → PASS (0 violations in current test suite)
4. Positive test: inserted `it.only('should fail', ...)` → detected, exit 1
5. Positive test: inserted `describe.skip(...)` without annotation → detected, exit 1
6. Positive test: inserted `xit('should fail', ...)` → detected, exit 1
7. Positive test: inserted `describe.skip(...); // skip-reason: testing` → allowed, exit 0
8. Negative test: inserted `const result = config.skip(data)` → NOT flagged, exit 0 (false positive avoidance)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Scans `test/**/*.test.js` | `test-hygiene.sh:10-11` — `find "$test_dir" -name '*.test.js' -print0` |
| Detects `it.only`/`describe.only`/`test.only` | `test-hygiene.sh:13` — `grep -n -E '(it|describe|test)\.only\s*\('` |
| Detects `.skip` without annotation in test context | `test-hygiene.sh:33` — `grep -n -E '(it|describe|test)\.(skip)\s*\(|\bxit\s*\(|\bfit\s*\('` |
| Detects `xit` without annotation | `test-hygiene.sh:33` — `\bxit\s*\(` |
| Detects `fit` without annotation | `test-hygiene.sh:33` — `\bfit\s*\(` |
| Allows annotated skip with `skip-reason:`/`reason:` | `test-hygiene.sh:27` — checks inline comment for `(skip-reason:|reason:)` |
| Exits 0 on clean suite | Verified: `bash scripts/test-hygiene.sh` → exit 0, "PASS: no test-hygiene violations" |
| Exits non-zero on `.only` | Verified: inserted `it.only(...)`, exit 1, "VIOLATION: .only found" |
| Exits non-zero on `.skip` without reason | Verified: inserted `describe.skip(...)`, exit 1, "VIOLATION: unannotated skip/xit/fit" |
| Exits non-zero on `xit` | Verified: inserted `xit(...)`, exit 1, "VIOLATION: unannotated skip/xit/fit" |
| Exits 0 on annotated skip | Verified: inserted `describe.skip(...); // skip-reason: testing`, exit 0 |
| No false positive on non-test `.skip` | Verified: inserted `config.skip(data)`, exit 0, no violation |

## Next action
CP-4: Add `gate_static_analysis()` to `verify-local.sh`, register `static-analysis` area in case statement, all three stages run sequentially
