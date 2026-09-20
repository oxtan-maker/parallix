---
id: TASK-2546
title: >-
  Replace Parallix's split/local SonarQube implementation with **SonarQube Cloud
  as the single Sonar analysis service for both local mission verification and
  GitHub publication verification**.
status: backlog
assignee: []
created_date: '2026-09-20 17:40'
labels: []
dependencies: []
ordinal: 87008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This task supersedes the architecture implemented by TASK-2544 and alignes with the updated ADR 0060. Do not preserve the old architecture as a compatibility layer.

### Why

The current implementation works around SonarQube Community Build's branch limitations by turning each Git branch/worktree into a separate Sonar project. That solved a real concurrency problem — parallel missions must not overwrite one another's analyses — but at the cost of substantial accidental complexity:

* one Sonar project per mission/branch;
* branch-name sanitisation;
* SHA-256 project-key suffixes;
* detached-HEAD / environment branch inference;
* local Docker + PostgreSQL infrastructure;
* local Sonar administrator/token setup;
* eventual per-project cleanup requirements; and
* different identity semantics locally and in GitHub Actions.

SonarQube Cloud provides native branch analysis, so the actual desired model is simpler:

```text
SonarQube Cloud project: parallix

main
mission/task-2546
mission/task-XXXX
github-publish/<sha>
PR branches
```

The Git branch is the analysis identity. Do not invent a second project-identity namespace on top of it.

A live SonarQube Cloud scan has already been proven against commit:

`c981816b9a1c2ff673ace500669ec9f2b74698ad`

using:

SONAR_ORGANIZATION=oxtan-maker
SONAR_PROJECY_KEY=oxtan-maker_parallix

The live scanner reported:

```text
SCM revision ID 'c981816b9a1c2ff673ace500669ec9f2b74698ad'
QUALITY GATE STATUS: PASSED
Analysis total time: 1:57.614 s
```

Observed Cloud wall time is currently comparable to the local Community Build path. Prefer the simpler architecture now; retain a reconsideration trigger rather than carrying speculative fallback infrastructure.

### Local mission verification

Local missions use the one Cloud project.

A mission scan must analyze the mission's real Git branch using SonarQube Cloud's native branch support. For example:

```text
mission/task-2546 -> Sonar branch mission/task-2546
```

For local execution, where there is no CI provider to supply branch metadata, the repository scanner entrypoint may resolve the checked-out Git branch and pass it as `sonar.branch.name`.

Do not derive a **project key** from the branch.

Mission new-code analysis is relative to `main`. Preserve sufficient Git history/reference information for Sonar to calculate that comparison correctly.

### GitHub verification

GitHub does not run Parallix missions and must not use the old Community Build mission/project workaround.

The existing `ci-required` workflow must:

1. check out the exact triggered SHA with sufficient history;
2. run the existing GitHub-safe verification;
3. generate LCOV;
4. analyze the same checkout using the same SonarQube Cloud project;
5. allow Sonar's supported GitHub CI integration to provide branch/PR identity where possible rather than recreating it from `GITHUB_REF_NAME`;
6. wait for the actual quality-gate result; and
7. fail `ci-required` when analysis or the quality gate fails.

For ADR 0058 `github-publish/<sha>` pushes, the scanner log must associate the analysis with the exact GitHub-triggered commit SHA. A scanner upload alone is not verification.

GitHub needs only `SONAR_TOKEN` as a secret for this integration. The Cloud URL, organization and project key are configuration, not secrets.

Remove the current `SONAR_HOST_URL` secret-based abstraction if it exists only to let GitHub point at a non-local Sonar server.

Untrusted fork pull-request code must never receive `SONAR_TOKEN`. Preserve or improve the existing trusted-run boundary; do not solve fork analysis by exposing the secret.

### Shared scanner path

There must be one repository-owned Sonar scan entrypoint used by both:

* local pre-integration; and
* GitHub CI.

It may behave differently only where the execution environment genuinely differs, e.g. local execution supplying `sonar.branch.name` while GitHub/Sonar derives CI branch/PR metadata natively.

Do not create separate "local scanner" and "GitHub scanner" implementations.

Use a **lockfile-pinned scanner dependency**. A required gate must not depend on `npx --yes` downloading whichever scanner version happens to be current at execution time.

The scanner must:

* use `https://sonarcloud.io`;
* analyze organization `oxtan-maker`;
* analyze project `parallix`;
* consume the repository LCOV report;
* wait for quality-gate completion;
* exit non-zero on analysis or quality-gate failure;
* fail clearly when `SONAR_TOKEN` is unavailable; and
* never print the token.

Shared `sonar-project.properties` should contain stable repository analysis configuration only. Remove local Community Build assumptions such as `http://127.0.0.1:9000`.

