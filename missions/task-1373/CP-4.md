# CP-4: redgreen.ts Converted

## Summary

Converted `lib/tools/redgreen.js` (220 lines) to `lib/tools/redgreen.ts` (224 lines). Changes:
- Replaced 6 `require()` calls with ES `import` statements (fs, os, path, fmt, mission-utils, git)
- Replaced `module.exports = {...}` with 4 individual ES `export` statements
- Added explicit TypeScript type annotations to all 4 function declarations
- CLI guard: kept CJS-style `require.main === module` check (compatible with `build:cjs` CJS output)

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| tsc --noEmit clean for lib/tools/ (excluding forgejo.ts) | `npx tsc --noEmit` reports 180 errors, all in lib/tools/forgejo.ts; 0 errors in lib/tools/redgreen.ts | PASS |
| test/redgreen.test.js passes 9/9 | test/redgreen.test.js: test findReproTestPath reads Reproduction-Test marker from MISSION.md, test findReproTestPath falls back to checkpoint documents, test findReproTestPath returns null when no marker is declared, test verifyRedGreenProof fails when repro is not declared, test verifyRedGreenProof passes when repro is red at parent and green at HEAD, test verifyRedGreenProof blocks when repro PASSES at the parent commit (not red), test verifyRedGreenProof blocks when repro FAILS at HEAD (not green), test verifyRedGreenProof skips when no usable test runner is available, test verifyRedGreenProof blocks when the parent commit cannot be resolved | PASS |
| No module.exports remains in redgreen.ts | `grep -c 'module.exports' lib/tools/redgreen.ts` returns 0 (lib/tools/redgreen.ts:1794) | PASS |
| No require() remains in redgreen.ts | `grep -c 'require(' lib/tools/redgreen.ts` returns 0 — all 6 require() replaced with ES import (lib/tools/redgreen.ts:1-6) | PASS |

## Next action
Convert `lib/tools/forgejo.js` to `forgejo.ts` (CP-5).
