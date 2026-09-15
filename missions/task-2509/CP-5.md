# CP-5: Make release completion idempotent only for one SHA

Extended release coverage for collision and partial-publication recovery. The
release script accepts an existing npm version or tag only when its recorded
`gitHead`/tag commit equals the trusted SHA. Otherwise it aborts. After a new
publish it creates the annotated tag at that SHA, pushes it, and creates the
matching GitHub Release; reruns skip only already-complete matching steps.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Tag collision and foreign publication fail closed | `test/task-2509-release-publish.test.ts`, test `task-2509: tag collision and another SHA publication fail closed` | PASS |
| Partial-release rerun accepts only matching publication and tag | `test/task-2509-release-publish.test.ts`, test `task-2509: rerun accepts publication and tag only for the same trusted SHA` | PASS |
| Tag and GitHub Release target the verified source SHA | `scripts/release-publish.ts`, `.github/workflows/ci-required.yml` | PASS |
| Release logic remains type-safe | `npm run typecheck` | PASS |

Next action: Consult `docs/doc-standards.md`, replace ADR 0046’s manual/token publication guidance with the GitHub Trusted Publishing release contract, update only directly affected live guidance, then run all final gates.
