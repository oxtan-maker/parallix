# ADR 0060: SonarQube Cloud analysis for local and hosted verification

Status: Accepted
Date: 2026-09-20
Replaces: previous ADR 0060 (`per-worktree-sonarqube-analysis-identity`)
Related: ADR 0041 (integration pipeline gates), ADR 0048 (fail-closed harness), ADR 0057 (verification tiers and trust boundaries), ADR 0058 (`github-publish` mode)

## Context

Parallix uses Sonar analysis as one component of its repository verification policy. The analysis must support two execution environments:

1. local Parallix development, where several missions may be active and verified concurrently in separate Git worktrees; and
2. GitHub publication verification, where ADR 0058 publishes an exact integrated commit for independent verification before remote `main` advances.

The original ADR 0060 addressed concurrent local missions by assigning every non-main Git branch a separate SonarQube Community Build project. That avoided one mission overwriting another mission's analysis, but introduced substantial accidental complexity:

* branch-to-project-key translation;
* branch-name sanitization;
* cryptographic suffixes to avoid key collisions;
* detached-HEAD and CI branch inference;
* separate project lifecycle and eventual cleanup requirements; and
* different analysis identity semantics locally and on GitHub.

That complexity exists because the local SonarQube Community Build deployment cannot represent concurrent mission branches naturally.

The workaround is not itself a Parallix requirement. The actual requirement is simpler:

> every candidate must have an isolated analysis and quality-gate result that corresponds to the exact code being verified.

SonarQube Cloud provides branch-aware analysis without requiring separate projects for each mission. It can therefore potentially serve both local development and GitHub verification using one project and one analysis model.

A practical comparison was performed on 2026-09-20 using the Parallix repository.

A SonarQube Cloud analysis of commit:

`c981816b9a1c2ff673ace500669ec9f2b74698ad`

successfully:

* analyzed the Parallix TypeScript source;
* consumed the repository analysis configuration;
* associated the report with the exact Git SCM revision;
* uploaded the analysis;
* waited for server-side processing;
* evaluated the quality gate; and
* returned `QUALITY GATE STATUS: PASSED`.

The scanner reported:

`Analysis total time: 1:57.614 s`

Observed Cloud analysis latency was comparable to the existing local Community Build path.

The decision therefore needs to determine whether the complexity and operational dependency of maintaining a local SonarQube deployment remains justified.

## Constraints

The analysis topology must satisfy the following:

1. concurrent missions must not overwrite or read each other's analysis;
2. a mission must be evaluated relative to its intended `main` baseline;
3. the quality gate, not scanner upload success, is the verification result;
4. local and GitHub verification should use the same analysis semantics where practical;
5. GitHub must analyze the exact ADR 0058 verification candidate;
6. Sonar-specific behaviour remains repository verification configuration rather than generic Parallix product behaviour;
7. credentials remain external to the repository;
8. verification must fail closed when analysis or quality-gate evaluation cannot complete;
9. operational complexity must be justified by measured need rather than by avoiding an external dependency in principle; and
10. the solution must remain replaceable if hosted-service latency, limits, cost or availability later become unsuitable for Parallix's concurrent-agent workload.

## Options considered

| Option                                                          | Concurrent mission isolation            | Local latency                    | GitHub fit | Operational complexity                                           | Analysis model                   | Decision                                      |
| --------------------------------------------------------------- | --------------------------------------- | -------------------------------- | ---------- | ---------------------------------------------------------------- | -------------------------------- | --------------------------------------------- |
| Shared local Community Build project                            | No                                      | Low                              | Poor       | Low                                                              | One mutable analysis             | Reject                                        |
| Community Build with one project per mission                    | Yes                                     | Low                              | Poor       | High: identity translation, cleanup, local infrastructure        | Project-per-mission workaround   | Reject                                        |
| Local Community Build for missions + SonarQube Cloud for GitHub | Yes                                     | Low                              | High       | High: two providers/configurations and divergent identity models | Split                            | Reject while Cloud latency remains comparable |
| Paid/self-hosted SonarQube with native branches                 | Yes                                     | Depends on deployment            | High       | High + paid infrastructure                                       | Native branches                  | Reject for current need                       |
| **SonarQube Cloud for local missions and GitHub**               | **Yes, through native branch analysis** | **Measured comparable to local** | **High**   | **Low**                                                          | **One project, native branches** | **Accept**                                    |

