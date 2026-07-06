---
id: TASK-1424
title: publish fails
status: backlog
assignee: []
created_date: '2026-07-04 15:59'
updated_date: '2026-07-05 06:20'
labels: [ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
graphify watch] graph.json and GRAPH_REPORT.md updated in graphify-out
Code graph updated. For doc/paper/image changes run /graphify --update in your AI assistant.
Tip: set GEMINI_API_KEY or GOOGLE_API_KEY to use Gemini for semantic extraction.
[FAIL] Post-integrate hook failed (exit code 254): ./scripts/refresh-global-px.sh
[FAIL] [refresh-global-px] Bumping patch version for task-1417...
[FAIL] [refresh-global-px] package.json/package-lock.json bumped to v1.3.14
[FAIL] [main 89a70b07] chore: bump version to 1.3.14 (post-integrate self-update)
[FAIL]  2 files changed, 3 insertions(+), 3 deletions(-)
[FAIL] [refresh-global-px] Building the distributable (tsc -> CommonJS)...
[FAIL] 
[FAIL] > @magnusekdahl/parallix@1.3.14 build:cjs
[FAIL] > tsc --rootDir . --outDir . --module CommonJS --moduleResolution Node --esModuleInterop && { head -1 px.js | grep -q '^#!' || sed -i '1i#!/usr/bin/env node' px.js; } && chmod +x px.js
[FAIL] 
[FAIL] [refresh-global-px] Packing a tarball of this checkout...
[FAIL] [refresh-global-px] Installing 
[FAIL] > @magnusekdahl/parallix@1.3.14 prepack
[FAIL] > npm run publish:guard
[FAIL] 
[FAIL] 
[FAIL] > @magnusekdahl/parallix@1.3.14 publish:guard
[FAIL] > node -e "require('./lib/core/build-freshness.js').assertBuildFreshness(process.cwd())"
[FAIL] 
[FAIL] magnusekdahl-parallix-1.3.14.tgz globally...
[FAIL] 
[FAIL] npm notice
[FAIL] npm notice 📦  @magnusekdahl/parallix@1.3.14
[FAIL] npm notice Tarball Contents
[FAIL] npm notice 7.9kB CHANGELOG.md

after integrating task-1417

after another integration I get:

[FAIL] Could not verify the exact tree being published: [parallix] Stale build detected. One or more compiled artifacts are older than their TypeScript source:
[FAIL]   - /home/magnus/code/parallix/lib/commands/stats.js (mtime 1783182124653.8125 < /home/magnus/code/parallix/lib/commands/stats.ts mtime 1783232195547.9404)
[FAIL] Run `npm run build:cjs` to regenerate, or set PARALLIX_SKIP_BUILD_CHECK=1 to bypass.
[FAIL] 

which also indicates perhaps another problem

also integration leaves stray tgz files that is not cleaned up
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
