---
name: act-on-review
description: Use when the user explicitly asks to process review feedback for a visualBoard mission, including `/act-on-review` invocations. This is a thin launcher only; load and follow AGENTS.md, the locked MISSION.md, and docs/agent-prompts/act-on-review.md.
user-invocable: true
---

# Act On Review

This skill is a thin entrypoint for the visualBoard act-on-review workflow.

Load and follow:
1. `AGENTS.md`
2. the locked `MISSION.md` for the mission you are acting on
3. `docs/agent-prompts/act-on-review.md`

Read live Forgejo findings first, separate stale comments from current ones, and keep the review-response loop in the PR.
