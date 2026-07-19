# CP-3: Release documentation and final verification

Completed the release-facing migration: the package version is now 1.4.0 with
a MINOR changelog entry, documentation describes `dist/` as the checkout and
tarball runtime, and all tracked sibling JavaScript outputs are removed. The
package-content audit, clean-build comparison, tarball-install checks, general
verification gate, static analysis, and lifecycle integration gate pass. The
configured real-agent smoke was attempted through its supported Codex override,
but its isolated reviewer-artifact handoff failed; this is an external harness
failure and prevents a clean final integration-gate claim.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Legacy scripts, mtime guard, bypass, and tracked sibling runtime are retired | `package.json:52-62`; `lib/commands/integrate.ts:1601`; `git show --name-status f48aa032` | PASS |
| V3 audit enforces ADR 0044 §8 package policy | `scripts/package-content-audit.js:5`; `test/task-2228-distribution-verification.test.js`, `"package-content audit enforces ADR 0044 section 8 inclusion and exclusion rules"`; `npm run test:package-content`; ADR 0044 | PASS |
| V2 check compares two clean `dist/` file lists | `scripts/verify-reproducible-dist.js:19`; `test/task-2228-distribution-verification.test.js`, `"reproducible dist check compares complete clean-build file lists"`; `npm run test:reproducible-output` | PASS |
| Development and documented runtime paths use `tsx px.ts` and `dist/index.js` | `package.json:54`; `README.md:204`; `docs/authority-reference.md:365` | PASS |
| Release metadata records the authorized MINOR change | `package.json:3`; `package-lock.json:3`; `CHANGELOG.md:35` | PASS |
| Tarball-install and core repository verification pass | `test/task-1424-post-integrate-publish-reinstall.test.js`; `test/package-persistent-data.test.js`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PASS |
| The phase commit is a rollback point for both retired mechanisms | `git show --name-status f48aa032`; `missions/task-2228/CP-2.md:16` | PASS |
| Draft/active lifecycle synchronization preserves integration state and mission metadata | `missions/task-2228/MISSION.md`; `lib/tools/backlog.ts`; `test/backlog.test.js` | PENDING CP-4 |
| Configured integration plan finishes, including real-agent smoke | `./scripts/verify-local.sh integrate`; `test/e2e-real-agent-smoke.test.js`, `"real Codex gpt-5.6-luna launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` | BLOCKED — the Codex smoke failed its isolated reviewer-artifact handoff after lifecycle execution. |

Next action: Repair or rerun the external Codex smoke harness until `test/e2e-real-agent-smoke.test.js` passes, then rerun `./scripts/verify-local.sh integrate` before handoff.
