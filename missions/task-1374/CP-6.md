# CP 6: Update .gitignore for root entry artifacts

## Work Done

Updated `.gitignore` to add root-anchored `/index.js` and `/px.js` entries.

### Evidence:
- `.gitignore` updated with `/index.js` and `/px.js` (lines 18-19)
- `git rm --cached index.js px.js lib/index.js` — removed from git tracking
- `git ls-files index.js px.js` returns empty (confirmed)
- `package.json` `files` array still includes `index.js` and `px.js` (unchanged)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| /index.js in .gitignore | `.gitignore:18` — `/index.js` |
| /px.js in .gitignore | `.gitignore:19` — `/px.js` |
| Not tracked in git | `git ls-files index.js px.js` — empty output |
| package.json files unchanged | `main: "index.js"`, `bin.px: "px.js"`, `files` includes both |

## Next action
Update `scripts/verify-local.sh` for flat-config ESLint (CP 7).
