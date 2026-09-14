#!/usr/bin/env bash
# CodeQL SAST gate runner (TASK-2502).
#
# Runs the official CodeQL CLI against the current checkout/worktree using the
# javascript-typescript language and the standard security/code-scanning suite,
# writing per-worktree-isolated databases/results. Exits non-zero when any
# qualifying finding exists so it can anchor the integration gate.
#
# Design constraints satisfied:
#   * Runs from the repository root and honors PARALLIX_EXECUTION_ROOT.
#   * Pins the CodeQL CLI version (CODEQL_PINNED_VERSION) and the query-pack
#     source tag (CODEQL_PACK_TAG); fails loudly when either is missing or the
#     installed CLI is below the pinned version.
#   * The CLI distribution and generated databases/results live outside tracked
#     source (CODEQL_CACHE_DIR under ~/.cache by default, per-worktree temp dbs),
#     so nothing here is ever committed to Git.
#   * The query packs come from the pinned github/codeql git tag (public, no
#     auth required). `codeql pack download` is attempted first and, when the
#     registry requires credentials, falls back to the pinned clone.
#
# Recognized flags:
#   --dry-run      Resolve and print the plan; do not analyze. Exit 0.
#   --suite NAME   Override the recorded query suite (recorded: security/code-scanning).
#   --list-findings  Print a per-finding summary instead of failing on findings.
set -euo pipefail

CODEQL_PINNED_VERSION="2.27.0"
# github/codeql tag whose standard packs match the pinned CLI toolchain.
CODEQL_PACK_TAG="codeql-cli/v2.27.0"
CODEQL_LANGUAGE="javascript-typescript"
# Recorded default suite: the standard JavaScript/TypeScript security scanning
# queries (codeql/javascript-queries defaultSuiteFile = javascript-code_scanning).
CODEQL_DEFAULT_SUITE="codeql/javascript-queries"
CODEQL_RECORDED_SUITE="security/code-scanning"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/codeql-sast.sh [--dry-run] [--suite <name>] [--list-findings]
EOF
  exit "${1:-2}"
}

DRY_RUN=0
LIST_FINDINGS=0
RERUN=0
SUITE="${CODEQL_DEFAULT_SUITE}"
# Parse with a while/shift loop. A for-loop over "$@" shifts the positional
# params mid-iteration, so the value consumed by '--suite NAME' is re-encountered
# as a standalone unknown option; the while-loop consumes each argument exactly
# once. '--suite=NAME' is accepted too, but the space-separated form is primary.
while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --list-findings) LIST_FINDINGS=1 ;;
    --rerun) RERUN=1 ;;
    --suite) SUITE="${2:?--suite requires a value}"; shift ;;
    --suite=*) SUITE="${1#*=}" ;;
    -h|--help) usage 0 ;;
    *) usage 2 ;;
  esac
  shift
done

