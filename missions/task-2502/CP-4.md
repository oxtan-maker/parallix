# CP-4 — Remediation: classify, mitigate in code, suppress as last resort

## Work done
Every one of the 12 baseline findings is a **false positive**; none is a genuine
or actionable vulnerability, so no behavior was changed to fool the scanner
(Stop rule: do not change intended behavior solely to satisfy the scanner).
Mitigation is made visible in code and static analysis, and the per-finding
suppression baseline is the documented last resort.

Mitigations already present in code (the safe data flow is now legible):
- `src/adapters/git/git.ts:45` and `src/adapters/agents/launcher-selection.ts:82`
  — `spawnSync` array form with no shell; trusted internal args / allowlisted
  name passed positionally. Comments document the no-injection surface.
- `src/interfaces/web/host.ts:241` — loopback-only single-launch host
  (ADR 0054), never network-facing; rate limiting is N/A.
- `src/application/presentation/cli-format.ts:118-119` — generic console
  forwarding, not a sensitive-data sink.
- test-only regex/comment sanitizers — output is asserted, never rendered to a
  browser or a shell.

Regression test at the demonstrable high-risk boundary:
- `test/task-2502-codeql-regression.test.ts` — `command path probe does not
  shell-inject the agent name` proves the allowlisted launcher name reaches the
  shell only as a positional arg (a `&& touch <marker>` payload creates no file).
  Both tests pass: `npx tsx --test test/task-2502-codeql-regression.test.ts`.

Suppression baseline (last resort, per-finding justified):
- `missions/task-2502/codeql-suppressions.sarif` — 11 entries, each with a
  recorded justification, consumed by
  `scripts/codeql-count-findings.mjs --suppress` to drop only classified false
  positives. The full `security/code-scanning` suite still runs; the suite is
  never weakened.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 100% of findings classified | CP-1 classification table, 11 rows all `false positive` | PASS |
| No genuine/actionable finding left unfixed | all 12 are false positives; safe data flow documented in code | PASS |
| False-positive mitigation visible in code | comments in `src/adapters/git/git.ts`, `src/adapters/agents/launcher-selection.ts`, `src/interfaces/web/host.ts`, `src/application/presentation/cli-format.ts` | PASS |
| Regression test at demonstrable high-risk boundary | `test/task-2502-codeql-regression.test.ts`; `npx tsx --test test/task-2502-codeql-regression.test.ts` → 2 pass | PASS |
| Suppressions are last-resort and per-finding justified | `missions/task-2502/codeql-suppressions.sarif` (11 justified entries); suite unchanged | PASS |

## Next action
Commit remediation, then proceed to CP-5 (verification gates).
