# Mission: make drafted missions explicit enough for weak agents to complete handoff reliably (task-2207)

## Goal

Fix the root cause behind weak-agent failures in Parallix mission execution: drafted missions and execution guidance do not make the checkpoint and Goal Check requirements explicit enough, so agents complete the product work but still fail handoff on documentation format and repair-loop behavior.

This mission must improve the drafting and execution contract so that a weak implementer can understand, from the generated mission and workflow prompts alone, exactly:

1. what each checkpoint document must contain;
2. what counts as valid Goal Check evidence;
3. what the autobounce path will ask the agent to repair after a failed handoff.

If investigation shows a genuine product bug still blocks correct evidence after the guidance is clarified, fix that bug too, but do not make validator expansion the primary objective.

## Why Now

`TASK-2207` describes a recurring workflow failure where weak agents can complete a trivial hello-world mission yet still fail the real-agent smoke lifecycle because the final checkpoint evidence is formatted in a way the handoff path rejects. The backlog intent is not "accept more random evidence strings"; it is to make Parallix clear enough that agents produce correct artifacts on the first try and that the relaunch path gives them a useful second chance when they miss.

The current branch mission drifted into a local validator tweak. That is a band-aid because it treats one symptom (`stat`/`ls` evidence rows being rejected) without fixing the upstream ambiguity in `BACKLOG -> px draft -> MISSION.md -> execute -> handoff/review repair`. As long as the mission contract remains vague, weak agents will keep failing in new ways and the smoke test will stay flaky.

## Refinement Signals

- Predicted NEL bucket: Medium (81-235)
- Confidence: Medium
- Selection note: activate as root-cause rewrite, not as validator-only patch
- Main drivers: weak-agent handoff failures, vague drafted mission contracts, unhelpful repair loop, flaky real-agent smoke coverage

## Scope

- Audit the full mission-authoring path that shapes agent behavior for this failure class:
  - the draft prompt;
  - the mission scaffold/template;
  - any mission-contract conventions that define checkpoint expectations;
  - execute/review/repair prompts involved in handoff failure recovery.
- Rewrite the drafting contract so generated `MISSION.md` files describe checkpoint-document requirements concretely enough that an implementer does not need to infer the acceptable format.
- Ensure the execution prompt explicitly states the required Goal Check section heading, required table shape, and acceptable evidence categories with concrete examples.
- Ensure the repair prompt uses the same evidence rules as execution so bounced implementers are not operating from a different contract.
- Investigate the autobounce path for this failure class and verify whether the second-attempt flow actually gives the agent new, actionable instructions instead of repeating the original ambiguity.
- Add or update automated coverage that locks the intended behavior for:
  - mission drafting clarity where practical;
  - handoff/repair messaging for incomplete-evidence failures;
  - the real weak-agent smoke path or a narrower regression if the smoke test is too broad for direct locking.
- Fix validator behavior only if the investigation demonstrates that Parallix rejects evidence that the clarified workflow intentionally allows. Any validator change must be narrowly justified by the documented contract, not vice versa.

## Out of Scope

- Broadly loosening the handoff validator just to make the current smoke test pass
- Accepting arbitrary shell output as evidence without a documented contract for why it is valid
- Reworking unrelated mission lifecycle phases (`px integrate`, Forgejo publish flow, or general reviewer specialization)
- Redesigning the entire mission template system beyond the parts needed to make checkpoint and Goal Check expectations explicit
- Changing retry budgets unless investigation proves the configured retry count itself is wrong rather than the repair instructions
- Fixing unrelated smoke-test flakiness not connected to mission clarity, evidence validation, or autobounce behavior

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. The drafted-mission inputs that govern execution (`prompts/draft.md`, the mission scaffold, and any directly-related mission text emitted from them) explicitly describe checkpoint-document requirements, including the required Goal Check section name, required table structure, and at least 4 valid evidence forms with concrete examples.
2. `prompts/execute.md` and the incomplete-evidence repair prompt in `lib/commands/repair-handoff.ts` describe compatible evidence rules, and the drafted mission contract does not contradict what Parallix already verifies at handoff.
3. A targeted automated test or tests fail before the fix and pass after it for the incomplete-evidence/autobounce contract, covering at minimum one case where the agent receives actionable repair guidance instead of the original vague instruction set.
4. The real-agent smoke failure described in the backlog is either:
   - eliminated by the final tree; or
   - reduced to a different, explicitly identified blocker with a new failing assertion and documented rationale showing that mission clarity is no longer the cause of the original `IncompleteEvidence` loop.
