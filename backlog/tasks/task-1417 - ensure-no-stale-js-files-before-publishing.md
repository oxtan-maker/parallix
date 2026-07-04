---
id: TASK-1417
title: ensure no stale js files before publishing
status: backlog
assignee: []
created_date: '2026-07-04 08:53'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
px --version
@magnusekdahl/parallix 1.3.13
px: /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/px.js
package: /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix
node: v24.15.0
magnus@debian:~/code/parallix$ px stats
[parallix] Stale build detected. One or more compiled artifacts are older than their TypeScript source:
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/active.js (mtime 1783155030396.2876 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/active.ts mtime 1783155030428.287)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/checkpoint.js (mtime 1783155030396.2876 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/checkpoint.ts mtime 1783155030428.287)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/config.js (mtime 1783155030396.2876 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/config.ts mtime 1783155030428.287)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/coverage-gate.js (mtime 1783155030396.2876 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/coverage-gate.ts mtime 1783155030428.287)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/diff.js (mtime 1783155030396.2876 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/diff.ts mtime 1783155030428.287)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/draft.js (mtime 1783155030396.2876 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/draft.ts mtime 1783155030432.2869)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/handoff.js (mtime 1783155030400.2876 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/handoff.ts mtime 1783155030432.2869)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/integrate.js (mtime 1783155030400.2876 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/integrate.ts mtime 1783155030434.5986)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/mission-start.js (mtime 1783155030400.2876 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/mission-start.ts mtime 1783155030435.3633)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/mutation-gate.js (mtime 1783155030404.2874 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/mutation-gate.ts mtime 1783155030436.523)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/rebase.js (mtime 1783155030404.2874 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/rebase.ts mtime 1783155030439.7354)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/repair-handoff.js (mtime 1783155030404.2874 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/repair-handoff.ts mtime 1783155030440.4897)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/resolve-conflict.js (mtime 1783155030404.2874 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/resolve-conflict.ts mtime 1783155030441.3125)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/review.js (mtime 1783155030408.2874 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/review.ts mtime 1783155030442.9763)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/setup-review.js (mtime 1783155030408.2874 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/setup-review.ts mtime 1783155030444.2866)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/setup.js (mtime 1783155030412.2874 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/setup.ts mtime 1783155030444.2866)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/stats-backfill.js (mtime 1783155030412.2874 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/stats-backfill.ts mtime 1783155030444.2866)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/stats.js (mtime 1783155030412.2874 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/stats.ts mtime 1783155030444.2866)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/status.js (mtime 1783155030412.2874 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/status.ts mtime 1783155030444.2866)
  - /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/verify.js (mtime 1783155030412.2874 < /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/commands/verify.ts mtime 1783155030444.2866)
Run `npm run build:cjs` to regenerate, or set PARALLIX_SKIP_BUILD_CHECK=1 to bypass.

/home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/px.js:221
        throw new Error(`Stale build detected (exit ${code})`);
              ^

Error: Stale build detected (exit 1)
    at /home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/px.js:221:15
    at assertBuildFreshness (/home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/lib/core/build-freshness.js:94:9)
    at run (/home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/px.js:219:51)
    at Object.<anonymous> (/home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@magnusekdahl/parallix/px.js:272:5)
    at Module._compile (node:internal/modules/cjs/loader:1830:14)
    at Object..js (node:internal/modules/cjs/loader:1961:10)
    at Module.load (node:internal/modules/cjs/loader:1553:32)
    at Module._load (node:internal/modules/cjs/loader:1355:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)

Node.js v24.15.0

so the publish after integration step does not work at the moment. Fix so we don't publish stale js files or if possible ensure that the published version only contain ts files (if that is runnable)
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
