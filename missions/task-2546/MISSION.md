# Mission: <Title> (task-2546)

## Goal
Replace Parallix's split local SonarQube Community Build implementation with **SonarQube Cloud as the single Sonar analysis service** for both local mission verification and GitHub `ci-required` publication verification. After the migration the repository has exactly one repository-owned scan entrypoint (`npm run sonar`) that submits to `https://sonarcloud.io`, organization `oxtan-maker`, project `parallix`, using the real Git branch as the Sonar branch identity; local missions and GitHub share it, differing only where the environment genuinely differs (local supplies `sonar.branch.name`, GitHub lets Sonar's CI integration derive branch/PR metadata). The local Docker Sonar/PostgreSQL stack, per-branch project-key machinery, and the `SONAR_HOST_URL` secret abstraction are removed.

## Why Now
The split architecture exists only to work around SonarQube Community Build's lack of native branch analysis (TASK-2544). It carries substantial accidental complexity: one Sonar project per mission/branch, branch-name sanitisation, SHA-256 project-key suffixes, detached-HEAD/branch inference, local Docker + PostgreSQL, local admin-password/token setup, per-project cleanup, and divergent local/GitHub identity semantics. A live Cloud scan against `c981816b9a1c2ff673ace500669ec9f2b74698ad` already passed its quality gate in `1:57.614 s` — measured latency comparable to the local path. ADR 0060 already records this decision; the codebase still runs the old path, so the decision must now be realised in code, tests, workflow, and docs. The task explicitly supersedes TASK-2544 and forbids preserving the old architecture as a compatibility layer (no `SONAR_MODE=local|cloud` toggle).

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: removal of dead local-Docker + project-key infrastructure, single shared scan entrypoint, workflow and test migration to Cloud, live Cloud integration proof.

## Scope
- Delete `infra/sonarqube/` (Compose Sonar/PostgreSQL stack) and the `sonar:up` / `sonar:setup` package.json scripts.
- Rewrite `scripts/sonar-local.ts` into the single shared scan entrypoint: `https://sonarcloud.io`, org `oxtan-maker`, project `parallix`, consume `coverage/lcov.info`, resolve the local Git branch as `sonar.branch.name`, wait for the Cloud quality gate, fail closed on missing `SONAR_TOKEN` / analysis failure / gate failure, never print the token. Lockfile-pine the scanner dependency (no `npx --yes` in the required gate).
- Update `sonar-project.properties`: remove `http://127.0.0.1:9000`, keep stable repository analysis config only; preserve new-code baseline vs `main`.
- Remove project-key machinery: `resolveSonarProjectKey()`, `resolveSonarBranch()`, `sanitizeProjectKey()`, `encodeBranchIdentity()`, admin-password prompt, Forgejo local token-file storage/reuse for Sonar, `127.0.0.1:9000` default.
- Update `.github/workflows/ci-required.yml`: checkout exact SHA with full history, run GitHub-safe verification, generate LCOV, analyze via the same `npm run sonar` path, let Sonar's CI integration supply branch/PR identity, wait for the quality gate, fail `ci-required` on gate failure. Require only `SONAR_TOKEN`; remove the `SONAR_HOST_URL` secret. Preserve the trusted-run boundary so untrusted fork PRs never receive the token.
- Delete/replace obsolete tests: `test/task-2544-sonar-worktree-isolation.test.ts`, `test/task-2527-local-sonar.test.ts`, and the Sonar sections of `test/task-2525.03-sonar-enforcement.test.ts` that assert retired behaviour. Do not mechanically rename assertions.
- Retain/add focused coverage for surviving Cloud wiring: token handling, Cloud endpoint/project config, local branch selection, GitHub trusted/untrusted credential boundary, LCOV wiring, quality-gate wait/fail semantics, and that local + GitHub use the same entrypoint.
- Inspect the real Cloud quality gate for `parallix` and reconcile with TASK-2525's intended new-code policy; do not weaken coverage/rule/severity policy. Configure the provider only if the available credential is authorised; otherwise stop with a precise operator action required.
- Update operator/development documentation and ADR index to reflect Cloud-only Sonar; remove instructions for the removed local Docker setup.

