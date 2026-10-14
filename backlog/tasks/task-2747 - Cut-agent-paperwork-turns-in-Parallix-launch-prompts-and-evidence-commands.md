---
id: TASK-2747
title: Cut agent paperwork turns in Parallix launch prompts and evidence commands
status: backlog
assignee: []
created_date: '2026-10-14 14:06'
labels:
  - ai_sdlc
dependencies: []
references:
  - test/e2e/agents/real-agent-smoke.test.ts
  - docs/real-agent-smoke.md
priority: medium
ordinal: 237008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Agents spend most of their model calls on Parallix paperwork rather than on the mission. In a real-agent smoke run of the trivial hello.sh fix (TASK-2739 analysis, Pi runner with reasoning off, about 72 seconds total), the draft, execute and review sessions made about 23 model calls, and only 3 of them touched hello.sh. Each call costs 1 to 5 seconds on the local backend. Tool execution was about 4 seconds in total. The same prompts drive real missions, so every saving applies to production as well as the smoke gate.

Observed friction and proposed changes, highest expected saving first:

1. Embed the status snapshot in the launch prompt. Every session's first call is `px status` (plus ls/cat), although Parallix already holds the brief, criteria, checkpoint plan and version at launch. The execute prompt even says "Harness preflight already confirmed ... the mission brief is recorded and readable" and then asks the agent to load it. Include the snapshot and state that it is current as of launch.

2. Stop asking for a status re-read after each write. The execute prompt says "Reload status after each write" and also asks for a reload via `px status` after each checkpoint and each gate (compaction). `checkpoint record` and `mission mark-complete` already return the new state as JSON. Say the write output is the readback, and keep the compaction step only for runners that actually compact.

3. Merge evidence recording and criterion completion. Today the agent runs one `px checkpoint record` and then N `px mission mark-complete` calls, and the prompt has to explain that "Recording checkpoint evidence does not mark criteria complete". Add a `--complete` option to `checkpoint record` that marks each criterion named by its rows, or let `mark-complete` accept several criteria. This also removes a recurring handoff failure in which evidence is recorded but a criterion is left incomplete.

4. Give the reviewer the handoff gate result and the mission diff without workflow-owned changes. The reviewer re-ran `./scripts/verify-local.sh all` and spent calls and reasoning on Backlog lifecycle commits (status and assignee transitions). The review prompt should carry the recorded gate result with its sha, and should either give the diff without Parallix-owned `backlog/` lifecycle changes or state explicitly that those changes are expected. The smoke fixture's coaching line about lifecycle commits in its task description can then be removed.

5. Use a short `px` in prompts. The absolute bundled px path (about 120 characters) appears about 25 times per prompt, and the model writes it out on every call because it cannot use a variable. That costs roughly 35 output tokens per call. Put a `px` shim first on the agent PATH (or export a PX variable) and write `px` in the prompt text.

6. Make the Graphify-first paragraph conditional on `graphify-out/graph.json` existing. Every session ran `ls graphify-out` because the prompt says to check first; Parallix can check this itself and omit the paragraph.

7. Inline the exact flags instead of telling the agent to run `--help`. Baseline sessions read `px mission author --help`, `px checkpoint record --help` and `px --help`, although the prompt already names the commands.

8. Ask for a short final response. Every session ended with a 1,000 to 1,500 character summary, about 3 seconds of decode each, although the durable state is in px. A 2 to 3 line closing message is enough.

9. Resolve the gate contradiction in the execute prompt. It says "do not rerun a complete declared gate solely as lifecycle ritual" but its termination rule requires that "every mission-declared gate passes", and agents resolve this by running the gate in every session. State that handoff runs the declared gates and that an agent runs one only to diagnose a concrete failure.

Rough estimate: items 1, 2, 4, 5 and 8 together remove about 8 to 10 model calls per smoke run, about 15 to 25 seconds off roughly 75 seconds. Items 3 and 9 mainly prevent failure-and-repair loops in real missions, which cost far more than a clean run.

Measurement method: run `PARALLIX_E2E_KEEP_TMP=1 npm run test:agent-e2e` and inspect the retained Pi session JSONL files under the fixture's `pi-agent/sessions` directory for per-call timing, tool calls and output tokens. Compare call counts and elapsed time before and after.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Launch prompts for draft, execute and review include a current status snapshot, and the first-call status read disappears from smoke sessions
- [ ] #2 The execute prompt no longer asks for a status reload after each write, and write output is documented as the readback
- [ ] #3 Evidence recording and criterion completion can be done in one px call, with the existing handoff evidence checks unchanged
- [ ] #4 The review prompt carries the recorded handoff gate result and identifies Parallix-owned Backlog lifecycle changes, and the reviewer no longer re-runs the declared gate in a clean smoke run
- [ ] #5 Prompts refer to px through a short command available on the agent PATH instead of the absolute bundle path
- [ ] #6 The Graphify paragraph appears only when graphify-out/graph.json exists
- [ ] #7 Exact command flags are inline, and agents are asked for a short final response
- [ ] #8 The execute prompt states consistently who runs declared gates
- [ ] #9 Before/after smoke runs on the same runner and model report model-call counts and elapsed time, with all lifecycle assertions unchanged
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
