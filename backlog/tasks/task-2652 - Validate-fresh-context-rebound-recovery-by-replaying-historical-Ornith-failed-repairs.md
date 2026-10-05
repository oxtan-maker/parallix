---
id: TASK-2652
title: >-
  Validate fresh-context rebound recovery by replaying historical Ornith failed
  repairs
status: backlog
assignee: []
created_date: '2026-10-05 19:16'
updated_date: '2026-10-05 19:18'
labels:
  - evaluation
dependencies: []
references:
  - >-
    backlog/completed/task-2588 -
    Escalate-failed-rebounds-to-fresh-context-diagnostic-repair.md
  - >-
    backlog/completed/task-2575 -
    Give-self-development-gate-rebounds-authority-to-repair-the-failing-defence.md
  - src/application/rebound-kernel.ts
  - >-
    backlog/tasks/task-2653 -
    Record-each-rebound-repair-attempt-as-durable-recovery-telemetry.md
priority: medium
ordinal: 164008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Test the hypothesis behind TASK-2588: after a targeted rebound repair completes but the authoritative verifier is still red, a fresh Pi context given the fresh-diagnostic prompt repairs more often than the failed session resumed with the same prompt, from the same repository state.

A contradicted, inconclusive or "insufficient cases" result is a valid outcome. Do not change production recovery policy. This mission validates an engineering decision; it produces no content or publishing material.

## Key idea: replay real failed attempts, do not re-run attempt 1

Historical attempt-1 failures already exist. Before TASK-2588 (landed 2026-10-01, commit 1817c5884), a failed attempt 1 was followed by a resumed attempt 2 in the same Pi session. Pi sessions that contain a `Retry attempt: 2/2` prompt are therefore natural failed-first-repair cases. Truncating such a session just before the `2/2` prompt reproduces the exact failed context. No attempt 1 is run and no failure is manufactured.

## Model: Ornith only

Use only sessions whose every message reports `provider=vllm`, `model=AtomicChat/Ornith-1.5-35B-A3B-GGUF:Q4_K_M`. It is the fastest local model and has the largest pool. Candidate missions with `2/2` in an Ornith session (verify each; grep counts may include quoted text): 2361, 2373.01, 2390, 2396, 2407, 2413, 2419, 2437, 2455.03, 2465, 2470, 2475, 2477, 2478, 2479, 2489, 2497, 2498, 2502, 2510, 2517, 2525.02, 2525.04, 2527, 2530, 2531, 2546.

Both arms run Pi pinned to that model ID against the configured vllm endpoint. Record what the server reports for that model (`/v1/models` and any quant/file metadata) and confirm it is still the same artifact used historically. If identity cannot be confirmed, label results "same model ID" rather than "same model". Do not mix in other models' sessions. Do not use cloud agents for any benchmark run.

Operator prerequisite: Ornith is not served by default (the current Pi `defaultModel` is `qwen3.8-27b`); the operator must make it available before activation. Preflight before Phase 0: query the endpoint's model list and stop with "Ornith not served" if the Ornith model ID is absent or a one-token completion against it fails. Do not change the operator's Pi `defaultModel` or the inference server configuration; pin the model per invocation in the scratch Pi agent directory.

## Isolation and write location (mandatory)

- All experiment execution happens under `/tmp/parallix-recovery-eval/<run-id>/`: scratch repositories, Pi session copies, a temporary `PARALLIX_HOME`, raw transcripts and verifier logs.
- Never invoke `px` from the harness. Call Pi directly with prompts rendered by the exported rebound prompt builders in `src/application/rebound-kernel.ts`.
- Set `PARALLIX_HOME` to a temp dir under the run root and abort if it resolves to the operator's default home. Record sha256 of the operator's `parallix.db` before and after the whole run; any change invalidates the run.
- Copy Pi sessions into a scratch Pi agent directory under the run root. Never resume or modify originals in `~/.pi/agent/sessions`. Determine how the installed Pi selects its agent/session directory (flag or environment variable) and refuse to start if a launch would read or write the real one. Copy only the config Pi needs (models/settings/auth) into the scratch agent dir.
- Read historical DB data only from a SQLite backup-API snapshot opened read-only with `node:sqlite`; the system `sqlite3` cannot parse the STRICT schema.
- Scratch repositories are standalone `git init` repos with no remotes. Fetch historical commits into a scratch clone under the run root, never into the operator checkout.
- The local model has one inference slot: run arms strictly sequentially and only when no other mission is using `custom`.

## Phase 0 — harvest and validate cases (stop gate)

For each Ornith candidate:

