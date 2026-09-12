# Mission: Make the first-value demo rehearsable as a cold single-family install (task-2485)

## Goal
Let an operator rehearse the first-value demo as a cold installation with either one eligible agent family or the existing three-family configuration, using a chosen `px` executable, while making the transcript, failure conditions, and evidence limits explicit.

## Why Now
The trust-layer repositioning work needs an honest, repeatable demonstration of what a new single-provider operator actually observes. The current recording hardcodes three eligible families and therefore demonstrates cross-family review separation instead of the documented single-family self-review fallback. Correcting the rehearsal before the repositioning material relies on it prevents claims that the cold-install path has not demonstrated.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: parameterize demo eligibility; preserve the default three-family recording; make `PX_BIN` rehearsal use and failure evidence explicit; document the two operator-run configurations and their evidentiary limits.

## Scope
- Extend `scripts/record-first-value-demo.sh` so eligible agent families are supplied through a parameter, with the existing three-family list retained as the default.
- Keep `PX_BIN` as the executable override and make the rehearsal procedure use it with a globally installed `px` without editing the script.
- Make the script return non-zero if the mission does not reach `integrate` or the configured repository-owned verification gate was not run.
- Add a script header that says the rehearsal is operator-run, invokes real agents, is non-deterministic, and has a convenience exit code rather than gate status.
- Capture the complete single-family transcript and its reviewer-selection output verbatim for the trust-layer repositioning evidence, then retain a usable recording for the default three-family run.
- Document both runs and the claims their output supports and does not support.

## Out of Scope
- Changing review eligibility or the single-family self-review fallback in `src/domain/review.ts`.
- Changing the deterministic lifecycle harness in `test/e2e-mission-lifecycle.test.ts` or the real-agent smoke coverage in `test/e2e-real-agent-smoke.test.ts`.
- Turning this real-agent, PTY-driven rehearsal into a deterministic CI gate or adding duplicate lifecycle assertions.
- Making first-run configuration detection real; the rehearsal may continue writing its isolated `config/agents.json`.
- Guaranteeing agent availability, network success, provider quota, or deterministic transcript timing.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `scripts/record-first-value-demo.sh` accepts an eligible-agent-family input and, when omitted, uses the current three-family eligibility list.
- A caller can set `PX_BIN` to a globally installed `px` executable and run the rehearsal without editing `scripts/record-first-value-demo.sh`.
- The rehearsal exits non-zero when its mission fails to reach `integrate`, and separately when its repository-owned verification gate was not observed as run.
- The script header explicitly identifies the run as operator-run, real-agent-driven, non-deterministic, and non-gating; it also states that its exit status is convenience feedback.
- A single-family run reaches `integrate`, produces a complete transcript, and stores the reviewer-selection output verbatim as repositioning evidence.
- A default three-family run produces a usable demo recording and continues to show the existing default eligibility behavior.
- No lifecycle assertions are added to `test/e2e-mission-lifecycle.test.ts` or `test/e2e-real-agent-smoke.test.ts`; the rehearsal remains observational evidence.
- Authored documentation gives the exact operator procedure for the single-family and default three-family runs, identifies `PX_BIN` use, and distinguishes suggestive rehearsal evidence from proof of first-run detection or a CI gate.

## Risks and Assumptions
- Real agents, network access, and usage limits can make a rehearsal slow, unavailable, or non-deterministic; run it interactively and retain its output rather than treating it as a test result.
- PTY prompt matching and its long per-command timeout can make a failed run slow to diagnose; the implementer must preserve isolated temporary-repository and `PARALLIX_HOME` behavior.
- `custom-agent-smoke` is unreliable during concurrent missions; if it is needed for investigation, run it solo, but do not add it as a mission gate.
- The scripted `config/agents.json` models a configured operator, not first-run discovery; documentation must not claim otherwise.
- The existing default list and repository-owned verification gate remain available while this mission is implemented.

## Checkpoints
- CP 1: Inspect the current rehearsal contract and implement the family-eligibility parameter, `PX_BIN` operator path, explicit non-gating header, and non-zero completion/verification failure handling while preserving isolation and the three-family default.
- CP 2: Run and retain the single-family cold-install rehearsal transcript, including verbatim reviewer-selection output, then run and retain the default three-family recording; compare each observed review-selection mode only to the configuration it exercised.
- CP 3: Update the operator documentation for both configurations, their command inputs, the transcript evidence to retain, and the limits on claims; run the repository verification gate and record final Goal Check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Lead every criterion row with durable evidence that Parallix verifies today: exact test names; ADR references; test file paths such as `test/e2e-mission-lifecycle.test.ts` and `test/e2e-real-agent-smoke.test.ts`; or recognized repository commands and paths such as `npm ...`, `node ...`, `git ...`, `px ...`, and `./...`.
- Use the exact heading `## Goal Check`.
- Under that heading, use this exact three-column table shape:

| Criterion | Evidence | Status |
|---|---|---|

- Include one evidence row for every Success Criterion. Cite the exact real-agent transcript artifact and verbatim reviewer-selection excerpt for the single-family criterion, the retained default recording for the three-family criterion, and `./scripts/verify-local.sh all` for final verification.
- A file:line reference is accepted parenthetically when needed, but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not enough. It may be supplemental, but pair shell output with an accepted command, path, exact test name, or ADR reference above.
- End each checkpoint with a concrete `Next action:` line.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `src/domain/review.ts` or the review-family eligibility rules.
- Do not add, duplicate, or alter lifecycle assertions in `test/e2e-mission-lifecycle.test.ts` or `test/e2e-real-agent-smoke.test.ts`.
- Do not promote the rehearsal to CI, a deterministic test, or a release/integration gate.
- Do not let the rehearsal read or write the operator's real Parallix state; preserve disposable-repository and isolated-`PARALLIX_HOME` operation.
- Do not make documentation claim that the script proves first-run detection, deterministic behavior, or provider availability.

## Stop Rules
- Stop and report if implementing the parameter requires changing production review-family eligibility or the single-family fallback semantics.
- Stop and report if the desired global `px` execution path cannot be achieved through `PX_BIN` without changing the script's public invocation contract.
- Stop and report if obtaining a transcript would require treating a real-agent rehearsal as a deterministic test or CI gate.
- Stop and report if a rehearsal attempts to use the operator's real `PARALLIX_HOME`, a non-disposable repository, or credentials/state outside the isolated setup.
- Stop and report transient real-agent, network, quota, or concurrent-smoke failures with their captured transcript; do not mask them as product regressions or weaken the stated evidence limits.
