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

# This repository keeps its self-development review policy outside the shipped
# package default. Resolve the review-only prompt override before rebuilding so
# every landed refresh is tied to the current checked-in opinion file. The
# canonical bundle stages a blank default; subsequent `px` invocations in this
# checkout read this file through adapters.prompts.reviewOverride.
REVIEW_PROMPT_PATH="$(node --input-type=module -e '
  import fs from "node:fs";
  import path from "node:path";
  const root = process.argv[1];
  const config = JSON.parse(fs.readFileSync(path.join(root, "workflow.config.json"), "utf8"));
  const override = config?.adapters?.prompts?.reviewOverride;
  const expected = path.join(root, "prompts", "review.md");
  if (typeof override !== "string" || path.resolve(root, override) !== expected) {
    console.error("[refresh-global-px] adapters.prompts.reviewOverride must select prompts/review.md");
    process.exit(1);
  }
  process.stdout.write(expected);
' "$REPO_ROOT")"
if [[ ! -s "$REVIEW_PROMPT_PATH" ]]; then
  echo "[refresh-global-px] Repository review instructions are missing or empty: ${REVIEW_PROMPT_PATH}" >&2
  exit 1
fi
REVIEW_PROMPT_SHA="$(node --input-type=module -e '
  import crypto from "node:crypto";
  import fs from "node:fs";
  process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
' "$REVIEW_PROMPT_PATH")"
echo "[refresh-global-px] Repository review instructions: ${REVIEW_PROMPT_SHA}"

# Reconcile dependencies only when this checkout's recorded installed identity is
# missing, invalid or changed (TASK-2714). The draft install already recorded the
# identity for a mission worktree; the base worktree records its own here, so a
# landed release-version-only bump does not reinstall the base.
echo "[refresh-global-px] Reconciling installed dependencies when the installed identity changed..."
"${SCRIPT_DIR}/px-install.sh"

echo "[refresh-global-px] Building the distributable (esbuild -> build/px.mjs)..."
npm run build

# --ignore-scripts keeps package.json's `prepack` (npm run build) from rebuilding
# the distributable a second time: the build above is the one landed build, and
# `files` in package.json ships exactly what it produced (TASK-2714).
echo "[refresh-global-px] Packing a tarball of this checkout..."
PACK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/parallix-refresh.XXXXXX")"
trap 'rm -rf "${PACK_DIR}"' EXIT
PACK_OUTPUT="$(npm pack --ignore-scripts --pack-destination "${PACK_DIR}")"
TARBALL="$(printf '%s\n' "${PACK_OUTPUT}" | awk '/\.tgz$/ { tarball = $0 } END { print tarball }')"
if [[ -z "${TARBALL}" ]]; then
  echo "[refresh-global-px] npm pack did not report a tarball filename." >&2
  printf '%s\n' "${PACK_OUTPUT}" >&2
  exit 1
fi

echo "[refresh-global-px] Installing ${TARBALL} globally..."
npm install -g "${PACK_DIR}/${TARBALL}"

echo "[refresh-global-px] Global px runner refreshed from ${REPO_ROOT}; repository review instructions ${REVIEW_PROMPT_SHA} are active through adapters.prompts.reviewOverride."
px --version || true