## Out of Scope
- Any Sonar code in generic Parallix product/domain/application layers (ADR 0060 product boundary). Sonar stays repository tooling/configuration only.
- Creating one Cloud project per mission, or hashing/sanitising branch names into project keys.
- Exposing the local workstation to GitHub, adding a self-hosted GitHub runner, or standing up a disposable Sonar server inside GitHub runs.
- Committing, deriving, printing, or manufacturing `SONAR_TOKEN`.
- Lowering coverage thresholds, disabling rules, adding exclusions/suppressions, or changing severity to make the migration green.
- Implementing the mission; this document is the contract only.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and enumerates the specific files, symbols, and behaviours that must survive or be removed.

1. `infra/sonarqube/compose.yml` and the `infra/sonarqube/` directory no longer exist; `sonar:up` and `sonar:setup` are absent from `package.json` scripts.
2. `scripts/sonar-local.ts` no longer exports `resolveSonarProjectKey`, `resolveSonarBranch`, `sanitizeProjectKey`, or `encodeBranchIdentity`; no `127.0.0.1:9000` literal remains anywhere in the repo (excluding `node_modules`, `build`, `graphify-out`).
3. `sonar-project.properties` contains `sonar.host.url=https://sonarcloud.io` (or no host.url, letting the pinned scanner default to Cloud), `sonar.projectKey=parallix`, `sonar.sources=src`, LCOV path `coverage/lcov.info`, and new-code reference branch `main`; no `http://127.0.0.1:9000` line remains.
4. The required pre-integration gate in `workflow.config.json` (`adapters.gates.preIntegration` entry `quality-gate`) and `.github/workflows/ci-required.yml` invoke the same `npm run sonar` entrypoint; the scanner dependency is lockfile-pinned (present in `package-lock.json` / `package.json`), not `npx --yes`.
5. `.github/workflows/ci-required.yml` no longer references a `SONAR_HOST_URL` secret; it requires only `SONAR_TOKEN`, and the trusted-run `if:` guard (`github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository`) still scopes the token away from untrusted fork PRs.
6. No test file imports a symbol from `scripts/sonar-local.ts` that was removed (e.g. `resolveSonarProjectKey`); `test/task-2544-sonar-worktree-isolation.test.ts` and `test/task-2527-local-sonar.test.ts` are deleted; Sonar sections of `test/task-2525.03-sonar-enforcement.test.ts` no longer assert the retired project-key path.
7. Final-tree search confirms no `SONAR_MODE`, no local-`127.0.0.1:9000` default, no per-mission project-key resolver, and no dormant local/cloud fallback remains.
8. `./scripts/verify-local.sh all` passes on the final TASK-2546 worktree with the local Docker path removed.
9. A live SonarQube Cloud scan from the final worktree produces evidence containing `Server URL: https://sonarcloud.io`, the exact final mission HEAD as the SCM revision ID, and `QUALITY GATE STATUS: PASSED`.
10. The live Cloud project `parallix` shows the `mission/task-2546` analysis as a branch distinct from `main`; the `main` branch analysis is not overwritten.
11. Documentation (`docs/` developer/operator guides) describes Cloud-only Sonar verification, states `SONAR_TOKEN` is required for a local scan, and contains no steps for `sonar:up` / `sonar:setup` / local Docker.
12. ADR 0060 records the 2026-09-20 Cloud evidence (`1:57.614 s`, quality gate passed on `c981816b9a1c2ff673ace500669ec9f2b74698ad`) and a reconsideration trigger covering latency, concurrent-scan queueing/throttling, availability, service limits, cost, and confidentiality.
13. No new Sonar provider abstraction, API port, domain concept, or lifecycle operation is introduced into `src/domain`, `src/application`, or `src/adapters` beyond repository verification tooling.

