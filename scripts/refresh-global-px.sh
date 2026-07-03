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

echo "[refresh-global-px] Building the distributable (tsc -> CommonJS)..."
npm run build:cjs

echo "[refresh-global-px] Packing a tarball of this checkout..."
TARBALL="$(npm pack)"

echo "[refresh-global-px] Installing ${TARBALL} globally..."
npm install -g "./${TARBALL}"
rm -f "${TARBALL}"

echo "[refresh-global-px] Global px runner refreshed to ${NEW_VERSION} from ${REPO_ROOT}."
px --version || true
