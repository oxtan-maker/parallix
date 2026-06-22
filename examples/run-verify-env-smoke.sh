#!/usr/bin/env bash
# run-verify-env-smoke.sh — prove the provisional px runner from inside a
# caller-supplied temporary target repo. No fixed workstation paths.
#
# Usage: ./run-verify-env-smoke.sh [parallix-workflow-dir]
#   parallix-workflow-dir defaults to the directory containing this example's
#   px.js (one level up from examples/).

set -euo pipefail

EXAMPLES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARALLIX_DIR="$(cd "${1:-${EXAMPLES_DIR}/..}" && pwd)"
PX="${PARALLIX_DIR}/px.js"

if [[ ! -f "${PX}" ]]; then
  echo "FAIL: px.js not found at ${PX}" >&2
  exit 1
fi

# Caller-supplied target repo: a throwaway directory, never a fixed OS path.
TARGET_REPO="$(mktemp -d "${TMPDIR:-/tmp}/parallix-example-target.XXXXXX")"
cleanup() { rm -rf "${TARGET_REPO}"; }
trap cleanup EXIT

echo "parallix dir: ${PARALLIX_DIR}"
echo "Target repo : ${TARGET_REPO}"
echo "Running from target repo: node px.js verify-env"

(
  cd "${TARGET_REPO}"
  node "${PX}" verify-env
)
STATUS=$?

if [[ "${STATUS}" -eq 0 ]]; then
  echo "PASS: verify-env exited 0 against the temporary target repo"
else
  echo "FAIL: verify-env exited ${STATUS}" >&2
fi
exit "${STATUS}"
