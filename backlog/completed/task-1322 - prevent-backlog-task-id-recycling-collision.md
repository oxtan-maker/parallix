---
id: TASK-1322
title: session not found error
status: done
assignee: [codex]
created_date: '2026-06-17 03:59'
updated_date: '2026-06-17 06:00'
labels: [ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When running task-1273 I encontered this error:

Rebasing mission/task-1273 onto the latest primary branch before reviewer launch...
[PASS] Pre-review rebase completed for mission/task-1273.
[INFO] Round 2: launching reviewer (qwen)...
[INFO] Selected agent for step "review": qwen (opencode)
[INFO] Resuming qwen (opencode) session for task-1273 (reviewer). Session: ses_..."
[INFO] Launching: opencode run --pure --dangerously-skip-permissions -s ses_..." Mode: review. No code changes, no repo-state edits.
Mission: /home/magnus/code/parallix-task-1273/missions/task-1273/MISSION.md
Attempt: 2. Focus: all.

Entrypoint: $review all

Minimum loop contract:
- Load the locked mission at `/home/magnus/code/parallix-task-1273/missions/task-1273/MISSION.md` and `AGENTS.md` before reviewing.
- Run `px review task-1273 --verify`.
- Review the diff with `git diff main..HEAD`. Do a detailed review, since agents tend to miss stuff and just check off boxes in the checkpoints, which is not the intent here.
- Confirm the final checkpoint document in the mission directory contains a Goal Check table citing real evidence (file:line, test names).
- Write findings to `/tmp/task-1273-review-findings.md`.
- Write the formal outcome to `/tmp/task-1273-review-outcome.md` and the legacy verdict (`approve` | `request-changes`) to `/tmp/task-1273-review-verdict.txt`. `comment` is not a valid outcome: if you have findings but the criteria pass, use `request-changes`.
- Do not post to Forgejo directly; `px review task-1273 --start` or `--submit` publishes the artifacts.
- Do not edit repo files; do not switch into implementer behavior.
- If workflow state, prompts, or PR history are inconsistent, report that inconsistency as a finding rather than fixing it.

[INFO] Working directory: /home/magnus/code/parallix-task-1273
Error: Session not found
[WARN] Agent qwen (opencode) failed to complete (exit 1 (Error: Session not found)); retrying with next eligible agent.
[INFO] Selected agent for step "review": mistral (attempt 2)

---

Find the root cause and fix the error so happy path works again (ensuring sessions are found and not corrupted)
Also implement a fallback so if session is not found parallix starts a new session as a fallback (and makes that the recorded session instead)
<!-- SECTION:DESCRIPTION:END -->
