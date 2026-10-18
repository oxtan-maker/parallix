---
id: TASK-2762
title: optmize integration tests
status: done
assignee: [codex]
created_date: '2026-10-15 11:27'
labels: []
dependencies: []
ordinal: 250008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
bring all integration tests and their limits below the limit so they are run on local integration checks.

DO NOT RAISE LIMIT for local integration checks
do not remove any significant test assertion or lower the defences in remaining suites.

Operator decision (2026-10-15): remove test/integration/packaging/native-sea-executable-smoke.test.ts and its registry, CPU-budget and suppression entries. This deletion is authorized and excluded from timing and assertion-preservation requirements. Continue optimizing the remaining integration population. No blanket static-analysis or verify-local all gate is required for this mission; retain focused contract checks and the declared integration runs.
Operator decision (2026-10-15, follow-up): move browser coordinate verification to a dedicated local E2E gate alongside lifecycle and agent-smoke; do not run it on GitHub. Replace the tmux terminal, persistent-package reinstall and post-integrate global-install integration suites with existing unit coverage on similar code paths and retain missing in-process contracts. These replacements are authorized exceptions to real-boundary preservation; the remaining integration cutoff and limits stay unchanged.
Operator decision (2026-10-15, final follow-up): remove test/integration/sandbox/codex-sandbox-mission-state-write.test.ts and its category, dependency-reason and CPU-budget entries. Its real Codex sandbox Mission-write coverage is explicitly retired and excluded from timing and assertion-preservation requirements. Speed up the three remaining plain integration failures without raising limits or weakening assertions.
Operator decision (2026-10-15, resumed): batch real ESLint/TypeScript diagnostic checks while retaining every diagnostic assertion and isolated shell-status contracts. No verification gate is added or restored and retained CPU limits are not raised.
Operator decision (2026-10-16, completion): raise the small source-startup smoke covered CPU budget to 1,000 ms using captured profiles, retaining its real-source assertions and suite. The covered CLI exit/output budget is also corrected from 2,500 to 3,400 ms after a 2,808 ms CPU sample; the 3,500 ms integration cutoff stays unchanged. This replaces the pending consolidation proposal.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Declared integration gates and relevant focused checks passed on the final tree with captured proof
- [x] #2 Relevant focused contract checks pass for changed files
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after (not applicable: this mission has no bug label)
<!-- DOD:END -->


## Latest verification

CP-11 records the final passing evidence and the operator-approved startup
budget corrections. Historical result snapshots remain in
[the integration results](../docs/task-2762-integration-results.json).

Complete plain integration passes 2,792 cases: 2,764 passes, 28 existing skips
and zero failures. Covered early CI passes 2,738 cases: 2,714 passes, 24 existing
skips and zero failures. The final shell-stage assertions also pass both focused
profiles, including distinct hygiene and test-compiler failure stages.

All effective integration case limits remain strictly below the unchanged
3,500 ms cutoff, with a maximum of 3,400 ms. The approved covered startup limits
are 1,000 ms for source-loader smoke and 3,400 ms for CLI exit/output; captured
profiles provide explicit headroom. Every modified suite has passing plain and
covered wall profiles below 3.5 seconds. The source smoke and its real assertions
are retained; consolidation is not performed.

The 62 focused unit checks pass with 500 ms headroom. Typecheck, build, manual
disposable built-CLI checks, and real planner dry-run/failure checks pass. Final
checkpoint rows cover all five criteria, including the authorized budget
exceptions, and the implementation is ready for handoff to independent review.
