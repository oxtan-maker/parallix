# CP-2: First fix + regression tests — `validateAdapterSections`

## Summary

Resolved the highest-complexity config-validation slice at its code site,
keeping every observable behavior. `validateAdapterSections`
(`src/adapters/config/product-config.ts`, ~line 218, cx ~26) dispatched eight
parallel adapter-section validators through one fat function with nested
`if`/`for` branches. Extracted each section into a named, independently-testable
`validateXSection` helper, following the already-present
`validateAgentModels` / `validateRunnerSelection` / `validateSubagents` pattern
in the same file:

- `validateTasksSection`, `validateMissionsSection`, `validateVerificationSection`,
  `validateIntegrateSection`, `validatePromptsSection`,
  `validateGithubPublishSection`, `validateReviewSection`, `validateAgentsSection`
- Each helper takes the raw `unknown` section value, guards with `isPlainObject`,
  and runs that section's exact field/enum/closed-object checks.
- `validateAdapterSections` is now a thin eight-call dispatcher.

Behavior is byte-for-byte identical: every original check moved verbatim into
its helper, and the dispatcher preserves call order. No rule disabled,
suppressed, downgraded, or path-excluded. `sonar-project.properties` untouched.

Added focused regression tests in `test/product-config.test.ts` covering each
newly reachable branch per section (string-field rejections, enum rejections,
closed-object key rejections, non-object section bodies).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: this finding accounted for (fixed at site) | S3776 finding `src/adapters/config/product-config.ts:218` resolved by helper extraction; remains in `missions/task-2525.02/s3776-findings.tsv` with updated disposition | PASS |
| SC2: changed control flow has focused regression tests | `test/product-config.test.ts` — 9 new tests (e.g. `"validateWorkflowConfig enforces the closed prompts section (override only)"`, `"validateWorkflowConfig enforces the githubPublish section types and enums"`) | PASS |
| SC2: affected test file passes | `npm test -- test/product-config.test.ts` → 59 pass, 0 fail | PASS |
| SC3: no suppression | `sonar-project.properties` not edited; no rule disabled/suppressed/downgraded | PASS |
| SC4: no relocation / metric-only close | each finding's behavior preserved; rejections verified by passing tests | PASS |
| SC5: static-analysis green after fix | `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED (ESLint, tsc, test-hygiene, test typecheck) | PASS |

## Next action

Commit CP-2.md + slice; then advance to next highest-complexity testable-by-path
slice from `missions/task-2525.02/s3776-findings.tsv` (e.g.
`src/adapters/backlog/checkpoint-document.ts:36 parseCheckpointDocument` or
`src/application/rebase-workflow.ts:30`).
