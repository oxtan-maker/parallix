# Review consolidation evidence (TASK-2622.08)

The PR rework replaces rename-only migration with 50 source files consolidated
into 26 behavior suites. The complete original review slice moves from 85 files
to 61. Task provenance stays in regression comments and case names. Production
sources and architectural boundaries are unchanged.

Read-only module mock registrations were removed in favor of existing injected
request dependencies. The handoff ordering contract retains actual module
facades, registered once and restored between cases. Mutable fixtures remain
case-scoped, and GitHub pure tests remain eligible for shared execution.

Launcher selection uses injected command availability and health probes. Review
decision and round logic use the existing in-memory transition store and real
application/domain logic. SQLite reopen and idempotency guarantees are retained
in `test/review-state.test.ts`, including two new durable cases. Real SQL
backfill, persisted intervention resume, and identity adapter checks remain
integration tests; replacing their adapters would remove their boundary proof.

## Assertion provenance

`migration.json` maps the 50 moved files. `behavior-ledger.jsonl` audits the full
85-file original slice: 921 named cases, 2,859 case assertions, and 16 assertions
in helpers. The two successful-handoff setup assertions replaced by direct unit
state seeding map to the existing handoff lane-event contract. No named case or
independent behavioral assertion is discarded. Mixed metrics contracts stay
with their existing owner pending TASK-2622.13.

## Verification and measurement

`verification.json` records 283 passing focused unit cases with the plain 500 ms
headroom policy and 45 passing integration cases, including discovery, file-size,
and fixture-lifetime guards. Static analysis passes all four stages. Full gates
are left to the mission workflow.

`focus.json` defines the matched measurement population. `matched-before.json`
and `matched-after.json` capture test counts, CPU time, Node arguments, and
checkout paths. Each checkout uses its own discovery and tier authority; both
use the same coverage settings and four workers. Two new durable cases explain
the candidate's additional two cases. Total measured CPU falls from 48.81 s to 36.68 s (24.85%). These are focused measurements, not a
full-wave speedup certification.

## Coverage proof and limitations

The refreshed baseline is the clean pre-rework commit `b7b304407`, not an assertion
that the unavailable TASK-2622.01 raw artifacts have been recertified. All 334
production source hashes match. Serial per-file collection avoids concurrent V8
attribution noise. Unchanged lifecycle, handoff, SQLite repository and fixture
owner suites are included on both sides to verify formerly incidental setup
coverage against its actual behavioral owners.

`coverage-transfer.json` proves that all 16,165 previously covered source lines
remain covered against the same pinned 47,903-line inventory. Native reporter
inventories differ by 80 zero-hit TypeScript-only lines; compiler AST validation
proves all 80 are erased syntax, with no lost executable line, excluded runtime
code, or fabricated hit. Those entries remain zero in the pinned comparison.
`coverage-comparison.json` retains the raw inventory discrepancy for inspection.
Final wave-wide comparison and performance certification remain TASK-2622.20.

## Reproduction

Create a detached baseline checkout at `b7b304407` with the same dependencies.
Run `node --import tsx tools/review-consolidation/measure.mjs <baseline> tools/review-consolidation/focus.json before`,
then the same command with `.` and `after`.

For serial coverage, use `tools/coverage-comparison/compare-slice-coverage.ts`
with each focus population plus the unchanged owning suites listed above,
including `task-2322-05-mission-sqlite-fixture.test.ts`. Merge the fragments into
`before-comparable.lcov` and `after-comparable.lcov`, then run
`node tools/review-consolidation/compare-native-lines.mjs <baseline>`.
Raw logs and LCOV files are ignored; checked-in summaries and assertion mappings
are historical evidence, not runtime test membership authorities.
