# CP 3: Extract configuration and preserve orchestration

Moved workflow configuration and review-readiness evaluation into the configuration module. The public setup module now retains only prompting, answer collection, bootstrap orchestration, and compatibility exports.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Configuration and readiness logic has one owner | `src/adapters/review/setup-review-config.ts`, `test/setup-review.test.ts` | PASS |
| Public setup module keeps the established import surface | `src/adapters/review/setup-review.ts`, `src/adapters/cli/mission-start.ts`, `src/adapters/cli/commands/handoff.ts` | PASS |
| All review-setup source files are within the mission size limit | `src/adapters/review/setup-review*.ts` | PASS |

Next action: Run the integration gates and record their results.
