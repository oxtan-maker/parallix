# CP-1: Remove NOTICES from version control and add .gitignore entry

## Summary

Removed the generated root-level `NOTICES` file from git tracking and added an exact
root-level ignore entry in `.gitignore`. The `NOTICES` file is a generated packaging
artifact produced by `scripts/release-metadata.js` during `npm run build` / `prepack`.
Tracking it in git caused every build to dirty the worktree, blocking Parallix mission
flows with `Cannot auto-commit: dirty files include non-mission paths: NOTICES`.

Changes committed in `fbd046e4f`:
- `git rm --cached NOTICES` — removed from version control (file stays on disk)
- `.gitignore` line 33 — added root-anchored `/NOTICES` entry (matches only repository root)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `NOTICES` no longer tracked in git | `git ls-files --error-unmatch NOTICES` exits 1; `fbd046e4f` shows `delete mode 100644 NOTICES` | PASS |
| `.gitignore` contains exact root-level ignore for `NOTICES` | `.gitignore:33` — `/NOTICES` (root-anchored); `git check-ignore -v --no-index NOTICES nested/NOTICES` matches only root | PASS |
| Build regenerates `NOTICES` without dirtying git | `npm run build` regenerates file; `git status --short` shows no `NOTICES` entry | PASS |
| `NOTICES` remains in `package.json` `files[]` for published packages | `package.json` — `"NOTICES"` in `files` array | PASS |

## Next action: Run CP-2 verification — confirm `npm run build` regenerates NOTICES, git status stays clean, and packaging tests still require and include NOTICES.
