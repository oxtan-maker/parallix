# CP-2: Remove tracked sibling runtime artifacts and sibling ignore globs

Removed the tracked compiled siblings for `repair-handoff` and `stats`, leaving no tracked runtime JavaScript under `lib/` (or root entrypoint siblings). Removed the sibling-output glob lists from Git and ESLint ignores while retaining `dist/` ignores. `build:cjs` and the sibling freshness guard remain available as the rollback compatibility path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Final tracked compiled runtime siblings are absent | `lib/commands/repair-handoff.ts:1`, `lib/commands/stats.ts:1`, `git ls-files '*.js' ':!dist/**'` | PASS |
| Git and ESLint ignore only generated distribution output, not sibling compiled globs | `.gitignore:15`, `eslint.config.mjs:9`, `eslint.config.mjs:27` | PASS |
| Distribution runtime continues to load after sibling removal | `package.json:55`, `node -e "require('./dist/lib/core/build-freshness.js')"` | PASS |
| Rollback compatibility build and mtime guard remain defined | `package.json:54`, `lib/core/build-freshness.ts:11`, `npm run build:cjs` | PASS |

Next action: Add ADR 0049's dated layout correction, run every declared final gate, then demonstrate a clean revert of the phase commits in an isolated worktree.
