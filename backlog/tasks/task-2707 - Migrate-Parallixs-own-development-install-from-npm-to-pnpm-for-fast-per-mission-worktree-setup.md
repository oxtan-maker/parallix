---
id: TASK-2707
title: >-
  Migrate Parallix's own development install from npm to pnpm for fast
  per-mission worktree setup
status: backlog
assignee: []
created_date: '2026-10-10 05:20'
labels:
  - ai-sdlc
  - performance
  - tooling
dependencies: []
references:
  - workflow.config.json
  - src/adapters/process/pre-draft-hook.ts
  - scripts/refresh-global-px.sh
  - .github/workflows/ci-required.yml
  - 'https://pnpm.io/git-worktrees'
documentation:
  - docs/adr/0046-npm-publish-process-and-security.md
  - docs/adr/0061-differential-dependency-security-and-dependabot-maintenance.md
  - docs/adr/0063-self-hosted-verification-performance.md
  - docs/doc-standards.md
priority: medium
ordinal: 209008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY: Every mission worktree runs `adapters.draft.preDraftCommand` = `npm ci --no-audit --no-fund --prefer-offline` (workflow.config.json). This is a Parallix-self-development setting only; the product itself has no install step (pre-draft hook defaults to none). Measured on this repo's real lockfile (ext4, loaded machine): npm ci 4.9-7.7 s even with a warm cache; pnpm with a warm content-addressable store installs in ~0.3 s (0.1 s when node_modules exists), cold store ~2.9 s. Sharing or hardlink-cloning main's node_modules is NOT acceptable because a mission may change dependencies and would corrupt main and parallel missions; pnpm's store gives per-worktree isolated node_modules with cheap hardlinked content.

OUTCOME: Missions in this repository get an isolated, lockfile-exact dependency install in well under a second when the store is warm, with no change to what end users install or to how the package is published, unless a separately decided change says otherwise.

IMPORTANT CONTEXT FOR THE IMPLEMENTER (read fully, you have no prior conversation):
- This is a package-manager change in a repo whose CI, release, gates, tests and ADRs are written against npm. The risk is silently breaking something non-obvious, not the install itself. Treat every npm reference as suspect until classified.
- Do NOT assume the published artifact or the end-user install path changes. `npm publish`, `npm pack`, and the global `px` install via npm are product/distribution concerns (see docs/adr/0046-npm-publish-process-and-security.md, 0044-workflow-distribution-model.md). Decide per reference whether it is dev-install (migrate) or distribution (keep npm). If distribution must change, STOP and take it to the user as a separate decision.
- Architecture rule from AGENTS.md: changes to ports-and-adapters principles, dependency direction, typed ports, composition authority, or adapter boundaries require stopping and presenting evidence/alternatives to the user before implementing. A package-manager switch should not need that; if you find it does, stop.
- Mission Evidence goes through `px checkpoint record` only. No direct DB access. Do not fabricate timings: record measured numbers.

