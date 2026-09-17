# CP-4 — Final triage pass

## Summary

Confirmed every critical `typescript:S3776` finding is accounted for at mission
end (SC4): resolved in a completed slice or captured in a separately bounded
follow-up task with a stated target. Zero critical S3776 findings are left as
untriaged open debt. Also confirmed no rule was disabled, suppressed, or
downgraded to move a count (SC3).

The authoritative count comes from a fresh SonarQube analysis run via
`scripts/sonar-local.ts` (`npm run sonar`), not the CP-1 proxy: the server is
up on `127.0.0.1:9000` and authenticated scanning was bootstrapped by
task-2527. Slice A resolved `validateDeclaredGates` (cx 22); the current tree
still reports 117 CRITICAL S3776 findings, each durably inventoried in
`missions/task-2525.02/s3776-findings.tsv` with a stated follow-up target.

## Accounting of the critical S3776 findings

The CP-1 baseline was a heuristic proxy (116); the authoritative count is the
fresh scan below. Findings are grouped by disposition; the per-finding inventory
lives in `missions/task-2525.02/s3776-findings.tsv`.

| Disposition | Count | Evidence |
|---|---|---|
| Resolved in a completed slice | 1 (`validateDeclaredGates`, cx 22) | Slice A in `missions/task-2525.02/CP-2.md`; `test/gate-validation-refactor.test.ts` |
| Outstanding, each mapped to a bounded follow-up slice by path | 117 | `missions/task-2525.02/s3776-findings.tsv` (fresh scan via `scripts/sonar-local.ts`); enumerated in `backlog/tasks/task-2525.04` |
| Untriaged open debt | 0 | — |

## Non-S3776 critical/blocker maintainability findings

The mission also names "remaining critical/blocker maintainability findings
(rules other than S3776)". A fresh scan (`type=CODE_SMELL`, filtered to the
MAINTAINABILITY clean-code category at CRITICAL/BLOCKER severity) finds exactly
one such finding outside S3776:

| rule | component | line | severity | Disposition |
|---|---|---|---|---|
| `typescript:S3516` | `src/adapters/cli/commands/draft-setup.ts` | 259 | CRITICAL | bounded follow-up slice |

`S3516` — `ensureGraphifyIgnore` has two early `return true` guards; the function
returns the same value on both. It is recorded as a bounded follow-up slice with
a stated target (extract the guards into a helper returning a discriminated
result; cover both branches) in
`missions/task-2525.02/non-s3776-maintainability-critical-blocker.tsv`. It is
resolved as a separate slice, not suppressed or mass-refactored (SC4). This is
the one non-S3776 critical/blocker maintainability finding the mission names.

## SC3 — no rule disabled or suppressed

`sonar-project.properties` is unchanged from the baseline: it still declares
supported Sonar way defaults, `sonar.qualitygate.wait=true`, and no rule is
globally disabled, suppressed, or excluded to reduce a count.

```
sonar.projectKey=parallix
sonar.sources=src
sonar.qualitygate.wait=true
```

No `// sonarlint` / `sonar-qube` suppression directive was added anywhere in
`src/`.

## SC5 — no metric-only / suppression-only slice

Slice A reduces an S3776 count only by extracting control flow into helpers
whose branches are each covered by a passing focused test; the reduction is
evidenced by behavior (SC1), not by relocating complexity or silencing the rule.

## SC4 status — SATISFIED

SC4 requires every critical S3776 finding to be resolved or listed as a
follow-up with a stated target. Slice A resolves 1 (`validateDeclaredGates`).
The 117 outstanding findings are durably inventoried in
`missions/task-2525.02/s3776-findings.tsv`, produced from a fresh SonarQube
analysis (`scripts/sonar-local.ts scan`, server up on `127.0.0.1:9000`); each
row carries a stated follow-up target (bounded slice by path, nested follow-up
for untestable boundaries: `forgejo-pr.ts`, `startup-preflight.ts`/
`preflight-review.ts`). Every outstanding finding maps to a bounded follow-up —
none left untriaged. The Goal Check SC4 row below reflects this.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| All S3776 findings resolved or in bounded follow-up (SC4) | Slice A resolves `validateDeclaredGates`; 117 outstanding durably inventoried in `missions/task-2525.02/s3776-findings.tsv`, each with a stated follow-up target; 0 untriaged | PASS |
| No rule disabled/suppressed/excluded (SC3) | `sonar-project.properties` unchanged; no suppression directive in `src/` | PASS |
| No metric-only/suppression-only slice (SC5) | Slice A reduction evidenced by `test/gate-validation-refactor.test.ts` | PASS |
| Follow-up backlog task generated without touching assignee | `task-2525.04` frontmatter `assignee: []` (restricted area honored) | PASS |

### Verifiable command

```
grep -rn "sonarlint\|sonar-qube" src/   # expect no suppression directives
git show HEAD:sonar-project.properties   # unchanged Sonar way defaults
```

## Next action
Run the full verification gate `./scripts/verify-local.sh all` and record the result in CP-5.
