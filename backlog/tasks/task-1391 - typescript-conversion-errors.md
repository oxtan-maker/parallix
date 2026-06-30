---
id: TASK-1391
title: typescript conversion errors
status: backlog
assignee: []
created_date: '2026-06-30 15:46'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
after typescrip conversion I get this error: node px.ts review --push
/home/magnus/code/parallix-task-1358/px.ts:6
import * as fmt from './lib/core/fmt.js';
import missionStart = require('./lib/commands/mission-start.js');
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
import { createEvent } from './lib/review/review-events.js';

SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript import equals declaration is not supported in strip-only mode
    at parseTypeScript (node:internal/modules/typescript:68:40)
    at processTypeScriptCode (node:internal/modules/typescript:146:42)
    at stripTypeScriptModuleTypes (node:internal/modules/typescript:209:22)
    at Module._compile (node:internal/modules/cjs/loader:1784:15)
    at Object..js (node:internal/modules/cjs/loader:1961:10)
    at Module.load (node:internal/modules/cjs/loader:1553:32)
    at Module._load (node:internal/modules/cjs/loader:1355:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47 {
  code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX'
}

review the typescript converted code for this bug and others and fix them
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
