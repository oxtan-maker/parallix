#!/usr/bin/env bash
# px-install.sh — Parallix's own identity-aware dependency install (TASK-2714).
#
# One successful install per environment. Wired two ways:
#   * adapters.draft.preDraftCommand in workflow.config.json — a fresh mission
#     worktree has no recorded identity, so the draft performs the mission's one
#     successful dependency installation and records it.
#   * scripts/refresh-global-px.sh — the landed base refresh reconciles only when
#     its own recorded installed identity is missing, invalid or changed.
#
# The identity is the semantic dependency input set (dependency specifiers,
# resolutions, integrity, lockfile, install policy, pinned toolchain) hashed by
# scripts/dependency-identity.mjs, not raw file bytes: a release version-only bump
# leaves it intact. The record lives in <worktree>/.workflow/, so parallel
# worktrees never share or overwrite each other's state.
#
# ADR 0063 keeps `pnpm install --frozen-lockfile --prefer-offline` as the install
# command and pnpm-lock.yaml as the only lockfile; this wrapper changes neither.
# A failed install exits non-zero and publishes nothing, so the caller stops and
# the next run reconciles again.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

exec node "${SCRIPT_DIR}/dependency-identity.mjs" ensure --worktree "$REPO_ROOT" "$@"
