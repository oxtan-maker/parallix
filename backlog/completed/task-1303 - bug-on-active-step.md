---
id: TASK-1303
title: bug on active step
status: done
assignee: [claude]
created_date: '2026-06-14 14:13'
updated_date: '2026-06-17 03:55'
labels:
  - ai_sdlc
dependencies: []
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After upgrading to latest parallax/parallix I get this error constantly:

  AST extraction: 3000/3860 uncached files (77%) [16 workers]
  AST extraction: 3100/3860 uncached files (80%) [16 workers]
  AST extraction: 3200/3860 uncached files (82%) [16 workers]
  AST extraction: 3300/3860 uncached files (85%) [16 workers]
  AST extraction: 3400/3860 uncached files (88%) [16 workers]
  AST extraction: 3500/3860 uncached files (90%) [16 workers]
  AST extraction: 3600/3860 uncached files (93%) [16 workers]
  AST extraction: 3700/3860 uncached files (95%) [16 workers]
  AST extraction: 3800/3860 uncached files (98%) [16 workers]
  AST extraction: 3864/3864 files (100%) [16 workers]
[graphify watch] Skipped graph.html: Graph has 30577 nodes - too large for HTML viz (limit: 5000). Use --no-viz, raise GRAPHIFY_VIZ_NODE_LIMIT, or reduce input size.
[graphify watch] Rebuilt: 30577 nodes, 36674 edges, 3522 communities
[graphify watch] graph.json and GRAPH_REPORT.md updated in graphify-out
Code graph updated. For doc/paper/image changes run /graphify --update in your AI assistant.
Tip: set GEMINI_API_KEY or GOOGLE_API_KEY to use Gemini for semantic extraction.
[INFO] Selected reviewer: mistral (auto-derived)
[INFO] Checking review-provider availability at http://localhost:3300...
[INFO] Review provider is running and reachable at http://localhost:3300.
[FAIL] No open review PR found for mission/task-1299. Create the PR before starting the review loop.
       Run: node workflow review <slug> --submit
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Re-scoped 2026-06-17 after root-cause research. The original cause of these logs — the automated post-execute handoff aborting on the first push of a brand-new mission branch ("could not find remote ref") — was already fixed by TASK-1317 (done 2026-06-16; verified in lib/tools/forgejo.js:808-812,825-829, first push now falls back to a plain push). So the happy auto-handoff path now creates the PR and the review loop finds it.

This task is therefore NOT a regression fix. It now hardens the residual non-happy path: the review loop can still be *entered* with no open PR (manual `px review` that bypassed handoff, a partial handoff failure, or a closed/merged PR), where lib/review/review-loop.js:550-557 currently dead-ends with misleading `--submit` guidance.

New scope (self-heal): when the loop finds no open PR for a post-implementation task, automatically invoke performHandoff (push + create PR, now reliable post-1317), re-check PR status, and continue the loop once the PR exists. Only when self-heal cannot yield an open PR do we error — and the fallback recommends `px review <slug> --push` plus the handoff failure reason, never the old `--submit`. Gatekeeper pushback short-circuits; dry-run never self-heals. Full contract in missions/task-1303/MISSION.md. See [[TASK-1317]].
<!-- SECTION:NOTES:END -->
