# CP-1: Remove local Docker Sonar infrastructure and obsolete tests

## Summary

Deleted the local SonarQube Community Build footprint that ADR 0060 (Cloud revision) retires:

- Removed `infra/sonarqube/compose.yml` and with it the whole `infra/` tree (it held nothing else), so the Sonar/PostgreSQL Compose stack no longer exists in the repository.
- Removed the `sonar:up` and `sonar:setup` scripts from `package.json`. `npm run sonar` remains as the single scan entrypoint (rewritten in CP-2).
- Deleted the two tests that only assert retired behaviour: `test/task-2544-sonar-worktree-isolation.test.ts` (per-branch project-key isolation) and `test/task-2527-local-sonar.test.ts` (local admin-password/token-file setup).
- Removed the matching registry entries for both deleted files from `test/lib/test-categories.ts` and `test/default-test-suite.test.ts`, so the integration-layer routing lists no longer name files that do not exist.

The project-key machinery inside `scripts/sonar-local.ts` and the Sonar sections of `test/task-2525.03-sonar-enforcement.test.ts` are removed together with the entrypoint rewrite in CP-2, keeping the tree importable at every commit.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: local Docker Sonar stack removed | `git ls-files \| grep infra/sonarqube` returns nothing; the Compose file is absent from the tracked tree | PASS |
| SC1: `sonar:up` / `sonar:setup` absent from package.json scripts | `grep -n 'sonar:' package.json` matches nothing; only `"sonar"` remains | PASS |
| SC6: obsolete Sonar tests deleted | `test/task-2544-sonar-worktree-isolation.test.ts` and `test/task-2527-local-sonar.test.ts` no longer exist under `test/` | PASS |
| Test registries stay consistent with the tree | `npx tsx --test test/default-test-suite.test.ts` — 4/4 pass, including "default test runner routes every moved group to integration and excludes it from default" | PASS |
| Decision alignment | ADR 0060 ("SonarQube Cloud analysis for local and hosted verification") removes project-per-mission emulation and the local Community Build deployment | PASS |

Next action: CP-2 — rewrite `scripts/sonar-local.ts` into the single Cloud scan entrypoint (organization `oxtan-maker`, project `parallix`, `sonar.branch.name` from the local Git branch), point `sonar-project.properties` at `https://sonarcloud.io`, and confirm the `sonarqube-scanner` devDependency pin backs `npm run sonar`.
