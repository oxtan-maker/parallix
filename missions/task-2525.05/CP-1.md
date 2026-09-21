# CP-1 — SonarQube execution baseline

## Summary

Ran a fresh local analysis for project `parallix`. The SonarQube compute-engine task completed successfully. The unresolved `HIGH,BLOCKER` inventory contains 138 issues: 113 `typescript:S3776`, 16 `typescript:S3735`, 5 `typescript:S2004`, 2 `typescript:S2871`, 1 `typescript:S3516`, and 1 `typescript:S4123`.

The scan command reached the quality-gate wait and reported the existing coverage condition (`coverage: 0.0 < 90`) because this baseline scan intentionally did not first produce LCOV. The final workflow will use the repository's coverage-plus-scan command.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A fresh local SonarQube analysis completes against `parallix` | `npm run sonar`; `http://127.0.0.1:9000/api/ce/component?component=parallix` reported compute-engine task `SUCCESS` | PASS |
| Final unresolved High-or-worse inventory is zero | `curl -fsS 'http://127.0.0.1:9000/api/issues/search?componentKeys=parallix&resolved=false&impactSeverities=HIGH,BLOCKER&ps=500'` returned `total: 138` at this baseline | PENDING CP-4 |
| Every baseline finding is remediated at its source site without suppression or configuration changes | Baseline API command above; `sonar-project.properties` remains the scanner authority | PENDING CP-2/CP-3 |
| All six baseline rule families are eliminated | Baseline API distribution: `S3776=113`, `S3735=16`, `S2004=5`, `S2871=2`, `S3516=1`, `S4123=1` | PENDING CP-2/CP-3 |
| Non-trivial refactors have focused regression evidence and no focused skips | `test/sonarqube-reliability-repairs.test.ts`; `test/sonarqube-s2871-sorts.test.ts` | PENDING CP-2/CP-3 |
| Repository verification gates pass | `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: query the 113 `typescript:S3776` issue locations and group them by behavioral module for the first complexity-remediation batch.
