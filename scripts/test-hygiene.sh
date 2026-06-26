#!/usr/bin/env bash
# test-hygiene.sh — scan test files for .only, unannotated .skip/xit/fit
# Exits 0 when clean, non-zero on violation.

set -euo pipefail

test_dir="test"
errors=0

# Check for .only patterns: it.only, describe.only, test.only
while IFS= read -r -d '' file; do
  while IFS= read -r -d '' line_match; do
    lineno=$(echo "$line_match" | cut -d: -f1)
    content=$(echo "$line_match" | cut -d: -f2-)
    echo "VIOLATION: .only found in $(basename "$file"):$lineno"
    echo "  $content"
    errors=$((errors + 1))
  done < <(grep -n -E '(it|describe|test)\.only\s*\(' "$file" 2>/dev/null | tr '\n' '\0' || true)
done < <(find "$test_dir" -name '*.test.js' -print0 2>/dev/null)

# Check for .skip, xit, fit without inline annotated reason
while IFS= read -r -d '' file; do
  while IFS= read -r -d '' line_match; do
    lineno=$(echo "$line_match" | cut -d: -f1)
    content=$(echo "$line_match" | cut -d: -f2-)
    # Skip lines that have skip-reason: or reason: in an inline comment
    if echo "$content" | grep -qE '(skip-reason:|reason:)'; then
      continue
    fi
    echo "VIOLATION: unannotated skip/xit/fit found in $(basename "$file"):$lineno"
    echo "  $content"
    errors=$((errors + 1))
  done < <(grep -n -E '(it|describe|test)\.(skip)\s*\(|\bxit\s*\(|\bfit\s*\(' "$file" 2>/dev/null | tr '\n' '\0' || true)
done < <(find "$test_dir" -name '*.test.js' -print0 2>/dev/null)

if [ "$errors" -gt 0 ]; then
  echo "FAIL: $errors test-hygiene violation(s) found"
  exit 1
fi

echo "PASS: no test-hygiene violations"
exit 0
