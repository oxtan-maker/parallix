# CP-1: Removal inventory and replacement baseline

Confirmed TASK-2227 moved the checkout runtime and test path to `dist/`, with
`npm run build` as the pretest build. The legacy `build:cjs`/mtime mechanism is
still present and has not been removed. V1 is the existing clean build and test
path, and V4 is covered by the installed-tarball tests. V2 and V3 do not yet
exist as named checks, so CP-2 must add and run them before deleting the legacy
guard.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Legacy removal inventory is mapped without premature deletion | `package.json:54-57`; `lib/core/build-freshness.ts:62`; `test/task-2227-build-cjs-clean.test.js` | PASS |
| V1 clean build/test replacement is wired | `package.json:58-59`; `test/run-default-tests.js` | PASS |
| V2 reproducible-output replacement is a required pre-removal addition | ADR 0044; `missions/task-2228/MISSION.md` | PENDING CP-2 |
| V3 package-content audit replacement is a required pre-removal addition | ADR 0044; `missions/task-2228/MISSION.md` | PENDING CP-2 |
| Direct-source development uses `npm run dev` while built runtime uses `node dist/index.js` | `missions/task-2228/MISSION.md`; `package.json` | PENDING CP-2 |
| README and public-distribution documentation describe the `dist/` runtime without the retired guard | `missions/task-2228/MISSION.md`; `README.md`; `docs/authority-reference.md` | PENDING CP-3 |
| MINOR release metadata and a reversible phase commit | `missions/task-2228/MISSION.md`; `CHANGELOG.md` | PENDING CP-3 |
| Draft/active lifecycle synchronization preserves integration state and mission metadata | `missions/task-2228/MISSION.md`; `lib/tools/backlog.ts` | PENDING CP-4 |
| V4 tarball-install replacement is wired | `test/task-1424-post-integrate-publish-reinstall.test.js`; `test/package-persistent-data.test.js` | PASS |
| TASK-2227 provides the prerequisite `dist/` runtime migration | `missions/task-2227/CP-4.md`; `package.json:58` | PASS |
| Final repository, integration-plan, and tarball-install verification | `missions/task-2228/MISSION.md`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh integrate` | PENDING CP-3 |

Next action: Add V2 and V3 as named checks, run them successfully, then retire the legacy guard in CP-2.
