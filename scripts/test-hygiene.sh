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
done < <(find "$test_dir" \( -name '*.test.js' -o -name '*.test.ts' \) -print0 2>/dev/null)

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
done < <(find "$test_dir" \( -name '*.test.js' -o -name '*.test.ts' \) -print0 2>/dev/null)

# Inode usage guard: fail if /tmp inode usage is at or above 80%.
# This catches temp-directory leaks that exhaust the tmpfs inode table.
# Portable parsing: GNU df -i has IUse% in field 5; BSD/macOS has %iused in field 8.
INODE_THRESHOLD=80
if command -v df >/dev/null 2>&1; then
  DF_OUTPUT=$(df -i /tmp 2>/dev/null || true)
  if [ -n "$DF_OUTPUT" ]; then
    # Detect format from header line
    DF_HEADER=$(echo "$DF_OUTPUT" | head -1)
    if echo "$DF_HEADER" | grep -q '%iused'; then
      # BSD/macOS: Filesystem 512-blocks Used Available Capacity iused ifree %iused Mounted
      INODE_PCT=$(echo "$DF_OUTPUT" | awk 'NR==2 {gsub(/%/, "", $8); print $8}')
    else
      # GNU/Linux: Filesystem Inodes IUsed IFree IUse% Mounted
      INODE_PCT=$(echo "$DF_OUTPUT" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
    fi
    if [ -n "$INODE_PCT" ] && [ "$INODE_PCT" -ge "$INODE_THRESHOLD" ] 2>/dev/null; then
      echo "FAIL: /tmp inode usage is ${INODE_PCT}% (threshold: ${INODE_THRESHOLD}%)"
      echo "  Stale temp directories may be exhausting the tmpfs inode table."
      echo "  Run: find /tmp -maxdepth 1 -name 'parallix-test-*' -type d | head -20"
      errors=$((errors + 1))
    fi
  fi
fi

if [ "$errors" -gt 0 ]; then
  echo "FAIL: $errors test-hygiene violation(s) found"
  exit 1
fi

echo "PASS: no test-hygiene violations"
exit 0
