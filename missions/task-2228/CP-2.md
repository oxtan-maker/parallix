# CP-2: Distribution checks and guard retirement

Added the two missing replacement gates before removing the legacy mechanism:
the package-content audit runs `npm pack --dry-run --json` against ADR 0044
§8, and the reproducibility check removes `dist/` before each of two builds and
compares their complete file lists. The package now exposes `npm run dev` for
direct TypeScript execution and has only the canonical `prepack` build. The
mtime guard, its callers, and its dedicated tests are deleted; integration now
builds `dist/` deterministically before proof capture instead of consulting
file timestamps.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `build:cjs`, `publish:guard`, bypass, freshness source, and dedicated tests are retired | `package.json:52-61`; `lib/commands/integrate.ts:1602`; `test/task-2228-distribution-verification.test.js` | PASS |
| Named V3 package-content audit enforces ADR 0044 §8 | `scripts/package-content-audit.js:20`; `test/task-2228-distribution-verification.test.js`, `"package-content audit enforces ADR 0044 section 8 inclusion and exclusion rules"`; `npm run test:package-content`; ADR 0044 | PASS |
| Named V2 check compares two clean-build `dist/` file lists | `scripts/verify-reproducible-dist.js:19`; `test/task-2228-distribution-verification.test.js`, `"reproducible dist check compares complete clean-build file lists"`; `npm run test:reproducible-output` | PASS |
| Direct source development path is available | `package.json:53` | PASS |
| README and public-distribution documentation describe the `dist/` runtime without the retired guard | `missions/task-2228/MISSION.md`; `README.md`; `docs/authority-reference.md` | PENDING CP-3 |
| MINOR release metadata and a rollback commit restore both retired mechanisms | `missions/task-2228/MISSION.md`; `CHANGELOG.md`; `git log --first-parent` | PENDING CP-3 |
| Draft/active lifecycle synchronization preserves integration state and mission metadata | `missions/task-2228/MISSION.md`; `lib/tools/backlog.ts` | PENDING CP-4 |
| Existing V1 build/test and V4 installed-tarball coverage remain wired | `package.json:55-57`; `test/task-1424-post-integrate-publish-reinstall.test.js`; `test/package-persistent-data.test.js` | PASS |
| Integration verification builds canonical `dist/` without mtime checks | `lib/commands/integrate.ts:1602`; `test/integrate.test.js`, `"buildBeforeVerification builds dist without consulting source mtimes"` | PASS |
| Final repository, integration-plan, and tarball-install verification | `missions/task-2228/MISSION.md`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh integrate` | PENDING CP-3 |

Next action: Update the release-facing documentation and metadata, then run the declared full verification and tarball-install smoke checks.