## Decision

Use **SonarQube Cloud as the canonical Sonar analysis service for Parallix development and GitHub publication verification**.

The Parallix repository is represented by one SonarQube Cloud project:

* organization: `oxtan-maker`
* project: `parallix`

Local mission worktrees and GitHub verification candidates are represented as analyses/branches within that project rather than as separate Sonar projects.

The local SonarQube Community Build deployment is no longer part of the required Parallix verification architecture once Cloud branch analysis has been proven for concurrent mission worktrees.

### Local mission analysis

A local mission scan uses the mission's actual Git branch as its Sonar branch identity.

For example:

```text
Git main                    → Sonar main
mission/task-2544           → Sonar mission/task-2544
mission/task-2545           → Sonar mission/task-2545
```

Two concurrent mission scans therefore remain isolated without inventing separate Sonar projects.

The analysis identity is the Git branch already owned by the repository. Parallix must not create another derived identity layer merely for Sonar.

Local mission verification uses two Cloud branch analyses of the same candidate.
A short-lived comparison branch measures changes against `main` under the
provider quality gate. The mission's long-lived branch supplies total-code
metrics for the repository's High and Blocker check. The gate fails closed if
either analysis fails, either branch has the wrong type, or the total-code
metrics are unavailable. It does not use the current state of `main` as a
substitute for the candidate's result.

After confirmed integration, the repository deletes both analyses. Cleanup
failures are reported without reversing the integration.

After confirmed integration, the repository deletes that mission's SonarQube
Cloud branch analysis. Cleanup failures are reported without reversing the
integration.

Parallix currently uses a progressive quality policy: HIGH and BLOCKER
impacts are blocking; MEDIUM, LOW, and INFO findings remain visible in the
provider but are non-blocking. The provider quality gate owns that new-code
severity policy (maintainability, reliability, and security severity greater
than or equal to High) together with the provider-owned coverage, duplication,
and security-hotspot conditions. The repository does not re-implement the
gate: the scanner waits for the provider's gate on the comparison analysis.
The repository waits for the long-lived analysis to finish before checking
its total-code HIGH/BLOCKER impacts.

The previous mechanisms for:

* sanitizing branch names into project keys;
* hashing branch names;
* generating one Sonar project per mission;
* inferring project keys from worktree paths; and
* deleting per-mission Sonar projects after integration

are removed rather than retained as dormant compatibility machinery.

### Main and new-code baseline

`main` is the canonical long-lived branch for the Sonar project.

Mission new-code quality is evaluated by a short-lived comparison branch
relative to `main`. SonarQube Cloud's long-lived branch new-code setting is
date or version based, so it cannot establish this comparison on its own.

The scanner checkout must therefore contain sufficient Git history and the `main` reference needed for SCM/new-code calculation.

The repository must prove this against real SonarQube Cloud behaviour. Configuration-string tests alone are not evidence that new-code calculation works correctly.

### Local integration gate

The repository's configured pre-integration quality gate remains responsible for:

1. generating the required LCOV coverage report;
2. submitting the exact mission worktree for comparison against `main` and
   waiting for the provider quality gate;
3. submitting the same candidate as a long-lived mission branch and waiting
   for its analysis and total-code check; and
4. failing integration when either check does not pass.

A successful scanner process that has only uploaded analysis is not sufficient evidence.

The Sonar quality gate remains one gate among the repository-owned verification controls. It does not replace the build, type, test, integration, lifecycle, security or real-agent checks described elsewhere.

### GitHub verification

GitHub uses the same SonarQube Cloud project.

ADR 0058's `github-publish/<sha>` workflow analyzes the exact candidate checked out by GitHub.

GitHub does not run Parallix missions and therefore requires no special mission-isolation implementation. It submits the checked-out Git ref using SonarQube Cloud's normal branch/SCM analysis.

