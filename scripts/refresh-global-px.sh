#!/usr/bin/env bash
# refresh-global-px.sh — parallix's own post-integrate hook.
#
# Wired via workflow.config.json's adapters.integrate.postIntegrateCommand
# (see docs/authority-reference.md, "Public distribution"). px integrate runs
# this from the base checkout after a successful non-dry-run integration:
# it rebuilds the distributable and reinstalls the global `px` runner from a
# fresh tarball of this checkout. Version allocation belongs to the landed
# integration commit, before this post-integrate self-update runs.
#
# Env vars provided by the caller (see lib/core/post-integrate-hook.ts):
#   INTEGRATE_HOOK_SLUG, INTEGRATE_HOOK_BASE_WORKTREE,
#   INTEGRATE_HOOK_BASE_BRANCH, INTEGRATE_HOOK_VARIANT

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

echo "[refresh-global-px] Building the distributable (esbuild -> build/px.mjs)..."
npm run build

echo "[refresh-global-px] Packing a tarball of this checkout..."
PACK_OUTPUT="$(npm pack)"
TARBALL="$(printf '%s\n' "${PACK_OUTPUT}" | awk '/\.tgz$/ { tarball = $0 } END { print tarball }')"
if [[ -z "${TARBALL}" ]]; then
  echo "[refresh-global-px] npm pack did not report a tarball filename." >&2
  printf '%s\n' "${PACK_OUTPUT}" >&2
  exit 1
fi
trap 'rm -f "${TARBALL}"' EXIT

echo "[refresh-global-px] Installing ${TARBALL} globally..."
npm install -g "./${TARBALL}"

echo "[refresh-global-px] Global px runner refreshed from ${REPO_ROOT}."
px --version || true
