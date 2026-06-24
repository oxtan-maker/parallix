#!/usr/bin/env bash
# verify-local.sh — local development verification gate
# Usage: ./scripts/verify-local.sh <subcommand>
# Subcommands:
#   docs    — verify documentation completeness
#   (none)  — no-op (default gate behavior)

set -euo pipefail

subcommand="${1:-}"

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
  *)
    # Default: no-op gate pass
    exit 0
    ;;
esac