### Remove the local SonarQube implementation

Delete the repository code and infrastructure whose only purpose is supporting local Docker SonarQube Community Build.

This includes, where still present:

* `infra/sonarqube/compose.yml` and the local Sonar infrastructure directory if nothing else uses it;
* `sonar:up`;
* `sonar:setup`;
* local administrator-password prompting;
* local Sonar token generation/revocation;
* Forgejo-local token-file storage/reuse for Sonar;
* `127.0.0.1:9000` as a Sonar default;
* branch -> project-key sanitisation;
* SHA-256 project-key suffixing;
* `resolveSonarProjectKey()` or equivalent per-project identity machinery;
* per-mission Sonar project cleanup logic if any has appeared by implementation time; and
* tests whose only purpose is protecting those retired behaviours.

Prefer deleting obsolete code over leaving a dormant fallback.

If `scripts/sonar-local.ts` remains useful only because it contains the shared scan wrapper, rename/refactor it to describe its actual role rather than leaving a "local" abstraction that no longer exists.

### Remove obsolete tests, preserve real guarantees

Delete or replace tests that assert the retired implementation rather than the desired behaviour.

In particular, reassess:

* `test/task-2544-sonar-worktree-isolation.test.ts`;
* `test/task-2527-local-sonar.test.ts`; and
* Sonar sections of `test/task-2525.03-sonar-enforcement.test.ts`.

Do not mechanically rewrite tests so old assertions remain green under new names.

Retain focused automated coverage for repository-owned behaviour that is still meaningful, including:

* token handling;
* Cloud endpoint/project configuration;
* local branch selection;
* GitHub trusted/untrusted credential boundary;
* LCOV wiring;
* quality-gate wait/fail semantics; and
* the fact that local and GitHub declarations use the same scanner entrypoint.

Mock-based tests prove repository wiring only. They must not be cited as proof that SonarQube Cloud itself accepted an analysis or quality gate.

### Quality policy

Do not weaken Sonar policy to make this migration green.

Inspect the actual active SonarQube Cloud quality gate for `parallix` and reconcile it with the repository's already-decided quality intent from TASK-2525.

At minimum preserve the existing intended progressive-quality policy, including the required new-code coverage threshold.

If the Cloud project's real gate does not express a condition this repository currently claims to require, do not add a fake local assertion and claim equivalence. Configure the provider when the available credential is authorised to do so, or stop with a precise operator action required.

Dead helpers that inspect a quality-gate configuration but are never called by the real verification path must either become real executable enforcement or be deleted.

### Documentation

Update operator/development documentation to reflect the resulting reality:

* `SONAR_TOKEN` is required for a local Sonar scan;
* SonarQube Cloud is the canonical provider;
* local Docker SonarQube setup no longer exists;
* local missions use native Cloud branch isolation; and
* GitHub independently re-runs the analysis against the publication candidate.

Do not document removed fallback commands.

### Self-proof contract

This mission deliberately removes the infrastructure it previously depended on **before claiming success**.

The final mission tree must contain no working local-Docker Sonar path.

The normal repository pre-integration `quality-gate` must then execute from the final TASK-2546 worktree:

```text
coverage -> SonarQube Cloud scan -> Cloud processing -> quality-gate result
```

and pass.

The evidence must come from the live run and include at least:

```text
Server URL: https://sonarcloud.io
SCM revision ID '<TASK-2546 final HEAD>'
QUALITY GATE STATUS: PASSED
```

The final integration must therefore be impossible to complete successfully by relying on the removed `127.0.0.1:9000` Docker deployment.

After local integration, ADR 0058 supplies the second proof: the resulting exact integration SHA is published to `github-publish/<sha>` and `ci-required` must successfully analyze that exact SHA with SonarQube Cloud before remote `main` may advance.

The local integration proof and GitHub external proof are deliberately separate trust boundaries. Do not simulate either one with a test double.

### Operator prerequisite

The repository owner must configure the GitHub Actions repository secret:

```text
SONAR_TOKEN
```

with a SonarQube Cloud token authorized to analyze `oxtan-maker/parallix`.

The mission must not attempt to commit, derive, print or manufacture this credential.

### Do not

* Do not retain local Docker Sonar as an automatic fallback.
* Do not add a `SONAR_MODE=local|cloud` abstraction.
* Do not preserve per-mission Sonar projects "in case Cloud gets slow later".
* Do not add Sonar code to the generic Parallix product/application layers.
* Do not create one Cloud project per mission.
* Do not hash Git branch names into Sonar project keys.
* Do not make GitHub use the old worktree/project-key resolver.
* Do not expose the local workstation Sonar server to GitHub.
* Do not add a self-hosted GitHub runner to reach local infrastructure.
* Do not start a disposable SonarQube server inside every GitHub run.
* Do not use an unpinned network-resolved scanner in a required gate.
* Do not lower coverage thresholds, disable rules, add exclusions, suppress findings, or change severity to make the migration pass.
* Do not treat scanner upload success as equivalent to a green quality gate.
* Do not retain tests whose only purpose is to make deleted infrastructure look supported.
* Do not claim Cloud branch isolation is proven by unit tests alone when a live branch analysis can be observed.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