5. If any handoff or review error text is changed, it accurately describes the evidence forms Parallix already verifies in code so the repair loop is not teaching a narrower or different contract than the runtime.
6. `./scripts/verify-local.sh all` passes on the final tree.
7. Because this mission modifies files under `lib/`, `./scripts/verify-local.sh static-analysis` passes on the final tree.

## Risks and Assumptions

- Risk: prompt-only improvements may not be enough if the validator contract is genuinely narrower than the intended workflow contract. Mitigation: investigate prompts and validator together, but only expand validator behavior when the contract justifies it.
- Risk: smoke-test failures may bundle multiple causes (evidence format, reviewer output, relaunch messaging). Mitigation: separate the failure chain and add coverage at the narrowest useful layers before relying on the end-to-end smoke alone.
- Risk: overfitting the fix to the `stat`/`ls` examples could still leave agents confused in adjacent evidence cases. Mitigation: define evidence categories, not just a single example pair.
- Assumption: the root cause lives mainly in authored guidance (`draft`/`MISSION`/`execute`/`repair`) and not in a hidden state-machine bug.
- Assumption: the autobounce flow already attempts a second pass, but its instructions may be too weak or too repetitive to change agent behavior.

## Checkpoints

- CP 1: Trace the failure path from backlog intent through drafted mission, execute prompt, handoff validator, and repair prompt. Record exactly where the contract becomes ambiguous or inconsistent for Goal Check evidence and checkpoint structure.
- CP 2: Rewrite the draft-time contract (`prompts/draft.md`, mission scaffold, and any directly related mission-authoring text) so generated missions state checkpoint and Goal Check requirements concretely, with examples and non-ambiguous wording.
- CP 3: Align execution and incomplete-evidence repair prompts so they teach the same evidence contract and the same expected section/table format.
- CP 4: Investigate the autobounce behavior for incomplete-evidence failures. If the second-attempt path does not materially change the agent instructions, fix that path and add regression coverage.
- CP 5: Only after the contract is clear, adjust validator behavior if needed to match the documented evidence rules, then add focused tests for both acceptance and rejection cases.
- CP 6: Run the relevant verification gates and the narrowest credible regression coverage, then confirm whether the original smoke failure is resolved or has been reduced to a different blocker.

## Gates

- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not treat validator broadening as the default fix; any validator change must be justified by the rewritten contract and accompanied by tests.
- Do not modify unrelated workflow prompts or lifecycle code unless the failure-path audit shows they directly participate in this weak-agent handoff failure.
- Do not change Forgejo review policy, publish flow, or mission integration behavior unless the investigation proves they are part of this exact failure chain.
- Do not weaken evidence standards to the point that unverifiable claims can pass handoff.

## Stop Rules

- Stop if the failure-path audit shows the smoke failure is primarily caused by infrastructure, launcher instability, or reviewer-posting failures unrelated to mission clarity/evidence handling.
- Stop if fixing the issue credibly requires redesigning the entire mission-template system rather than tightening the existing draft/execute/review/repair contract.
- Stop if the only way to make the smoke test pass is to accept evidence forms that cannot be tied back to a clear, documented, and reviewable contract.
- Stop if `./scripts/verify-local.sh all` or `./scripts/verify-local.sh static-analysis` fails for a pre-existing reason unrelated to this mission's changes.