The publication ref is not a Parallix mission and must not acquire mission
lifecycle requirements merely because both flows share the scanner: it is not
required to be a long-lived Cloud branch, it does not receive the repository's
total-code HIGH/BLOCKER check, and it does not persist as durable Sonar
mission state. Its verification is the exact-candidate checkout, the provider
new-code quality gate, and `sonar.qualitygate.wait=true` — nothing more. That
keeps the two boundaries distinct: local mission verification is the provider
gate plus the repository total-code proof against the LONG `mission/*`
candidate; GitHub publication verification is the provider gate against the
exact `github-publish/<sha>` candidate.

The GitHub workflow:

1. checks out the exact triggered commit with sufficient history;
2. runs the GitHub-safe verification tier defined by ADR 0057;
3. produces and merges LCOV from that test run;
4. performs SonarQube Cloud analysis;
5. writes the quality-gate result, including the configured coverage condition,
   to the workflow summary; and
6. fails `ci-required` if the quality gate does not pass.

ADR 0058 remains authoritative for whether that verified commit may advance remote `main`.

### One analysis policy

Local and GitHub verification use the same SonarQube Cloud project so that they do not maintain independent rule sets or quality gates.

Repository configuration owns analysis scope such as:

* `src` source scope;
* test paths and inclusions;
* generated/build exclusions;
* LCOV report location; and
* encoding.

The SonarQube Cloud project owns its configured quality profile and quality gate.

Where Parallix relies on a specific gate property — for example the new-code coverage threshold or the progressive HIGH/BLOCKER severity policy — that requirement must be documented and verified against the real configured Cloud project.

Tests that grep YAML, inspect source strings, or mock Sonar APIs may protect wiring but cannot establish that the external quality policy is actually configured.

### Credentials

`SONAR_TOKEN` is environment-owned.

For local development it is supplied by the operator environment.

For GitHub it is supplied through GitHub Actions secrets.

No Sonar access token, account credential or generated token file is committed.

The previous local administrator-password/token-generation workflow is removed if nothing outside the retired Community Build path requires it.

### Product boundary

SonarQube remains a **repository verification concern**, not a Parallix domain capability.

Generic Parallix product code must not contain:

* Sonar Cloud project identities;
* Sonar API clients;
* Sonar credential management;
* Sonar branch lifecycle;
* Sonar cleanup logic; or
* assumptions that repositories using Parallix use Sonar at all.

Parallix supplies repository-configurable verification gates. This repository chooses SonarQube Cloud through those existing seams.

If another repository uses Parallix with different quality tooling, no Parallix product changes are required.

## Trust model

A successful local Sonar gate proves that the exact mission candidate submitted from that worktree was analyzed under the configured SonarQube Cloud policy and that its quality gate passed.

A successful GitHub Sonar gate proves that the exact GitHub publication candidate was independently submitted from a GitHub-hosted checkout and passed the same Cloud quality policy.

The two checks are intentionally redundant at different trust boundaries:

```text
mission worktree
    ↓
local repository gates
    ↓
local SonarQube Cloud quality gate
    ↓
integration
    ↓
exact integration SHA
    ↓
github-publish/<sha>
    ↓
GitHub clean-runner verification
    ↓
SonarQube Cloud quality gate
    ↓
ADR 0058 ordered publication
```

The second analysis does not exist because the first is distrusted as a Sonar result. It exists because GitHub independently demonstrates that the exact publication candidate can reproduce the required checks outside the local development environment.

## Relationship to existing decisions

* ADR 0041 remains authoritative for repository-defined pre-integration gates. Sonar is one configured repository gate, not a built-in Parallix integration step.
* ADR 0048 remains authoritative for fail-closed verification. An analysis must correspond to the exact candidate and successfully complete its quality gate.
* ADR 0057 remains authoritative for what local and hosted verification prove. Using the same external scanner does not collapse those trust tiers.
* ADR 0058 remains authoritative for exact-SHA GitHub verification and publication ordering. Sonar supplies verification evidence but never publication authority.
* ADR 0053 remains authoritative for Parallix operational state. Sonar branches and analysis history are external provider state, not Mission persistence.