KNOWN NPM TOUCHPOINTS TO CLASSIFY (non-exhaustive; grep again, do not trust this list): workflow.config.json (preDraftCommand, preIntegration gates incl. `npm run build`, `npm audit --audit-level=high`, `npm run sonar`, `npm test`, `npm run test:*`, postIntegrateCommand + scripts/refresh-global-px.sh which runs `npm ci` and `npm install -g`), package.json (`overrides` for source-map-js, scripts, engines), .github/workflows/ci-required.yml (npm ci, npm install --global npm@11.5.1), .github/dependabot.yml (npm ecosystem), scripts/bump-version.sh, scripts/release-publish.ts, scripts/package-content-audit.ts, scripts/sonar-local.ts (error text says run `npm ci`; sonar-scanner has a postinstall that chmods its binary), src/adapters/cli/commands/integrate-gates.ts, src/adapters/git/net-engineering-lines.ts (package-lock.json may be size-budget excluded), src/adapters/web/asset-store.ts, test/integration/packaging/* (npm pack/install smoke, post-integrate global install), test/integration/repository-gates, test/lib/integration-repair-fixture.ts, test/lib/test-categories.ts, docs (ADR 0046, 0061 differential dependency security + dependabot, 0063 self-hosted verification performance, docs/config.md, operator-setup.md, agents.md, npm-package-major-migration.md), examples/run-enterprise-tarball-workflow-smoke.sh, graph/coverage tooling under tools/.

NON-OBVIOUS TRAPS TO CHECK EXPLICITLY:
1. Lifecycle scripts: pnpm (recent majors) does not run dependency install scripts by default. sonar-scanner's postinstall (`chmod +x bin/sonar-scanner`) and any esbuild/rolldown native binary setup must still work; verify `npm run sonar` end to end or prove an equivalent.
2. Strict, non-flat node_modules: undeclared (phantom) dependency imports that work under npm hoisting will fail under pnpm. Find them with the full build + unit + integration + e2e suites, not just typecheck. Decide fix-the-import vs declare-the-dependency; never paper over with broad hoisting config unless justified in an ADR.
3. Symlinked layout: tools that resolve real paths (tsx loader, Node test runner with --import, Sonar JS bridge and its TypeScript program, ESLint, coverage merge/lcov path mapping in tools/coverage-comparison and coverage:merge, the SEA/native build, package-content audit, npm-package bundle contract tests) may behave differently. Coverage paths must still map to src/ so the SonarQube coverage bar is not silently lowered.
4. Overrides: package.json `overrides` is npm syntax; the pnpm equivalent (pnpm.overrides / pnpm-workspace.yaml) must preserve the same resolved versions. Prove resolved versions are identical to package-lock.json for every package (diff resolved tree), or document each intentional delta.
5. Lockfile authority: exactly one lockfile of record. Define what happens to package-lock.json (removed vs kept for distribution/consumers) and make CI, dependabot, `npm audit` replacement (pnpm audit or an equivalent that keeps the high-severity gate) and ADR 0061 differential security consistent. The pre-integration `dependency-audit` gate must keep failing on high severity.
6. Content/size gates: package-content audit, tarball contents, the per-mission change-size budget (ADR 0047) and net-engineering-lines treatment of lockfiles must still behave; a new lockfile name must be classified the same way package-lock.json was.
7. Worktrees and concurrency: several missions install in parallel against one shared store on ext4 (no reflinks; hardlinks only). Verify concurrent installs and store locking, that a mission changing dependencies cannot alter main or other missions, store location/permissions, and what happens when the store is cold, absent, or on another filesystem (hardlink fallback to copy). preDraftCommand must fail loudly, not leave a half-installed worktree.
8. Fresh-clone and CI parity: a clean checkout with no store, and the GitHub runner, must work from the lockfile alone. Corepack/packageManager pinning and Node 24 vs engines must be decided and reproducible.
9. Global px refresh: scripts/refresh-global-px.sh and the post-integrate global install contract test must continue to produce a working global `px`; do not regress `npm install -g` of the packed tarball unless explicitly decided.
10. Stale artifacts: existing sibling worktrees and tmp fixtures that carry npm-installed node_modules must not be corrupted; removal of old paths needs guard-test updates (replace guards in place, do not add parallel ones; cite file+symbol, never file:line from another file).
11. Test hygiene from AGENTS.md: unit tests <= 500 ms each, production files <= 500 lines, new suites classified in test/lib/test-categories.ts, extend the owning suite before adding files, reproduction first for any bug found, run focused checks then `./scripts/verify-local.sh static-analysis`; docs edits follow docs/doc-standards.md and finish with `./scripts/verify-local.sh docs`.

SCOPE NOTE: If, once refined, this exceeds one reviewable PR, split into subtasks (baseline measurement; pnpm install + preDraftCommand; CI/dependabot/audit; docs/ADR amendment) with explicit dependencies and what each provides. ADR edits amend the owning ADR in place (current decisions only, no supersede/dated history).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Baseline recorded first via `px checkpoint record`: wall-clock of the current preDraftCommand and of a full worktree-ready sequence on this machine (cold and warm, with stated machine load), so the speedup claim is measured, not assumed
- [ ] #2 Every npm/package-lock/npx reference in the repo is classified dev-install (migrate), distribution (keep npm) or CI-only, with the classification and any decision-needed items recorded as mission evidence; distribution-path changes are not made without an explicit user decision
- [ ] #3 After the change, a fresh worktree installs with the pnpm store warm in under 1 s and with a cold store in under 5 s on the same machine; numbers recorded and compared with the baseline
- [ ] #4 The resolved dependency tree is proven identical to the pre-migration package-lock.json for all packages including the source-map-js override; any intentional version delta is listed and justified
- [ ] #5 Two missions installing concurrently, and one mission changing a dependency, leave main's checkout and every other worktree's node_modules byte-unchanged (proved by a test or recorded check, not by reasoning)
- [ ] #6 sonar-scanner works after install (its postinstall behavior is preserved) and `npm run sonar` style scan still produces coverage mapped to src/ paths with no drop in measured coverage versus pre-migration
- [ ] #7 The pre-integration gate plan in workflow.config.json still runs build, dependency audit (high severity still blocks), static analysis, unit, integration-ci, integration-local, coverage-merge, workflow, agent-smoke and quality-gate green from a pnpm-installed worktree
- [ ] #8 ci-required.yml and dependabot are consistent with the new lockfile of record and succeed from a clean checkout with no pre-existing store
- [ ] #9 Phantom-dependency failures found under strict node_modules are each fixed by declaring or removing the import, not by blanket hoisting; any hoisting exception is justified in the owning ADR
- [ ] #10 `px` global refresh and the packed-tarball install smoke tests (post-integrate global install, npm-pack-install-smoke, package-content audit) still pass unchanged in intent
- [ ] #11 Owning ADRs (0046, 0061, 0063 at minimum) and live docs (docs/config.md, operator-setup.md, README install notes) are amended in place to the current decision only, passing `./scripts/verify-local.sh docs`
- [ ] #12 Failure of the install hook is loud: a failed or partial install blocks draft with a clear repair message and never launches an agent into a half-installed worktree (existing draft-stats repair path covered by a test)
- [ ] #13 Implementer manually runs a real mission end to end (draft, active, review) on the pnpm setup in a safe sandbox home, without touching the real parallix.db or stats, and records the result
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
