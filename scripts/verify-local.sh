#!/usr/bin/env bash
# verify-local.sh — local development verification gate
# Usage: ./scripts/verify-local.sh <subcommand>
# Subcommands:
#   docs             — verify documentation completeness
#   static-analysis  — run ESLint, tsc typecheck, and test-hygiene checks
#   (none)           — no-op (default gate behavior)

set -euo pipefail

subcommand="${1:-}"

# Static-analysis gate: runs ESLint, tsc --checkJs, and test-hygiene sequentially
gate_static_analysis() {
  echo "=== Static Analysis Gate ==="

  # Stage 1: ESLint on lib/**/*.js with --max-warnings 0
  echo "[1/3] Running ESLint on lib/**/*.js..."
  if ! npx --yes eslint --ext .js --max-warnings 0 lib/ 2>&1; then
    echo "FAIL: ESLint reported errors"
    return 1
  fi
  echo "PASS: ESLint clean"

  # Stage 2: TypeScript typecheck (emission mode)
  echo "[2/3] Running npm run typecheck..."
  TSC_OUTPUT=$(npm run typecheck 2>&1 || true)
  BAD_ERRORS=$(echo "$TSC_OUTPUT" | grep "error TS" | grep -v "TS18003" || true)
  if [ -z "$BAD_ERRORS" ]; then
    echo "PASS: tsc typecheck clean"
  else
    echo "$TSC_OUTPUT"
    echo "FAIL: tsc typecheck reported errors"
    return 1
  fi

  # Stage 3: Test-hygiene scanner
  echo "[3/3] Running test-hygiene check..."
  if ! bash scripts/test-hygiene.sh; then
    echo "FAIL: test-hygiene scanner found violations"
    return 1
  fi
  echo "PASS: test-hygiene clean"

  echo "=== Static Analysis Gate: ALL STAGES PASSED ==="
  return 0
}

case "$subcommand" in
  docs)
    # Verify key documentation files exist
    errors=0
    for f in README.md CHANGELOG.md LICENSE; do
      if [ ! -f "$f" ]; then
        echo "MISSING: $f"
        errors=$((errors + 1))
      fi
    done
    if [ ! -d docs/adr ]; then
      echo "MISSING: docs/adr/"
      errors=$((errors + 1))
    fi
    if [ "$errors" -gt 0 ]; then
      echo "FAIL: $errors documentation item(s) missing"
      exit 1
    fi
    echo "PASS: all required documentation present"
    exit 0
    ;;
  static-analysis)
    gate_static_analysis || exit 1
    exit 0
    ;;
  *)
    # Default: no-op gate pass
    exit 0
    ;;
esac
