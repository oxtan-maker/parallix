---
id: TASK-1408
title: more ts errors
status: done
assignee: [codex]
created_date: '2026-07-02 19:22'
labels:
  - bug
  - ai_sdlc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
this error is quite recent:

magnus@debian:~/code/parallix-task-1406$ node px.ts active
(node:3649460) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///home/magnus/code/parallix-task-1406/px.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /home/magnus/code/parallix-task-1406/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
node:internal/modules/esm/resolve:271
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/magnus/code/parallix-task-1406/lib/core/fmt.js' imported from /home/magnus/code/parallix-task-1406/px.ts
    at finalizeResolution (node:internal/modules/esm/resolve:271:11)
    at moduleResolve (node:internal/modules/esm/resolve:861:10)
    at defaultResolve (node:internal/modules/esm/resolve:988:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:697:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:714:38)
    at ModuleLoader.resolveSync (node:internal/modules/esm/loader:746:52)
    at #resolve (node:internal/modules/esm/loader:679:17)
    at ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:599:35)
    at ModuleJob.syncLink (node:internal/modules/esm/module_job:162:33)
    at ModuleJob.link (node:internal/modules/esm/module_job:252:17) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/magnus/code/parallix-task-1406/lib/core/fmt.js'
}

Node.js v24.15.0

question is why did the e2e test not catch this, ensure it does so main does not get into a non-runnable state again.
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
