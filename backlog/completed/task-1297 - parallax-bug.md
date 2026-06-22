---
id: TASK-1297
title: parallix bug
status: done
assignee: [qwen]
created_date: '2026-06-13 18:35'
updated_date: '2026-06-17 00:00'
labels: [ai_sdlc]
dependencies: []
priority: medium
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Carry-forward from task-1284 review: the autonomous review verdict was `request-changes` due to F1 (HIGH) — regex permissiveness in `lib/core/mission-utils.js:536-538` in `detectMissionAreaFromContent`.

The function's regex `/(?:^|\s)\.{1,2}\/[\w./-]+\s+([a-zA-Z0-9_-]+)/m` matches any `./` or `../`-prefixed path followed by a word, extracting it as a verification area argument. This contradicts the inline comment which claims the relative-path prefix prevents prose matches. In practice, prose like "We should run ./scripts/deploy.sh server before merging" triggers a false positive, returning `'server'` instead of the fallback `'docs'`.

Validate that this bug still exists in the current codebase and fix it.
<!-- SECTION:DESCRIPTION:END -->

## Resolution

Fixed: Tightened the regex in `detectMissionAreaFromContent` (lib/core/mission-utils.js:538) to:
- Require scripts to have recognized extensions (.sh/.bash/.py/.rb) or be bare executables (no dots)
- Require the area argument to be at end-of-line, preventing mid-sentence prose matches

Added regression test in test/mission-utils.test.js:135. All 1556 tests pass.