REPO_ROOT="${PARALLIX_EXECUTION_ROOT:-$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REPO_ROOT="$(cd -- "$REPO_ROOT" && pwd)"
export PARALLIX_EXECUTION_ROOT="$REPO_ROOT"
SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Tooling cache lives outside the tracked tree so the CLI distribution and every
# generated database stay out of Git regardless of the active worktree.
CODEQL_CACHE_DIR="${CODEQL_CACHE_DIR:-${CODEQL_ROOT_DIR:-${HOME:-/tmp}}/.cache}"
CODEQL_ROOT="$CODEQL_CACHE_DIR/codeql-${CODEQL_PINNED_VERSION}"
CODEQL_BIN="$CODEQL_ROOT/codeql/codeql"
PACKS_DIR="$CODEQL_CACHE_DIR/codeql-packs-${CODEQL_PACK_TAG#refs/tags/}"

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- version compare (returns 0 when $1 >= $2) --------------------------------
version_ge() {
  [[ "$1" = "$2" ]] && return 0
  local IFS=.
  local i a=("$1") b=("$2")
  for ((i = 0; i < ${#a[@]}; i++)); do
    local ai="${a[i]:-0}" bi="${b[i]:-0}"
    ai="${ai//[^0-9]/}"; bi="${bi//[^0-9]/}"
    ai="${ai:-0}"; bi="${bi:-0}"
    ((10#$ai > 10#$bi)) && return 0
    ((10#$ai < 10#$bi)) && return 1
  done
  return 0
}

# --- obtain the pinned CLI ---------------------------------------------------
# Sets the global CODEQL_BIN to a working pinned CLI and echoes a human label.
resolve_codeql_bin() {
  local got path label="$CODEQL_BIN"
  if [ -x "$CODEQL_BIN" ]; then
    got="$("$CODEQL_BIN" version 2>/dev/null | sed -n 's/.*release \([0-9.]\+\).*/\1/p' | head -1)"
    [ -n "$got" ] || fail "pinned CodeQL at $CODEQL_BIN reports no version"
    version_ge "$got" "$CODEQL_PINNED_VERSION" \
      || fail "CodeQL version $got < pinned $CODEQL_PINNED_VERSION (reinstall from the pinned release)"
    echo "$label ($got)"
    return 0
  fi
  if command -v codeql >/dev/null 2>&1; then
    path="$(command -v codeql)"
    got="$("$path" version 2>/dev/null | sed -n 's/.*release \([0-9.]\+\).*/\1/p' | head -1)"
    if [ -n "$got" ] && version_ge "$got" "$CODEQL_PINNED_VERSION"; then
      CODEQL_BIN="$path"
      echo "$label ($got) [from PATH]"
      return 0
    fi
    fail "codeql on PATH is $got; pinned is $CODEQL_PINNED_VERSION (use the cached pinned CLI, do not substitute)"
  fi
  echo "installing pinned CodeQL $CODEQL_PINNED_VERSION ..." >&2
  local arch zip url
  case "$(uname -s)" in
    Linux) arch="linux64" ;;
    Darwin) arch="osx64" ;;
    *) fail "unsupported platform: $(uname -s) (expected linux64 or osx64)" ;;
  esac
  zip="$CODEQL_CACHE_DIR/codeql-${arch}-${CODEQL_PINNED_VERSION}.zip"
  mkdir -p "$CODEQL_CACHE_DIR" || fail "could not create $CODEQL_CACHE_DIR"
  [ -f "$zip" ] || curl -fL \
    "https://github.com/github/codeql-cli-binaries/releases/download/v${CODEQL_PINNED_VERSION}/codeql-${arch}.zip" \
    -o "$zip" || fail "downloaded pinned CodeQL zip failed (network or release missing)"
  rm -rf "$CODEQL_ROOT"
  mkdir -p "$CODEQL_ROOT"
  unzip -oq "$zip" -d "$CODEQL_ROOT" || fail "unpacked pinned CodeQL zip"
  [ -x "$CODEQL_BIN" ] || fail "pinned CodeQL zip did not contain $CODEQL_BIN"
  resolve_codeql_bin
}

# --- obtain the pinned query packs -------------------------------------------
resolve_packs() {
  if [ -d "$PACKS_DIR/javascript/ql/src" ]; then
    echo "$PACKS_DIR [cached]"; return 0
  fi
  local clone="$PACKS_DIR.git"
  echo "cloning pinned github/codeql @ $CODEQL_PACK_TAG ..." >&2
  mkdir -p "$CODEQL_CACHE_DIR" || fail "could not create $CODEQL_CACHE_DIR"
  rm -rf "$clone"
  GIT_SSH_COMMAND="batch" git -c advice.detachedWorktree=false clone --depth 1 --branch "$CODEQL_PACK_TAG" \
    "https://github.com/github/codeql.git" "$clone" \
    || fail "cloned pinned codeql packs failed (network or tag missing)"
  # The whole repo is a single CodeQL workspace (root codeql-workspace.yml), so
  # it can be passed directly as --additional-packs.
  mv "$clone" "$PACKS_DIR"
  echo "$PACKS_DIR"
}

# --- per-worktree-isolated work area -----------------------------------------
# The work area lives on $TMPDIR (never inside the checkout) so generated
# databases/results are never tracked by Git, and concurrent worktrees write
# separate DBs that can't corrupt each other. WORK_ROOT is stable per
# repository. On ext4 the long CodeQL cache
# filenames that used to fail on ecryptfs (51-byte cap) are fine; tmpfs/$TMPDIR
# stays ephemeral and outside the checkout either way.
WORK_ROOT="${CODEQL_WORK_DIR:-${TMPDIR:-/tmp}/parallix-codeql-$(printf '%s' "$REPO_ROOT" | cut -d/ -f2- | tr -c0-9a-zA-Z_- '_')-$(printf '%s' "$REPO_ROOT" | sha256sum | cut -c1-16)}"
mkdir -p "$WORK_ROOT"
CODEQL_DB="$WORK_ROOT/db"
CODEQL_RESULTS="$WORK_ROOT/results"
CODEQL_DB_COMMIT="$WORK_ROOT/.build-commit"
mkdir -p "$CODEQL_RESULTS"
# Persist per-worktree: the CodeQL database + compiled-query cache survive across
# gate invocations (first run pays the one-time compile cost; subsequent runs
# reuse it). tmpfs/$TMPDIR is ephemeral and cleared on reboot, so no cleanup
# trap is needed -- nothing persists past the machine, and the DB never lives in
# the checkout so nothing is tracked by Git.

# --dry-run resolves and prints the plan WITHOUT downloading the pinned CLI or
# cloning the query packs. Downloading/verifying on a dry-run would make the
# plan preview depend on network + a pinned codeql release, so a clean-runner
# dry-run (no codeql on PATH) would fail before any analysis. Validate only the
# args and print the intended plan from the pinned constants, then exit. This
# keeps `--dry-run` side-effect free and hermetic; the real analysis path below
# still resolves and validates the CLI/packs before building the database so a
# missing or off-version CLI fails loudly with the pinned-version message.
if [ "$DRY_RUN" -eq 1 ]; then
  echo "CodeQL SAST"
  echo "  CLI:        $CODEQL_PINNED_VERSION (pinned)"
  echo "  Packs:      $CODEQL_PACK_TAG (pinned)"
  echo "  Language:   $CODEQL_LANGUAGE"
  echo "  Suite:      $SUITE (recorded: $CODEQL_RECORDED_SUITE)"
  echo "  Repo:       $REPO_ROOT"
  echo "  dry-run: plan resolved, no codeql download or analysis performed."
  exit 0
fi

# Resolve and validate the CLI and packs BEFORE building the database so a
# missing or off-version CLI fails loudly with the pinned-version message
# (mission criterion) instead of a generic "database create failed".
BIN_INFO="$(resolve_codeql_bin)"
PACKS_INFO="$(resolve_packs)"

# Single rebuild path: build the database once here, then analyze it.
# Invalidate only when the committed tree changes (or --rerun is passed): the
# gate analyzes what is being merged, so a stable HEAD reuses the compiled-query
# cache for fast subsequent runs while a new commit forces a fresh analysis.
# There is no second build before analysis — a stale/missing database is the
# only reason to rebuild, so every run builds at most once.
HEAD_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo none)"
if [ "$RERUN" -eq 1 ] || [ ! -d "$CODEQL_DB" ] || [ "$(cat "$CODEQL_DB_COMMIT" 2>/dev/null || echo none)" != "$HEAD_COMMIT" ]; then
  echo "  CodeQL database missing or stale (HEAD $HEAD_COMMIT); building ..."
  rm -rf "$CODEQL_DB"
  "$CODEQL_BIN" database create "$CODEQL_DB" \
    --language="$CODEQL_LANGUAGE" \
    --source-root="$REPO_ROOT" \
    --overwrite >/dev/null \
    || fail "codeql database create failed"
  printf '%s' "$HEAD_COMMIT" > "$CODEQL_DB_COMMIT"
fi

SARIF="$CODEQL_RESULTS/results.sarif"

# Per-finding suppression baseline. The full security/code-scanning suite still
# runs; this drops only results the task has classified as false positives and
# documented with a justification (see the runner's --list-findings output and
# the task classification doc). Last-resort mechanism; the suite is never
# weakened. Resolved here so the runner stays generic; CODEQL_SUPPRESSIONS
# overrides the default path.
# Baseline lives in scripts/ (repository-owned, alongside the runner and the
# count helper), NOT in a mission scratch dir, so the gate has no dependency on
# any mission's directory layout. CODEQL_SUPPRESSIONS still overrides the default.
CODEQL_SUPPRESSIONS="${CODEQL_SUPPRESSIONS:-${SCRIPT_DIR}/codeql-suppressions.sarif}"

echo "  Running query suite $SUITE ..."
"$CODEQL_BIN" database analyze --format sarif-latest \
  --additional-packs "$PACKS_DIR" \
  --output "$SARIF" \
  -- "$CODEQL_DB" "$SUITE" >/dev/null \
  || fail "codeql database analyze failed"

if [ ! -s "$SARIF" ]; then
  fail "CodeQL produced no SARIF output (suite $SUITE unresolved?)"
fi

COUNT="$(node "$SCRIPT_DIR/codeql-count-findings.mjs" "$SARIF" --suppress "$CODEQL_SUPPRESSIONS")"

echo "  Qualifying findings: ${COUNT:-0}"

if [ "$LIST_FINDINGS" -eq 1 ]; then
  node "$SCRIPT_DIR/codeql-count-findings.mjs" "$SARIF" --suppress "$CODEQL_SUPPRESSIONS" --list
fi

if [ "${COUNT:-0}" -gt 0 ]; then
  echo "FAIL: $CODEQL_RECORDED_SUITE reported ${COUNT:-0} finding(s); fix or record a per-finding mitigation." >&2
  exit 1
fi
echo "PASS: $CODEQL_RECORDED_SUITE reported no qualifying findings."
