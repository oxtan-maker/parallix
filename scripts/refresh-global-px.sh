#!/usr/bin/env bash
# refresh-global-px.sh — parallix's own post-integrate hook.
#
# Wired via workflow.config.json's adapters.integrate.postIntegrateCommand
# (see docs/authority-reference.md, "Public distribution"). px integrate runs
# this from the base checkout after a successful non-dry-run integration:
# it bumps the package's patch version, rebuilds the distributable, and
# reinstalls the global `px` runner from a fresh tarball of this checkout —
# automating the "bump before integrate, reinstall after" release discipline
# that was previously a manual operator step.
#
# Env vars provided by the caller (see lib/core/post-integrate-hook.ts):
#   INTEGRATE_HOOK_SLUG, INTEGRATE_HOOK_BASE_WORKTREE,
#   INTEGRATE_HOOK_BASE_BRANCH, INTEGRATE_HOOK_VARIANT

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

echo "[refresh-global-px] Bumping patch version for ${INTEGRATE_HOOK_SLUG:-unknown mission}..."
NEW_VERSION="$(npm version patch --no-git-tag-version)"
echo "[refresh-global-px] package.json/package-lock.json bumped to ${NEW_VERSION}"

git add package.json package-lock.json
git commit -m "chore: bump version to ${NEW_VERSION#v} (post-integrate self-update)"

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

echo "[refresh-global-px] Global px runner refreshed to ${NEW_VERSION} from ${REPO_ROOT}."
px --version || true
