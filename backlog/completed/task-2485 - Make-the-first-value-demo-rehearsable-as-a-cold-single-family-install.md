---
id: TASK-2485
title: Make the first-value demo rehearsable as a cold single-family install
status: done
assignee: [codex]
created_date: '2026-09-11 08:35'
labels:
  - repositioning
  - demo
  - tooling
  - user_value
dependencies: []
references:
  - scripts/record-first-value-demo.sh
  - src/domain/review.ts
  - test/e2e-real-agent-smoke.test.ts
documentation:
  - docs/designs/reposition-as-trust-layer.md
  - docs/real-agent-smoke.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`scripts/record-first-value-demo.sh` already does almost everything a cold-install rehearsal needs: a disposable repo under `mktemp`, an isolated `PARALLIX_HOME` that never touches the operator's real state, `review.provider = "none"` (the no-Forgejo path), a real repo-owned verification gate, `px` placed on PATH as a stranger would type it, and a full `draft` to `active` to `integrate` lifecycle. It should be extended rather than duplicated.

Two things stop it from representing a stranger's first run.

First, the agent eligibility list is hardcoded to three families. Under the eligibility rules in `src/domain/review.ts`, three eligible families means cross-family review separation is enforced, so the recorded demo shows the reviewer being a different family than the implementer. A cold operator who has configured only one agent family falls into the documented single-family fallback and sees self-review instead. The demo currently in the README therefore shows a final screen that a single-provider operator will not get. Making eligibility a parameter lets the same script produce both transcripts so the difference can be read rather than guessed.

Second, the script resolves `px` from the checkout's `build/px.mjs` by default. `PX_BIN` is already an environment variable, so pointing it at a globally installed `px` requires no code change, but the rehearsal procedure needs to actually do so.

Be honest about the ceiling. This script drives an interactive shell over a pty and waits for the prompt by regex-matching the tail of the stream, with a long per-command timeout, while invoking real agents whose output is non-deterministic and network- and usage-cap-dependent. It is an operator-run rehearsal, not a gate, and it should say so in its own header. Note also that it writes its own `config/agents.json` rather than letting first-run detection produce one, so its transcript is suggestive evidence about the default path, not proof.

Existing coverage that must not be duplicated: `test/e2e-mission-lifecycle.test.ts` (the `workflow` gate) is the deterministic stubbed lifecycle harness, and `test/e2e-real-agent-smoke.test.ts` (the `custom-agent-smoke` gate) already forces a single family with a real local model and asserts the self-review fallback. This task adds a rehearsal for observing operator-visible output, not new lifecycle coverage.

Known operational hazard: `custom-agent-smoke` is unreliable when other missions run concurrently and should be exercised solo.

Surfaced by a CEO plan review of the trust-layer repositioning work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Agent family eligibility in scripts/record-first-value-demo.sh is a parameter rather than a hardcoded list, defaulting to today's behavior
- [ ] #2 The script can be run against a globally installed px without editing the script
- [ ] #3 The script exits non-zero when the mission does not reach integrate, and when the verification gate did not run
- [ ] #4 A header comment states that the script is operator-run, invokes real agents, is non-deterministic, and that its exit code is a convenience rather than a gate
- [ ] #5 Running the script with a single eligible family produces a complete transcript, and the reviewer-selection output in it is captured verbatim for the repositioning work
- [ ] #6 Running the script with the current three-family default still produces a usable demo recording
- [ ] #7 No lifecycle assertions are duplicated from test/e2e-mission-lifecycle.test.ts or test/e2e-real-agent-smoke.test.ts
- [ ] #8 docs/ records how to run the rehearsal in both configurations and what its output can and cannot be used to claim
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
