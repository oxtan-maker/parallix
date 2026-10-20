---
id: TASK-2790
title: implement bug guards
status: done
assignee: [codex]
created_date: '2026-10-19 11:35'
labels: []
dependencies: []
ordinal: 271008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**R1 — Composition-root configuration identity contract (M5, 5 bugs).**
Add one unit suite that constructs the production composition and asserts the
resolved configuration object reaches the deepest port factories (rebase
workflow port, launcher availability probe, handoff and repair-handoff adapters,
mission execution context). Overlapping defenses: per-adapter suites such as
`test/integration/rebase/pre-review-launcher-configuration.test.ts` and
`test/unit/adapters/cli/commands/mission-handoff-repair-contract.test.ts` cover
single seams but never two nested calls. Expected incremental benefit: detects nested-factory default reconstruction
(task-2709, task-2724, task-2744), beyond isolated adapter checks. Limits: does
not cover cwd/branch context, which task-2777 addressed with a typed execution
context port. Cost: one new unit file, no production change; maintenance is low
because it follows the composition root. Validation: the case must be red on the
parent revision for the sampled call shapes (task-2709, task-2724, task-2744)
and green only when configuration identity is preserved. Workflow cost: no
provider calls, but legitimate configuration copies may fail an identity assertion;
assert identity only at seams that promise it, and compare values elsewhere.
Re-wiring composition requires updating the fixture; this is the main maintenance
cost. Do not infer that all five M5 bugs are covered by these three replays.

**R2 — Ban type-escape casts on option and configuration objects (M5 enabling
factor).** `eslint.config.mjs` already errors on `@typescript-eslint/no-explicit-any`
and `./scripts/verify-local.sh static-analysis` runs ESLint with
`--max-warnings 0`, so the ratchet exists. Extending it to `as never` and
`as unknown as` on object literals would have surfaced task-2709 at authoring
time. Cost: small — 13 current sites to fix plus one rule. False-positive cost:
legitimate `as never` uses need an inline exemption. Limits: lint proves the
type is visible, not that the value propagates. Adding or tightening a gate is an
operator decision. Incremental benefit is visibility of hidden option errors
(task-2709), complementing R1 rather than covering five independent bugs.
Validation: seed the rule with the parent task-2709 literal, nested double casts,
and equivalent parenthesized forms; require all forbidden examples to fail and
typed literals, unrelated casts and documented exemptions to pass. First run in
report-only mode and count actionable sites versus exemptions before deciding
whether to enforce it. Maintenance: keep parser fixtures aligned with TypeScript
syntax and review exemptions; workflow cost includes fixing legacy sites and
reviewing false positives, not just writing the rule.

**R3 — Boundary round-trip contracts (M4, 6 bugs).** Two narrow suites: (a) a
projection→transport round trip that feeds stamped repair metadata
(`recordedRound`, `repairedGate`, `repairedGates`) through the real projection
into `validateWebBoardSnapshot` in `src/interfaces/web/transport-validators.ts`;
	(b) a phase×event transition table for the review and integration state machine,
including `approved` + REQUEST_CHANGES and `active` + integration dry-run.
Overlap: `test/unit/interfaces/web/web-transport.cases.ts` and
`test/unit/application/review-loop/review-loop-retry-contract.test.ts`.
Expected benefit: catches producer/consumer drift and illegal transitions before
landing. Cost: two unit suites, low maintenance if driven from existing row and
phase shapes. Validation: replay task-2694 projection metadata, task-2679 approved-phase
feedback and task-2673 active-phase dry-run; require failure on their parents
and success on fixes, including unchanged valid shapes. Incremental coverage is
these crossed boundaries, not all six M4 bugs. Workflow cost: strict schemas can
flag intentional additive metadata; review the consumer contract before updating
fixtures. Maintenance follows metadata and transition changes; avoid a second
hand-maintained transition authority.

**R4 — Typed failure evidence as the only classification input (M2 subset, M1
contributor).** `src/application/recovery-evidence.ts` already persists command,
cwd, captured revision, exit code, signal, incident id, attempt and capture
completeness; `src/domain/failure-classification.ts` now drops passing
test-result lines (`PASSING_TEST_RESULT_LINE_RE`) before keyword matching. The next step is to make a typed
reason code the primary input and keyword matching an explicit, logged fallback.
Expected benefit: fewer false human-only stops (task-2663) and fewer wasted
repair rounds. Cost: moderate — every gate writer must emit a code, and existing
logs must be replayed as fixtures. False-positive cost: a missing code now falls
back instead of blocking, which can hide real infrastructure failures. Limits:
does not help telemetry-window mechanisms (task-2685, task-2758), which need the
shared window contract instead. Overlap includes the signal guard and fallback
regression in `test/unit/adapters/agents/agent-ambiguous-launch-blocking.test.ts`
(task-2729); that bug supports signal-aware classification, not pin/probe.
Incremental coverage must be demonstrated beyond those fixed cases. Validation:
replay task-2663 output with a passing forbidden title plus failing CPU diagnostic,
and task-2729 signal-only termination versus positively identified quota output;
require the expected reason and block/no-block result, including missing-code
fallbacks. Maintenance: version reason codes and preserve older-reader fallback
fixtures. Workflow costs include writer migration, triaging unknown codes and
	avoiding an overly permissive fallback; this makes R4 costlier than R1–R3.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
