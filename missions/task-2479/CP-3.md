# CP-3 — Landing and stats separation

## Summary

Made landing the primary output and separated stats recording from reporting.

**Landing result (criteria 10).** The `px integrate` happy path now ends on the
landing transition instead of a `Step N` narration. `landedFromSha` captures the
pre-integration base-branch tip via `git rev-parse`; the final result prints:

```
✓ integrated into main
  main  <before> → <after>
```

Both the normal and the resume-from-partial-state paths carry the transition.

**Stats separation (criteria 4, 5, 6).** `recordPostIntegrationStats` still
calls the measurement store (`recordIntegrationStatsFn`, anchored to
`PARALLIX_HOME/parallix.db`) and returns the outcome, but the full weekly report
body and the mission-telemetry table no longer print on the success path. A
single `Workflow stats recorded: <row>` confirmation remains; the analytical
body lives behind `px stats` / an explicit flag / `DEBUG`.

**Fail-closed preserved (criteria 7).** `recordPostIntegrationStatsOrAbort` is
unchanged: a recording failure still throws `IntegrationAbort`, which still
blocks landing.

**Cleanup summarized (criterion 11).** The `Step 7` narration became
`Mission worktree cleaned up.` (a `fmt.log.pass`) with the failure branch
unchanged. The `Selecting integration variant`, `Step 1–6` progress lines moved
to `fmt.log.debug`.

**Graphify silence (criterion 12).** `maybeUpdateGraphifyOnPrimary` now receives
`{ log: fmt.log.debug }`, so "No existing graphify graph found" is silent on the
ordinary success path and surfaces only under `DEBUG`.

**Malformed line removed (criterion 13).** The leading `\n` in the `Next: cd`
`fmt.log.info` call was dropped.

Tests updated to the new summarized behavior (kept as negative coverage, not
deleted): `recordPostIntegrationStats does not print the weekly report or
mission telemetry on the success path`,
`recordPostIntegrationStats stays silent past the recorded row for empty
mission-phase rows`, and the persisted-row test's removed dump assertions.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Landing shows destination branch + `<before> → <after>` SHA transition | `src/adapters/cli/commands/integrate.ts`, `fmt.log.pass(\`\n✓ integrated into ${baseBranch}\`)` + `fmt.log.plain(\`  ${baseBranch}  ${landedFromSha} → ${mergedCommit}\`)` | PASS |
| `recordPostIntegrationStats` no longer emits the weekly report body on success | `src/adapters/cli/commands/integrate-post.ts`; removed `fmt.log.plain(outcome.report)` + `renderMissionPhaseReport` dump | PASS |
| `recordPostIntegrationStats` no longer emits the mission telemetry table on success | `src/adapters/cli/commands/integrate-post.ts`; removed `renderMissionPhaseReport` block | PASS |
| Required telemetry still recorded (fail-closed stays) | `recordPostIntegrationStatsOrAbort` unchanged, still throws `IntegrationAbort`; `recordIntegrationStatsFn` still called | PASS |
| Cleanup summarized without numbered steps | `src/adapters/cli/commands/integrate.ts`, `fmt.log.pass('Mission worktree cleaned up.')` replacing `Step 7` | PASS |
| Graphify absence silent on success path | `src/adapters/cli/commands/integrate.ts`, `maybeUpdateGraphifyOnPrimary(baseWorktree, { log: fmt.log.debug })` | PASS |
| Empty `[INFO]` line before `Next: cd` removed | `src/adapters/cli/commands/integrate.ts`, `fmt.log.info(nextActionMessage)` (no leading `\n`) | PASS |
| Focused integrate tests pass | `npm test -- test/integrate.test.ts` → 84 passed, 0 failed | PASS |

Next action: CP-4 is realized in the same committed diff (cleanup summary +
final landing record). Proceed to CP-5 — re-record the real first-value
recording, inspect the raw cast and GIF, fix any in-scope issues, run focused
files, then repository gates.
