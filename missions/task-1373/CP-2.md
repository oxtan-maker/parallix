# CP-2: gatekeeper.ts Converted

## Summary

Converted `lib/tools/gatekeeper.js` (124 lines) to `lib/tools/gatekeeper.ts` (129 lines). Changes:
- Replaced 6 `require()` calls with ES `import` statements (fs, path, fmt, mission-utils, backlog, forgejo)
- Replaced `module.exports = {...}` with 4 individual ES `export` statements
- Added explicit TypeScript type annotations to function declarations

## Goal Check

| Criterion | Evidence |
|---|---|
| tsc --noEmit clean | `npx tsc --noEmit` reports 0 errors |
| test/gatekeeper.test.js passes (14/14) | checkMandatoryFiles returns ok when MISSION.md/checkpoint/backlog task exist, checkMandatoryFiles flags missing MISSION.md, checkMandatoryFiles flags missing checkpoint documents, checkMandatoryFiles accepts missing backlog task file, checkMandatoryFiles flags all three missing, checkMandatoryFiles accepts custom findMissionDirFn/findCheckpointsFn, buildPushbackBody formats readable pushback comment, buildPushbackBody handles empty missing list, runGatekeeper returns ok=true when all artifacts present, runGatekeeper skips posting when no Forgejo token available, runGatekeeper posts request-changes when artifacts missing, runGatekeeper handles postReview failure gracefully, runGatekeeper uses custom branch and user from options, DEFAULT_GATEKEEPER_USER is forgejo-gatekeeper |
| No module.exports remains | `grep -c 'module.exports' lib/tools/gatekeeper.ts` returns 0 |
| No require() remains | `grep -c 'require(' lib/tools/gatekeeper.ts` returns 0 |

## Next action
Convert `lib/tools/sessions.js` to `sessions.ts` (CP-3).