* [ ] #1 ADR 0060 is replaced with a proper decision comparing the credible Sonar topologies and accepting SonarQube Cloud for both local and GitHub analysis while measured performance remains suitable; `docs/adr/index.md` references the decision.
* [ ] #2 Local mission analysis uses the single SonarQube Cloud project `oxtan-maker / parallix` and native Sonar branch analysis; no mission creates its own Sonar project.
* [ ] #3 The repository no longer contains branch-to-project-key sanitisation, project-key hashing, detached-HEAD project-key inference, or equivalent TASK-2544 project-isolation machinery.
* [ ] #4 Local Docker SonarQube support is removed: no Compose Sonar/PostgreSQL stack, `sonar:up`, `sonar:setup`, local admin-password/token-generation path, local Sonar token file, or `127.0.0.1:9000` Sonar default remains.
* [ ] #5 The required Sonar scanner is lockfile-pinned and invoked through one repository-owned scan entrypoint used by local pre-integration and GitHub CI.
* [ ] #6 Local execution analyzes the actual mission Git branch under project `parallix`, compares new code with `main`, consumes `coverage/lcov.info`, waits for the provider quality gate, and fails closed on missing credentials, analysis failure or gate failure.
* [ ] #7 The final TASK-2546 pre-integration quality gate runs after the local Docker implementation has been removed and produces live evidence containing `Server URL: https://sonarcloud.io`, the exact final mission HEAD as the SCM revision, and `QUALITY GATE STATUS: PASSED`.
* [ ] #8 The live Cloud project shows the TASK-2546 mission analysis as a branch of project `parallix`; it does not overwrite the `main` branch analysis.
* [ ] #9 `.github/workflows/ci-required.yml` analyzes SonarQube Cloud using the same repository scan path after LCOV generation, waits for the quality gate and fails when it fails.
* [ ] #10 GitHub requires only `SONAR_TOKEN` as a Sonar secret; no `SONAR_HOST_URL` secret or workstation/local-server reachability is required, and the token is unavailable to untrusted fork code.
* [ ] #11 The first `github-publish/<sha>` run produced from the integrated change associates Sonar analysis with that exact integration SHA and must pass the Cloud quality gate before ADR 0058 permits remote `main` to advance.
* [ ] #12 Obsolete TASK-2527/TASK-2544 local-infrastructure/project-key tests are deleted or replaced with tests of the surviving Cloud wiring; no test is retained solely to preserve removed implementation.
* [ ] #13 The actual SonarQube Cloud quality gate is inspected against TASK-2525's intended new-code policy; the migration does not weaken coverage/rule/severity policy to obtain green status.
* [ ] #14 Sonar-specific code remains repository tooling/configuration only; no new Sonar provider abstraction, API port, domain concept or lifecycle operation is introduced into generic Parallix product code.
* [ ] #15 Operator/development documentation describes Cloud-only Sonar verification and contains no instructions for the removed local Docker setup.
* [ ] #16 ADR 0060 records the observed 2026-09-20 Cloud evidence (`1:57.614 s`, quality gate passed on `c981816b9a1c2ff673ace500669ec9f2b74698ad`) and a reconsideration trigger covering material latency increase, concurrent-scan queueing/throttling, availability, service limits, cost and confidentiality.

<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
* [ ] #1 Verification gates ran and passed on the final tree with captured proof rather than an agent claim.
* [ ] #2 `./scripts/verify-local.sh static-analysis`, the normal test suites and all repository checks affected by this migration pass without weakening or skipping coverage.
* [ ] #3 No focused or unannotated skipped tests were introduced (`.only` / bare `.skip`), and obsolete Sonar tests were removed rather than disabled.
* [ ] #4 Final checkpoint Goal Check cites the live SonarQube Cloud TASK-2546 analysis, exact analyzed Git SHA and quality-gate outcome in addition to ordinary test evidence.
* [ ] #5 Final-tree search confirms there is no supported local Docker SonarQube path, localhost Sonar default, per-mission project-key implementation, or dormant local/cloud fallback.
* [ ] #6 Documentation and ADR index match the implemented Cloud-only architecture.
* [ ] #7 The mission is not considered self-verified unless its normal pre-integration Sonar gate has passed against SonarQube Cloud after the local Sonar implementation was deleted.

- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
