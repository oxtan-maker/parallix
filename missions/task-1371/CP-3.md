# CP-3: Convert lib/commands/rebase.js → rebase.ts

## Summary

Converted `lib/commands/rebase.js` (635 lines) to `lib/commands/rebase.ts`. The file imports `resolveConflictsForMission` from `./integrate.js` (internal dependency) and exports `rebase` as default plus `buildRebasePrompt`, `parseConflictFilesFromRebaseOutput`, `parseConflictFilesFromGitStatus` as named properties. Conversion uses `export =` with property attachment for CJS compatibility.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| No CJS requires | `grep -rc 'require(' lib/commands/rebase.ts` returns exit code 1 (zero matches) — `lib/commands/rebase.ts:0` |
| No CJS exports | `grep -rc 'module\.exports' lib/commands/rebase.ts` returns exit code 1 (zero matches) — `lib/commands/rebase.ts:0` |
| Rename detection | `git diff -M --summary $(git merge-base HEAD origin/main) -- lib/commands/rebase.js lib/commands/rebase.ts` → `rename lib/commands/{rebase.js => rebase.ts} (89%)` ≥ 50% |
| Compiled output | `npm run build:cjs` generates `lib/commands/rebase.js` (34.1kB) |
| Runtime loadability | `node -e "const m = require('./lib/commands/rebase'); console.log(typeof m, typeof m.buildRebasePrompt, typeof m.parseConflictFilesFromRebaseOutput)"` → `function function function` |
| Internal import | `import integrate = require('./integrate.js')` with `integrate.resolveConflictsForMission` access — verified by `test/rebase.test.js` (15 tests pass) |
| TypeScript clean | `npm run typecheck` exits with code 0 |

## Next action
Proceed to CP-4: Convert `lib/commands/integrate.ts` (1673 lines).
