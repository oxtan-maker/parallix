---
id: TASK-1424
title: publish fails
status: backlog
assignee: []
created_date: '2026-07-04 15:59'
labels: []
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
