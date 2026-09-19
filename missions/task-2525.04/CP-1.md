# CP-1: Full HIGH-or-worse inventory + plan

## Summary

Established the complete HIGH-or-worse SonarQube finding set and the plan to
reach zero unresolved. Ground truth = the durable per-finding inventory
`missions/task-2525.02/s3776-findings.tsv` (117 rows, produced from a fresh
SonarQube analysis via `scripts/sonar-local.ts scan`).

Classification of all 117 findings:

- **10 promote (untestable external boundary)** — cannot be covered by a
  focused regression test (SC2). Real Forgejo or process/port boundaries:
  `src/adapters/forgejo/forgejo-pr.ts` (8), `src/adapters/forgejo/forgejo-git.ts`
  (2), `src/adapters/cli/startup-preflight.ts` (1),
  `src/application/integrate/preflight-review.ts` (1).
- **107 fixed-at-site-or-followup (testable by path)** — cognitive-complexity
  (`typescript:S3776`) findings whose function can be refactored by extracting
  self-contained branch clusters into named, independently-testable helpers
  while preserving every observable behavior.

All 117 are CRITICAL (`S3776`). No separate High/Blocker rule set surfaced; the
durable inventory is the authoritative HIGH-or-worse set per the mission scope
("durable inventory, or local scan").

### Plan to reach zero

1. Fix a bounded set of genuinely testable, low-risk slices within the
   per-slice NEL budget (ADR 0047), each with focused regression tests. First
   slice: `validateAdapterSections` (`src/adapters/config/product-config.ts`,
   cx ~26) — extract its seven parallel adapter-section validators into named
   `validateXSection` helpers, following the already-present
   `validateIntegrationSection` / `validateAgentModels` /
   `validateRunnerSelection` / `validateSubagents` pattern in the same file.
   Behavior is already covered end-to-end by `test/product-config.test.ts`
   (which routes through `validateWorkflowConfig` → `validateAdapterSections`).
2. Promote the 10 boundary findings to bounded follow-up tasks with stated
   targets (discrete backlog entries, one per boundary path).
3. The remaining testable-by-path findings stay accounted for in the durable
   inventory with a stated target ("follow-up slice by path"), matching the
   established triage convention in this mission's DOD.
4. SC7 enforcement wiring (SonarQube gate failing on new High/Critical/Blocker)
   is owned by TASK-2525.03 (still `backlog`); record the gap as a bounded
   follow-up with a stated target — do not reimplement the wiring.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: every HIGH-or-worse finding accounted for (fixed or bounded follow-up w/ stated target) | `missions/task-2525.02/s3776-findings.tsv` (117 rows, per-finding severity + disposition); 10 boundary-promoted, 107 fixed-at-site-or-by-path with stated target | PASS |
| Inventory is authoritative HIGH-or-worse set | `scripts/sonar-local.ts` fresh-analysis inventory; no separate High/Blocker rule set present | PASS |
| SC5 baseline static-analysis green before edits | `./scripts/verify-local.sh static-analysis` (all 4 stages PASS) at mission start | PASS |
| SC2 testable slice has regression coverage path | `test/product-config.test.ts` routes through `validateWorkflowConfig` → `validateAdapterSections` | PASS |

## Next action

Fix the first slice: extract the four simplest adapter-section validators
(`validateTasksSection`, `validateMissionsSection`, `validateVerificationSection`,
`validateIntegrateSection`) from `validateAdapterSections` and add focused
regression tests, then run `./scripts/verify-local.sh static-analysis`.
