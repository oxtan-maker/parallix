---
id: TASK-1348
title: local blocklist does not get updated
status: active
assignee: [qwen]
created_date: '2026-06-25 16:54'
labels: [ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
if the agent blocklist does not exist (in the main dir) it does not seem to get updated when agents fail, and also when all other agents than the implementer is blocked the fallback review with the implementer model does not seem to work. Example: 

Mission: /home/magnus/code/parallix-task-1347/missions/task-1347/MISSION.md
Attempt: 1. Focus: all.

Entrypoint: $review all

Minimum loop contract:
- Load the locked mission at `/home/magnus/code/parallix-task-1347/missions/task-1347/MISSION.md` and `AGENTS.md` before reviewing.
- Run `px review task-1347 --verify`.
- Review the diff with `git diff main..HEAD`. Do a detailed review, since agents tend to miss stuff and just check off boxes in the checkpoints, which is not the intent here.
- Confirm the final checkpoint document in the mission directory contains a Goal Check table citing real evidence (file:line, test names).
- Write findings to `/tmp/task-1347-review-findings.md`.
- Write the formal outcome to `/tmp/task-1347-review-outcome.md` and the legacy verdict (`approve` | `request-changes`) to `/tmp/task-1347-review-verdict.txt`. `comment` is not a valid outcome: if you have findings but the criteria pass, use `request-changes`.
- Do not post to Forgejo directly; `px review task-1347 --start` or `--submit` publishes the artifacts.
- Do not edit repo files; do not switch into implementer behavior.
- If workflow state, prompts, or PR history are inconsistent, report that inconsistency as a finding rather than fixing it.
- Graphify-first: before reviewing, check if `graphify-out/graph.json` exists. If it does, run `graphify query "review task-1347 for correctness and completeness"` to get a graph-based view of the mission scope before examining the diff.
 --trust --output text
[INFO] Working directory: /home/magnus/code/parallix-task-1347
Error: API error from mistral (model: mistral-vibe-cli-latest): Invalid API key. Please check your API key and try again.
[WARN] Agent mistral failed to complete (exit 1 (Error: API error from mistral (model: mistral-vibe-cli-latest): Invalid API key. Please check your API key and try again.)); retrying with next eligible agent.
[FAIL] Could not launch reviewer agent (codex): All eligible agents exhausted for step "review". Tried: codex, mistral. Errors: codex: exit 1 (OpenAI Codex v0.142.2); mistral: exit 1 (Error: API error from mistral (model: mistral-vibe-cli-latest): Invalid API key. Please check your API key and try again.).
[px] ERROR: target directory '/tmp/integrate-v2-root' not found.
magnus@debian:~/code/parallix-task-1347$
<!-- SECTION:DESCRIPTION:END -->
