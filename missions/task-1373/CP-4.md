# CP-4: redgreen.ts Converted

## Summary

Converted `lib/tools/redgreen.js` (220 lines) to `lib/tools/redgreen.ts` (224 lines). Changes:
- Replaced 6 `require()` calls with ES `import` statements (fs, os, path, fmt, mission-utils, git)
- Replaced `module.exports = {...}` with 4 individual ES `export` statements
- Added explicit TypeScript type annotations to all 4 function declarations
- CLI guard: kept CJS-style `require.main === module` check (compatible with `build:cjs` CJS output)

## Goal Check

| Criterion | Evidence |
|---|---|
| tsc --noEmit clean | `npx tsc --noEmit` reports 0 errors |
| test/redgreen.test.js passes (9/9) | findReproTestPath reads Reproduction-Test marker from MISSION.md, findReproTestPath falls back to checkpoint documents, findReproTestPath returns null when no marker declared, verifyRedGreenProof fails when repro not declared, verifyRedGreenProof passes when repro red at parent and green at HEAD, verifyRedGreenProof blocks when repro PASSES at parent commit, verifyRedGreenProof blocks when repro FAILS at HEAD, verifyRedGreenProof skips when no usable test runner available, verifyRedGreenProof blocks when parent commit cannot be resolved |
| No module.exports remains | `grep -c 'module.exports' lib/tools/redgreen.ts` returns 0 |
| No require() remains | `grep -c 'require(' lib/tools/redgreen.ts` returns 0 — all 6 require() replaced with ES import |

## Next action
Convert `lib/tools/forgejo.js` to `forgejo.ts` (CP-5).