## Consequences

### Positive

* Local and GitHub analysis use one provider, project, quality gate and rule configuration.
* Native branch isolation replaces project-per-mission emulation.
* Per-mission Sonar project cleanup disappears.
* No local SonarQube/PostgreSQL service is required for normal Parallix development.
* No local administrator-password/token-generation flow is required.
* No branch sanitization or SHA-256 project-key scheme is required.
* Concurrent missions can be represented using their existing Git branch identities.
* GitHub uses the same analysis model rather than a second infrastructure topology.
* Analysis history is externally visible in one place while branches remain.
* The repository contains substantially less Sonar-specific infrastructure code.

### Negative

* Local mission integration now depends on network access and SonarQube Cloud availability.
* Analysis performance depends partly on an external provider.
* SonarQube Cloud service limits, throttling or product changes are outside Parallix's control.
* A hosted-service outage can block a quality-gated local integration.
* Local source is uploaded to SonarQube Cloud; this decision is appropriate for the current public Parallix repository but may not suit private/sensitive repositories.
* A Cloud credential is required for local scans.

These are accepted while measured Cloud performance and availability remain suitable for the current public repository.

## Decision evidence

A live SonarQube Cloud analysis was executed on 2026-09-20 against:

`c981816b9a1c2ff673ace500669ec9f2b74698ad`

The scanner reported:

```text
SCM revision ID 'c981816b9a1c2ff673ace500669ec9f2b74698ad'
QUALITY GATE STATUS: PASSED
Analysis total time: 1:57.614 s
```

Observed execution time was comparable with the existing local Community Build path.

This evidence justifies trying the simpler Cloud-only topology instead of preserving local infrastructure pre-emptively.

Before removal of the local fallback is considered complete, implementation must also prove:

* analysis of a real `mission/*` branch relative to `main`;
* two concurrent mission branches do not overwrite each other's results; and
* the same project can accept local mission analysis and `github-publish` verification without cross-analysis confusion.

## Reconsideration triggers

Reconsider SonarQube Cloud as the sole analysis service if measured behaviour changes materially.

In particular, revisit the local-vs-hosted decision if, across representative Parallix missions:

* Cloud analysis latency becomes consistently and materially slower than an equivalent local analysis;
* concurrent mission scans experience provider-side queueing or throttling that materially extends the mission integration cycle;
* availability failures regularly block local integration;
* service limits prevent the level of concurrent branch analysis Parallix requires;
* the OSS/free offering changes in a way that materially affects cost or capability; or
* repository confidentiality changes such that uploading source to the hosted service is no longer acceptable.

Latency should be judged from repeated measurements rather than a single slow run. A useful trigger is sustained Cloud quality-gate wall time greater than roughly **2× the measured equivalent local path** over a representative sample, or evidence that concurrent-agent scans queue sufficiently to become a meaningful part of mission cycle time.

If one of those triggers occurs, reconsider the smallest alternative that addresses the observed problem. A local Community Build deployment with project-per-mission isolation remains a known fallback, but its identity and cleanup complexity should not be retained in production code before it is needed.

## Rejected complexity from previous ADR 0060

The following mechanisms from the previous ADR are no longer architectural requirements:

* `resolveSonarProjectKey()` based on the active branch;
* `parallix-<sanitized-branch>-<sha256>` project identities;
* environment/Git/worktree fallback logic for determining Sonar project identity;
* Community Build project-per-worktree emulation;
* mission-project deletion on integration;
* GitHub-specific remote access to a local SonarQube server; and
* maintaining separate local and hosted quality-gate configuration.

They should be deleted when no longer required by the implementation rather than kept as speculative fallback infrastructure.

## References

* ADR 0041 — Integration pipeline gates
* ADR 0048 — Fail-closed harness defense against agent hallucinations
* ADR 0057 — Verification tiers and trust boundaries
* ADR 0058 — github-publish mode
* `.github/workflows/ci-required.yml`
* `sonar-project.properties`
* `scripts/sonar-local.ts`
* `infra/sonarqube/compose.yml`
