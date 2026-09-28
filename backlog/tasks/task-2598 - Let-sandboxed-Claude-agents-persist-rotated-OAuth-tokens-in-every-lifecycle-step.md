---
id: TASK-2598
title: >-
  Let sandboxed Claude agents persist rotated OAuth tokens in every lifecycle
  step
status: backlog
assignee: []
created_date: '2026-09-28 03:28'
labels:
  - sandbox
  - claude
  - auth
dependencies: []
references:
  - TASK-2443
  - src/adapters/process/bubblewrap.ts
  - src/adapters/config/state-homes.ts
  - src/adapters/agents/claude.ts
  - src/adapters/agents/agents.ts
documentation:
  - docs/operator-setup.md
priority: high
ordinal: 129008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Operators keep hitting this error on Claude missions, even the day after running a fresh `claude` login:

```
Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.
```

This blocks the claude family almost every time in parallix.

## Likely root cause

Bubblewrap mounts all of `/` read-only. For the `claude` family, `resolveLauncherStateHomes` in `src/adapters/process/bubblewrap.ts` re-binds only the single file `~/.claude/.credentials.json` as writable, from `claudeCredentialsPath` in `src/adapters/config/state-homes.ts`. The directory `~/.claude/` stays read-only.

Claude access tokens expire after about 8 hours. A sandboxed agent that finds an expired token does this:

1. It refreshes the token with the refresh token.
2. The server rotates the refresh token, so the old one stops working.
3. The agent tries to save the new tokens by writing a temp file in `~/.claude/` and renaming it over `.credentials.json`. The save fails: the directory is read-only, and renaming onto a bind-mount target fails regardless. The rotated tokens exist only in that process's memory.
4. The host `.credentials.json` still holds the revoked refresh token. From then on, every Claude launch, sandboxed or not, fails with the 401 until the operator logs in again.

A re-login only helps until the next access-token expiry. This explains why "re-login yesterday didn't help".

The atomic-rename save is inferred, not verified. The implementer must confirm how the Claude CLI writes `.credentials.json` before choosing a fix.

TASK-2443 introduced the current single-file bind. This task finishes that work for Claude's refresh-token rotation.

## Desired outcome

A Claude agent launched by parallix always has a usable, non-revoked OAuth credential, whatever the lifecycle step: implementer/draft, review, fix/rework, integration, preflight, smoke, and any other step that launches the claude family, sandboxed or not. It must never leave the operator's host credentials in a revoked state. The sandbox must not be widened beyond what is needed. Specifically, the agent must not gain write access to `~/.claude/settings*.json`, hooks, skills, `CLAUDE.md`, or memory.

A long-lived `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) in the operator environment already bypasses the problem, and must keep working.

Candidate approaches, to evaluate rather than prescribe:
- Refresh the token outside the sandbox before each claude launch when `expiresAt` is near.
- Serialise refreshes across concurrent missions.
- Bind a minimal writable location that lets the CLI's save succeed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Claude CLI's actual credential write mechanism (in-place write vs temp file + rename, and in which directory) is verified and recorded in the task notes, confirming or refuting the root cause above
- [ ] #2 A claude-family agent launched under the bubblewrap sandbox with an expired access token ends with a valid, non-revoked refresh token in the host ~/.claude/.credentials.json
- [ ] #3 This works for every lifecycle step that launches the claude family (implementer, review, fix/rework, integration/preflight, smoke), each covered by a test that runs the step's sandbox profile
- [ ] #4 Concurrent claude missions refreshing at the same time do not revoke each other's credentials (no lost refresh-token rotation)
- [ ] #5 The sandbox grants no write access under ~/.claude beyond what credential persistence strictly needs; settings, hooks, skills, CLAUDE.md and memory stay read-only, and a test asserts this
- [ ] #6 Operators who set CLAUDE_CODE_OAUTH_TOKEN keep working unchanged, and are not forced through the refresh path
- [ ] #7 When refresh is impossible (for example a revoked refresh token), the launch fails with the existing 'credentials need refreshing' diagnostic and does not persist a family block
- [ ] #8 docs/operator-setup.md explains how Claude credentials are kept fresh across missions, and documents CLAUDE_CODE_OAUTH_TOKEN as an alternative
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
