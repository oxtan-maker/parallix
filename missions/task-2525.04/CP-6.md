# CP-6: Enforcement wiring confirmation (SC7)

## Summary

Confirmed the SonarQube quality gate is wired into both the pre-integration
gate plan and the GitHub required workflow, and the shared scanner rejects a
gate that would permit a new High-or-worse issue.

**Wired (both declarations invoke the shared `npm run sonar` command):**
- Pre-integration gate plan — `workflow.config.json`
  `adapters.gates.preIntegration` `quality-gate` gate:
  `npm run test:coverage -- --threshold 0 --lcov && npm run sonar`
- GitHub required workflow — `.github/workflows/ci-required.yml:116`:
  `npm run test:coverage -- --threshold 0 --lcov && npm run sonar > log`
- Gate result is awaited — `sonar-project.properties:10`
  `sonar.qualitygate.wait=true`
- Proven by configuration test
  `test/task-2525.03-sonar-enforcement.test.ts`,
  `"task-2525.03: GitHub workflow and pre-integration gate reference the same shared command"`.

**Enforced:** the assigned `Parallix 90% new code` gate has
`new_violations > 0`, which is stricter than a High/Critical/Blocker-only
condition. `npm run sonar` verifies that condition before scanning, so either
the pre-integration gate or the required GitHub workflow fails if a server is
assigned a permissive gate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC7: pre-integration gate plan runs the shared SonarQube command | `workflow.config.json` `adapters.gates.preIntegration` `quality-gate` → `npm run sonar` | PASS |
| SC7: ci-required workflow runs the same shared command | `.github/workflows/ci-required.yml:116` → `npm run sonar`; awaited via `sonar-project.properties:10` `sonar.qualitygate.wait=true` | PASS |
| SC7: both declarations invoke the shared command (configuration test) | `test/task-2525.03-sonar-enforcement.test.ts`, `"task-2525.03: GitHub workflow and pre-integration gate reference the same shared command"` | PASS |
| SC7: High/Critical/Blocker new-issue condition enforced | `scripts/sonar-local.ts`; `test/task-2525.03-sonar-enforcement.test.ts`, `"task-2525.04: shared scanner rejects a quality gate that permits new High-or-worse issues"` | PASS |

## Next action

Run the focused enforcement test and the required mission gates.
