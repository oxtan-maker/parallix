# CP-4: Lifecycle synchronization unblock

TASK-2228 could not advance after execute launch because the integration-branch
lifecycle write attempted to rebase the mission worktree while the agent was
already running. The shared transition path now defers that unsafe rebase,
synchronizes at the next clean boundary, and automatically reconciles
mission-owned conflicts without discarding authoritative lifecycle state or
mission metadata. This is required TASK-2228 completion work and must remain in
scope during review.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Legacy scripts, mtime guard, bypass, and tracked sibling runtime are retired | `package.json:52-62`; `lib/commands/integrate.ts:1601`; `git log --first-parent --format='%H %s' --grep='^mission/task-2228: retire cjs freshness guard$' HEAD` | PASS |
| V3 audit enforces ADR 0044 §8 package policy | `scripts/package-content-audit.js:5`; `test/task-2228-distribution-verification.test.js`, `"package-content audit enforces ADR 0044 section 8 inclusion and exclusion rules"`; `npm run test:package-content`; ADR 0044 | PASS |
| V2 check compares two clean `dist/` file lists | `scripts/verify-reproducible-dist.js:19`; `test/task-2228-distribution-verification.test.js`, `"reproducible dist check compares complete clean-build file lists"`; `npm run test:reproducible-output` | PASS |
| Development and documented runtime paths use `tsx px.ts` and `dist/index.js` | `package.json:54`; `README.md:204`; `docs/authority-reference.md:365` | PASS |
| Release metadata records the authorized MINOR change | `package.json:3`; `package-lock.json:3`; `CHANGELOG.md:35` | PASS |
| Tarball-install and core repository verification pass | `test/task-1424-post-integrate-publish-reinstall.test.js`; `test/package-persistent-data.test.js`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PASS — 886 default tests and all four static-analysis stages passed after the lifecycle repair |
| The uniquely named, reachable phase commit remains a rollback point for both retired mechanisms | `git log --first-parent --format='%H %s' --grep='^mission/task-2228: retire cjs freshness guard$' HEAD` resolves the phase commit; `git show <resolved-commit>^:package.json` (`build:cjs` at line 54 and freshness lifecycle wiring at lines 55-57); `git show <resolved-commit>^:lib/core/build-freshness.ts` | PASS |
| Draft/active lifecycle synchronization defers running-agent rebases and reconciles mission-owned differences | `lib/tools/backlog.ts`; `lib/commands/draft.ts`; `lib/commands/active.ts`; `test/backlog.test.js`, `"transitionTaskOnIntegrationBranch reconciles task metadata conflicts and completes the rebase"`, `"transitionTaskOnIntegrationBranch defers the rebase while the mission worktree has agent edits"`, `"transitionTaskOnIntegrationBranch still aborts shared-file rebase conflicts"`; `test/active.test.js`, `"active() synchronizes a launch-deferred rebase after execute output is committed"` | PASS |
| Deterministic integration gates finish | `./scripts/verify-local.sh integrate --real-agent codex --real-agent-model gpt-5.6-luna`; static analysis, build, and all six `test/e2e-mission-lifecycle.test.js` scenarios passed on 2026-07-19 | PASS |
| Real-agent smoke uses Codex/Luna without Graphify scope pollution | `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node test/e2e-real-agent-smoke.test.js`; `"real Codex gpt-5.6-luna launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` passed in 270377 ms; `lib/core/mission-utils/graphify.ts`; `test/mission-utils-graphify.test.js` | PASS |
| Aggregate integration command finishes in one invocation | `./scripts/verify-local.sh integrate --real-agent codex --real-agent-model gpt-5.6-luna` passed static analysis, build, all six workflow scenarios, and the Codex/Luna real-agent smoke (269915 ms) on 2026-07-19 | PASS |

The previous quota-blocked result was historical. The required gate has since passed using the same Codex/Luna route.

Next action: Run `./scripts/verify-local.sh integrate --real-agent codex --real-agent-model gpt-5.6-luna` on the final committed tree before integration handoff.
