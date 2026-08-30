---
id: TASK-2443
title: >-
  Let every agent family persist its credentials and state under the bubblewrap
  sandbox
status: done
assignee: [codex]
created_date: '2026-08-30 06:16'
updated_date: '2026-08-30 06:19'
labels:
  - bug
  - agents
  - sandbox
  - reliability
  - user_value
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Agent launches keep failing on credentials that the sandbox will not let the launcher refresh, and the workflow reroutes to another family instead of reporting it. The visible symptom for the `claude` family is `API Error: 401 OAuth access token has expired. Re-authenticate to continue.`, together with `Failed to run: EROFS: read-only file system, mkdir '<home>/.claude/session-env/<session-id>'`.

Root cause: the bubblewrap guard mounts the whole filesystem read-only (`--ro-bind / /` in `src/adapters/process/bubblewrap.ts`). For non-review steps, `resolveSandboxProfile` grants writable binds only for the worktree, the Git metadata directories and `/tmp`; the operator home is read-only for every implementer launch. Only the `review` branch grants launcher state homes, via `resolveReviewLauncherStateHomes`. That is inverted: implementer steps write more launcher state than reviewer steps, yet get less. Any launcher whose credential or state path resolves to the host home therefore cannot persist a refreshed OAuth token, and keeps failing on every subsequent launch until a human refreshes the token by hand outside the sandbox.

Affected families:

1. `claude` — its CLI keeps a short-lived OAuth access token in `~/.claude/.credentials.json`, writes session state to `~/.claude/session-env`, and per-worktree transcripts to `claudeProjectDir(worktree)`. All read-only at non-review steps, so a token refresh can never be persisted.
2. `codex` — `codex.ts:213` symlinks the worktree-local `CODEX_HOME/auth.json` to the host `~/.codex/auth.json` (`replaceWithLink`). A token refresh follows the symlink to host home and hits the same read-only mount. This is the family `claude` currently falls back to, so both can be dead at once.
3. `opencode`, `pi`, and `custom` (which resolves to one of them) — their state lives in host home (`opencodeStateHomes()`: `~/.local/share/opencode`, `~/.config/opencode`, `~/.cache/opencode`; `piStateHomes()`: `~/.pi`). These are granted only in the `review` branch, so draft and implement launches cannot write them at all.
4. `qwen` — a different defect with the same theme: `ensureQwenHome` (`qwen.ts:61`) seeds only `settings.json` into the worktree-local `QWEN_HOME` and never copies `oauth_creds.json`, so an OAuth-authenticated operator's `qwen` starts unauthenticated in every mission. No `EROFS`; a missing credential rather than an unwritable one.
5. `vibe` — not affected. It copies `~/.vibe/config.toml` and `~/.vibe/.env` into the worktree home; a static key needs no write-back.

Evidence: 15 mission transcripts under `~/.claude/projects/` contain the expired-token error, one or more per day since 2026-08-21, matching the sandbox landing (2026-08-13/14) and its tightening (2026-08-21). The refresh token in `.credentials.json` stays valid for two weeks while the access token expires roughly every eight hours, which matches the observed cadence. The failure is classified as a deterministic config error by `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` (`src/adapters/agents/agents.ts:100-120`), so no blocklist entry is written and the run quietly reroutes — which is why the symptom reads as "parallix keeps getting blocked" rather than a reported auth failure.

Scope: give every family the minimum writable host paths its launcher actually needs, at every workflow step rather than only at `review`, derived from one place so the sandbox set cannot drift from the launcher's real directories; seed `qwen` credentials the way its settings are already seeded; and make an auth failure visible to the operator instead of a silent reroute.

Non-goals: do not disable bubblewrap, do not widen the sandbox to `$HOME`, to all of `~/.claude`, or to any home directory as a whole, and do not change agent-selection or fallback policy beyond the diagnostic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Launcher state homes are granted at every workflow step, not only at `review`: the writable set for a step is the family's own state paths plus the existing per-step paths (worktree and Git metadata for implementer steps, artifact dir for review).
- [ ] #2 `claude` can persist a token refresh and its session state at a non-review step: `~/.claude/.credentials.json`, `~/.claude/session-env`, and `claudeProjectDir(worktree)` are writable inside the sandbox.
- [ ] #3 `codex` can persist a token refresh: the host `~/.codex/auth.json` that `replaceWithLink` targets is writable inside the sandbox, since the worktree-local `auth.json` is a symlink to it.
- [ ] #4 `opencode`, `pi`, and `custom` can write their host-home state homes at draft and implement steps, not only at review.
- [ ] #5 `qwen` starts a mission authenticated: `ensureQwenHome` seeds `oauth_creds.json` from the operator's `~/.qwen` into the worktree-local `QWEN_HOME` alongside `settings.json`, tolerating an absent source file exactly as the settings path already does.
- [ ] #6 The writable set stays narrow: no bind for `$HOME`, for `~/.claude`, `~/.codex`, or `~/.qwen` as a whole, and no family gains write access to another family's state.
- [ ] #7 Every host path in the sandbox writable set is derived from `src/adapters/config/state-homes.ts`, so the sandbox set and the paths the launchers actually initialize cannot drift apart.
- [ ] #8 Unit tests assert the generated bwrap argv for a non-review launch of `claude`, `codex`, `opencode`, and `pi` contains a writable bind for each of that family's required paths and still contains `--ro-bind / /`; each fails against the current behaviour.
- [ ] #9 A unit test asserts a family gains no writable bind belonging to another family, and that `vibe` and `qwen` gain no host-home write access.
- [ ] #10 A unit test covers the `qwen` credential seed: present source is copied, absent source leaves the existing minimal-settings behaviour unchanged.
- [ ] #11 When a launch fails on an authentication or expired-credential error, the operator-facing log names the family and states that its credentials need refreshing, rather than only `retrying with next eligible agent`.
- [ ] #12 `./scripts/verify-local.sh static-analysis` and the focused new tests pass on the final tree.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #2 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #3 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #4 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #5 The checkpoint records the bwrap argv produced for a non-review launch of each affected family, before and after the fix.
- [ ] #6 The checkpoint lists exactly which host paths became writable per family and confirms no whole-home or cross-family bind was introduced.
- [ ] #7 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #8 Lint and static analysis report clean on every changed file
<!-- DOD:END -->