1. Locate the Pi session and the `FIX REQUIRED ... Retry attempt: 2/2` prompt. Extract the diagnostic and failure fingerprint embedded in that prompt and its timestamp.
2. Find the mission's Forgejo PR (`review` remote, `refs/pull/N/head`; branches are deleted but PR refs survive) and list its pre-squash commits via the Forgejo API. Pick the last commit at or before the `2/2` prompt timestamp. Confirm the commit is fetchable (rebases can orphan earlier SHAs).
3. If attempt 1 left uncommitted edits, reconstruct them from Pi's recorded edit/write tool calls. Prefer cases where attempt 1 committed; drop any case whose reconstruction is ambiguous.
4. Narrow the verifier to the specific failing test file(s) named in the diagnostic. Exclude cases whose failing gate is model-dependent or nondeterministic (`agent-smoke`, `smoke`) or needs infrastructure unavailable in a scratch repo.
5. Validity gate: on the reconstructed tree the focused verifier is red 3/3 with the recorded fingerprint, and green on the historical fixed tree (PR head or later). Otherwise drop the case and record why.
6. Record the historical (observational) outcome of the resumed attempt 2, inferred from whether a further rebound with the same fingerprint followed. Label it inferred and observational.

If fewer than 3 cases pass, stop and report "insufficient failed-first-repair cases".

## Phase 1 — paired replay pilot

For each valid case, build the frozen start once: reconstructed tree (tree hash recorded) and the Ornith session JSONL truncated immediately after attempt 1's final assistant turn. Record compaction entries present in the truncated session.

- Arm A (resumed): resume the truncated session copy.
- Arm B (fresh): new Pi session.
- Both receive the byte-identical current fresh-diagnostic prompt rendered once (store sha256), with the same diagnostic evidence. Repository paths in the prompt and the session cwd must be identical for both arms: recreate the scratch repo at an equivalent path or rewrite the path identically, and record it.
- Restore the frozen tree before each arm. Randomize arm order per case.
- Per-arm wall-clock and turn cap equal to the production rebound timeout. A timeout is a failed arm unless the endpoint health check before/after shows the server was down (then the pair is excluded and logged).
- Success: focused verifier green, protected tests/gates not weakened (diff check on test and gate files), no unrelated destructive change. Run the full historical gate only for arms that turned green.

Pilot is 3 pairs. Before scaling, demonstrate: A really continues the attempt-1 conversation, B contains none of it, start tree hashes match, prompt hashes match, per-invocation Pi usage is captured, verifier is deterministic. Scale to at most 8 pairs only if the pilot is mixed and controls hold. Only one sample per arm per case unless pilot results are split.

## Time discipline

- Share `node_modules` across scratch repos keyed by lockfile hash (copy/hardlink) instead of a fresh install per repo.
- `results.jsonl` is append-only; the runner skips completed (case, arm) rows so it can run unattended and resume.
- Agents only inspect, repair, commit, stop; no post-repair explanations.

## Deliverables

Harness and docs in `tools/recovery-context-evaluation/` (README, runner, `scenarios.json`, `results.jsonl`, short `report.md`). Raw transcripts, session copies and scratch repos stay under `/tmp` and are never committed. No new product commands, schema, lifecycle states, retry policy or telemetry authority.

One result row per arm: case, mission, historical commit, arm, model, model identity evidence, prompt hash, start tree hash, compactions, head before/after, fingerprint before/after, exit status, verifier pass, valid repair / invalid reason, Pi input/output/cached tokens, tool calls, duration.

Report: paired table (both / fresh only / resumed only / neither), per-arm rescue rate, median tokens/tool calls/duration, observational Phase 0 outcomes kept separate. Interpretation guard: with n of about 5 to 8, call it "supported" only if at least 5 discordant pairs all favor one arm; otherwise "weak directional support" or "inconclusive". State model-specificity (Ornith, pre-2588 era) as a limitation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Phase 0 lists every Ornith candidate with keep/drop reason, model filter evidence, PR commit used and the 3/3 red plus green-on-fix verifier validation
- [ ] #2 If fewer than 3 cases validate, the mission stops and reports insufficient failed-first-repair cases
- [ ] #3 Every run executes under /tmp/parallix-recovery-eval/<run-id>/ with a temporary PARALLIX_HOME; the operator parallix.db sha256 is identical before and after, and original Pi sessions are untouched
- [ ] #4 Each pair shows matching start tree hash, matching prompt sha256, proof that Arm A continued the truncated attempt-1 session and that Arm B contained none of it, and the same Ornith model identity
- [ ] #5 No attempt 1 is re-run, no cloud agent is used, and no px command is invoked by the harness
- [ ] #6 results.jsonl contains one row per arm including failed, timed-out and excluded runs with reasons
- [ ] #7 report.md gives the paired outcome table, cost comparison, limitations and a decision of supported, weak directional support, inconclusive, contradicted or insufficient cases
- [ ] #8 Preflight confirms the Ornith model ID is served and answers a one-token completion before Phase 0; otherwise the mission stops with "Ornith not served" without changing operator Pi or server configuration
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
