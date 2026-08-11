# CP-4: Remove `conflict-resolution` step from config and docs

## Summary

Removed `conflict-resolution` step entry from `config/agents.json` (no `eligible`, `selection`, or `weights` key). Updated `docs/agents.md` to describe conflict resolution as implementer-owned work — no longer presented as a separately configurable workflow step. Also corrected the session marker note: `px resolve-conflict` now launches with `slug` and `role: 'implementer'`.

## Changes

- `config/agents.json` — removed `steps["conflict-resolution"]` block (SC3)
- `docs/agents.md:12` — step list drops `conflict-resolution`; prose explains implementer ownership (SC8)
- `docs/agents.md:111` — JSON example drops `conflict-resolution` step
- `docs/agents.md:180-181` — `px resolve-conflict` note updated: now carries slug + role

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: no `conflict-resolution` step in config | `config/agents.json` (no `steps["conflict-resolution"]` key) | PASS |
| SC8: docs describe implementer ownership | `docs/agents.md:12` | PASS |
| SC8: no separately configurable pool language | `docs/agents.md:12` ("not a separately configurable step") | PASS |
| Docs gate passes | `./scripts/verify-local.sh docs` — PASS | PASS |

Next action: Commit CP-5 (final verification gate and complete mission checkpoints).
