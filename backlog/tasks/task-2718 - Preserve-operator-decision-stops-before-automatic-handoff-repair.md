---
id: TASK-2718
title: Preserve operator-decision stops before automatic handoff repair
status: backlog
assignee: []
created_date: '2026-10-10 14:18'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: high
ordinal: 218008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2716 exposes an execute-to-handoff routing defect: a successful agent process exit is treated as delivery completion even when its final response explicitly requests an operator architecture decision. Automatic checkpoint repair then retries an authority block, adds CP-6, and reports missing evidence rather than the actual required decision.

Verified retained Codex sessions:
- execute-codex-a1-mv2gynzm, started 2026-10-10T14:08:06.131Z, exit 0. Exact final response: px history task-2716 show run:execute-codex-a1-mv2gynzm:stdout@0+796. CP-1 committed as 4deafcb754; explicitly asks approval for optional typed panel telemetry field and cites AGENTS.md.
- execute-codex-a1-mv2h5jo2, started 14:13:27.122Z, exit 0. run:execute-codex-a1-mv2h5jo2:stdout@0+515 reports same pending decision and rejected diagnostic report because six criteria lack evidence.
- execute-codex-a1-mv2h71w6, started 14:14:37.399Z, exit 0. run:execute-codex-a1-mv2h71w6:stdout@0+548 reports human review at Version 32. Incident a038fdc1-d74e-426d-912c-5d9335cfe0b7. Native provider session IDs were not retained; these are verified Parallix run IDs, not invented Codex UUIDs.

At Version 32 only CP-1 is implemented; CP-2 through CP-5 are genuinely unfinished. Criterion 6 requires per-question telemetry/usage absent from ClassifierCallMeasurement. AGENTS.md requires a subsequent operator decision for typed-port changes. This is a legitimate stop, not missing proof that can be repaired by recording rows.

Source trace: ExecuteHandoffService.run in src/application/execute-handoff-service.ts validates evidence and invokes repairCheckpointGap; src/application/rebound-checkpoints.ts opens an additional repair checkpoint; src/application/rebound-prompts.ts excludes inherited approval authority in fresh repair. Investigate the upstream execute result contract and checkpoint report rejection path before choosing implementation.

Proposed outcome: represent and persist an explicit operator-decision stop separately from completed execution, failed execution and ordinary missing checkpoint evidence. Surface the concrete proposal to the operator and do not launch handoff/repair or grow checkpoint plans until a subsequent explicit decision. Resume from the last real checkpoint after approval while preserving all evidence and gates. Agent instructions should require the structured stop, but the orchestrator must honor it; do not infer permission from exit 0 or prose. Preserve fresh-context authority isolation.

Do not weaken handoff validation or fabricate CP evidence. Do not automatically approve architecture changes. Any application-port change to implement this ticket remains subject to AGENTS.md approval requirements.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An execute run requesting an operator decision persists a visible stop with proposal and source evidence; exit 0 does not imply delivery completion.
- [ ] #2 No handoff repair launch or extra repair checkpoint occurs while that decision is pending; true incomplete-evidence failures still use ordinary recovery.
- [ ] #3 An explicit subsequent operator decision resumes remaining planned checkpoints and gates, retaining valid earlier evidence and requiring fresh repair evidence where applicable.
- [ ] #4 Extend owning execute/handoff and recovery contracts with an isolated TASK-2716 reproduction, red on parent and green with the fix; cover restart and repeated repair attempts.
- [ ] #5 Document agent structured-stop instructions and operator resume flow; verify focused contracts, static analysis and docs, and manually exercise disposable composed execution.
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
