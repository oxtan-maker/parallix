# CP 4 — Update the CI step and the pre-integration gate to the isolated command, and update docs

## Goal
Confirm both pipeline declarations run the isolated scan command and query the
isolated identity, and document the workflow behavior change.

## Work done
Both call sites already invoke `npm run sonar`, which now derives the isolated
identity internally — no command-string change was needed, and the existing
`task-2525.03` test that pins the shared command string still passes.

- `.github/workflows/ci-required.yml` — the "Run coverage plus mandatory
  SonarQube quality gate" step runs `npm run test:coverage -- --threshold 0
  --lcov && npm run sonar`. Added a comment explaining the per-branch identity
  derivation (main → `parallix`, others → `parallix-<branch>`, ADR 0060) and
  that CI's detached checkout falls back to `GITHUB_REF_NAME`. The
  `ci-required` job name is untouched (branch-protection literal).
- `workflow.config.json` `adapters.gates.preIntegration[3]` (`quality-gate`) —
  same `npm run sonar` command, isolated internally.
- `config/integration-pipelines.json` — confirmed it declares no sonar/quality
  gate; the `quality-gate` gate lives in `workflow.config.json`.
- Durable decision documented in ADR 0060. No README/config doc mentioned
  SonarQube, so nothing else to update.

The mandatory gate rule (`new_violations > 0`) is unchanged (SC5).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CI step runs isolated scan command | `.github/workflows/ci-required.yml` `npm run sonar` (derives identity per ADR 0060) | PASS |
| Pre-integration gate runs isolated scan command | `workflow.config.json` `adapters.gates.preIntegration[3]` `quality-gate` `npm run sonar` | PASS |
| CI job name unchanged (branch protection) | `.github/workflows/ci-required.yml` `name: ci-required` | PASS |
| Gate rule unchanged | ADR 0060 "Consequences"; `scripts/sonar-local.ts` `assertNewIssuesFail` still asserts `new_violations > 0` | PASS |
| Shared-command test still passes | `test/task-2525.03-sonar-enforcement.test.ts` "GitHub workflow and pre-integration gate reference the same shared command" | PASS |

## Next action
Commit CP-4.md, then CP 5: the focused automated test is already written and
passing (`test/task-2544-sonar-worktree-isolation.test.ts`); register it,
commit, and write CP-5.
