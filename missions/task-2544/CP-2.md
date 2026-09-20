# CP 2 — Choose the isolation mechanism, define the main-branch identity, record the decision

## Goal
Select the per-worktree/branch isolation mechanism, define the dedicated
`main`-branch identity, and record the durable decision in an ADR.

## Work done
Evaluated the two SonarQube isolation mechanisms against the community-edition
loopback constraint and the detached-HEAD CI checkout.

**Decision: per-branch project-key isolation** (works on every edition), not
native `sonar.branch.name` (Developer/Enterprise/Data Center only; community
local edition rejects it). Rationale recorded in ADR 0060.

**Main-branch identity:** `main` → dedicated `parallix`. Every other branch →
`parallix-<sanitized-branch>`. Two distinct branches resolve to two distinct
keys → no overwrite (SC1/SC3).

**Resolution strategy (in `resolveSonarProjectKey`, shared by submit + query):**
1. runner-supplied branch env (`PARALLIX_SONAR_BRANCH` / `GITHUB_REF_NAME`) — CI
   `pull_request` is a detached merge commit where `git` reports `HEAD`;
2. `git rev-parse --abbrev-ref HEAD` for a checked-out branch;
3. worktree path basename as last resort.

Branch sanitized to SonarQube key charset `[a-z0-9_-]`, letter-start.
`-Dsonar.newCode.referenceBranch=main` stays pinned (SC4).

**Recorded:** new ADR 0060 at `docs/adr/0060-per-worktree-sonarqube-analysis-identity.md`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Isolation mechanism decided + justified | `docs/adr/0060-per-worktree-sonarqube-analysis-identity.md` "Decision" section | PASS |
| Main branch dedicated identity defined | `docs/adr/0060-per-worktree-sonarqube-analysis-identity.md` `main` → `parallix` | PASS |
| Non-main identity formula defined | `docs/adr/0060-per-worktree-sonarqube-analysis-identity.md` `parallix-<sanitized-branch>` | PASS |
| Edition limitation rejected | `docs/adr/0060-per-worktree-sonarqube-analysis-identity.md` options table rejects `sonar.branch.name` | PASS |
| ADR file present in repo | `docs/adr/0060-per-worktree-sonarqube-analysis-identity.md` | PASS |

## Next action
Commit CP-2.md and ADR 0060, then execute CP 3: implement
`resolveSonarProjectKey` in `scripts/sonar-local.ts`, route both `runSonar` and
`assertNewIssuesFail` through it, and update the two pinned-arg tests.