## Risks and Assumptions
- **Cloud availability during integration:** local integration now needs network access to sonarcloud.io. Assumption: reachable during the mission; if not, the local proof (Success Criterion 9) cannot complete — escalate, do not fake.
- **Quality gate may not be green for the mission branch:** the real `parallix` Cloud gate might not express TASK-2525's intended new-code coverage threshold. Risk: either the migration looks red or weakening policy is tempting. Mitigation: inspect the real gate; configure it only if the credential is authorised, else stop with operator action required. Never lower thresholds.
- **New-code baseline vs main:** Cloud new-code calculation needs full Git history and the `main` ref. Assumption: `fetch-depth: 0` (GitHub) and local full checkout supply this.
- **Token boundary:** removing `SONAR_HOST_URL` and centralising must not accidentally expose `SONAR_TOKEN` to untrusted fork PRs. The trusted-run guard is preserved.
- **ADR 0060 already exists in Cloud form:** it currently documents the decision; the implementation must not contradict it, and the rewrite of ADR 0060 during execution should preserve its reconsideration-trigger content.
- **Scanner lockfile pinning:** adding a pinned scanner dependency must land in `package.json`/`package-lock.json` and be used by the entrypoint, not resolved via `npx --yes` at gate time.

## Checkpoints
- CP 1: Delete local Docker Sonar infrastructure and per-branch project-key machinery; remove obsolete tests.
- CP 2: Build the single shared `npm run sonar` Cloud scan entrypoint + update `sonar-project.properties` + lockfile-pine the scanner.
- CP 3: Migrate `.github/workflows/ci-required.yml` to the Cloud path with the preserved trusted-run boundary.
- CP 4: Add/retain focused Cloud-wiring tests; inspect and reconcile the real Cloud quality gate with TASK-2525 policy.
- CP 5: Update docs + ADR index; run final `./scripts/verify-local.sh all`; capture live Cloud integration evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm run sonar` ``, `` `npm run test:ci` ``, `` `node --import tsx test/sonarqube-cloud-wiring.test.ts` ``, `` `git log --oneline -1` ``
  2. **Test names** — must match a test name in the repo (e.g. a Cloud-wiring test you author)
  3. **Test file paths** — must be an existing test file under `test/`
  4. **ADR references** — e.g., `ADR 0060`, `ADR 0058`, `ADR 0057` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- The weak-agent failure mode is real: raw `stat`/`ls` output or generic prose alone is NOT enough. Pair any shell output with one of the accepted references above (a recognized repo command, an exact test name, a test file path, or an ADR reference). For example, do not only run `ls infra/` to claim removal; cite `` `./scripts/verify-local.sh all` `` passing and the deleted-file check via `` `git ls-files | grep sonar` `` alongside the accepted reference.
- For Success Criteria 9 and 10 specifically, the evidence MUST be the live SonarQube Cloud run output (`Server URL: https://sonarcloud.io`, exact SCM revision ID = final mission HEAD, `QUALITY GATE STATUS: PASSED`) — a unit test or mocked scanner is not accepted as proof that Cloud accepted the analysis or gate.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Shared Cloud entrypoint exists | `scripts/sonar-local.ts`, `` `npm run sonar` `` | PASS |
| Local Docker stack removed | `git ls-files | grep infra/sonarqube` returns nothing; `` `./scripts/verify-local.sh all` `` | PASS |
| Cloud quality gate passed | live scan log: `Server URL: https://sonarcloud.io`, `SCM revision ID '<final HEAD>'`, `QUALITY GATE STATUS: PASSED` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/domain`, `src/application`, `src/adapters`: do not introduce Sonar provider abstractions, API ports, domain concepts, or lifecycle operations. Sonar stays repository verification tooling/configuration only (Success Criterion 13).
- `package.json` / `package-lock.json`: may add a lockfile-pined scanner dependency; do not otherwise widen dependencies.
- `workflow.config.json` `adapters.gates.preIntegration`: the `quality-gate` gate command may change to the Cloud entrypoint; do not weaken or remove required gates.
- `docs/adr/`: only ADR 0060 and its index entry are in scope; do not author new ADRs.
- The `SONAR_TOKEN` secret: never commit, derive, print, or manufacture it.

## Stop Rules
- Stop before claiming Success Criterion 9/10 if no live Cloud scan could be run; report the operator action required rather than substituting a test double or scanner-upload success.
- Stop and escalate if the real Cloud quality gate cannot be reconciled with TASK-2525 policy using an authorised credential; do not weaken coverage/rule/severity policy to obtain green.
- Stop if `SONAR_TOKEN` cannot be supplied by the environment; the local Cloud proof is impossible without it.
- Do not proceed past draft: no implementation, no review/integrate phase, no test runs beyond the single `./scripts/verify-local.sh all` gate.
- Do not push the mission branch to `origin`; only `main` may be pushed there.
