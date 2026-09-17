# Mission: Bootstrap authenticated local SonarQube scanning (task-2527)

## Goal
Make `npm run sonar:setup` bootstrap one repository-local scanner token, then
make `npm run sonar` submit a scan from every linked worktree using that same
token. The one-time setup may prompt for the local SonarQube administrator
password, like the Forgejo setup flow, but must not require a manual UI setup,
copied secret, or a credential committed to the repository.

## Why Now
The pinned SonarQube Community image requires authentication for analysis, so
anonymous scanning is not a supported local workflow. The repository already
has a local-only Forgejo bootstrap pattern for credentials: a single ignored
home is found from the primary checkout and sibling worktrees. This mission
must use that model, rather than creating a token per mission worktree.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: establish an authenticated local scanner invocation, retain
  loopback-only service exposure, keep credentials out of Git, and lock the
  bootstrap contract with focused automated coverage.

## Scope
- Trace the `npm run sonar` invocation, `sonar-project.properties`, and
  `infra/sonarqube/compose.yml` to establish the supported local authentication
  flow.
- Add the smallest repository-owned `npm run sonar:setup` bootstrap to create
  or reuse a scanner token for the locally started service. Store it at
  `tokens/sonarqube` under the home resolved by `resolveForgejoHome()`, with
  owner-only permissions. It must honor the existing `FORGEJO_HOME` override
  and sibling-worktree discovery; do not add a per-worktree `.sonar-local`
  fallback.
- Add focused automated coverage under `test/` for the bootstrap and scanner
  invocation contract, without starting Docker or contacting a real SonarQube
  service from a unit test.
- Preserve the project key, source/test inputs, coverage report path, quality-gate wait behavior, and loopback host URL currently supplied by `sonar-project.properties`.

## Out of Scope
- Remote-server mode, CI credentials, a repository-committed token/password,
  or a user-supplied `.env` credential.
- Changing GitHub Actions, Parallix pre-integration, remote SonarQube credentials, or the parent task's future enforcement work.
- Exposing SonarQube on a non-loopback interface, changing the Compose service image or database topology, or resetting existing local Docker volumes.
- Repairing findings, changing quality-gate thresholds, or altering the analyzed source/test/coverage scope.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- With the Compose service started by `npm run sonar:up`, `npm run sonar:setup`
  creates or reuses the local scanner token, and a later `npm run sonar` from
  an environment with `SONAR_TOKEN`, `SONAR_LOGIN`, `SONAR_PASSWORD`, and
  `SONAR_SCANNER_OPTS` unset submits the `parallix` analysis to
  `http://127.0.0.1:9000` without an interactive credential prompt.
- The bootstrap stores its generated token only in ignored local state with
  owner-only permissions at the shared Forgejo-resolved home. A scan started
  from a sibling worktree resolves and reuses the same token; no token,
  password, or remote host URL is added to tracked configuration.
- `sonar-project.properties` continues to set `sonar.host.url=http://127.0.0.1:9000`, and `infra/sonarqube/compose.yml` continues to publish SonarQube only as `127.0.0.1:9000:9000`.
- Focused tests prove the bootstrap command passes the locally stored token to
  the scanner, discovers the shared token from a sibling worktree, never
  writes it to tracked files, and retains the loopback endpoint without
  accessing Docker or a real SonarQube service.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` exit zero on the final tree.

## Risks and Assumptions
- Assumption: the pinned local SonarQube Community image permits its default
  local administrator to mint a scanner token through its supported API.
- Risk: a bootstrap credential must be scoped to the loopback-only local
  service and must never be committed or reused by CI. It must remain
  discoverable from all linked worktrees, including mission worktrees.
- Risk: a configuration change could accidentally affect a later authenticated
  CI path; keep this mission confined to the explicitly local `npm run sonar`
  workflow.
- Risk: a unit test that launches Docker or a real scanner would violate the repository's unit-test boundary; test the command/configuration contract and perform the clean-shell submission as an operational verification.

## Checkpoints
- CP 1: Trace the local scanner authentication inputs and the minimal supported
  SonarQube API sequence for minting a local scanner token. Choose the existing
  `resolveForgejoHome()` / `tokens/` convention rather than introducing a new
  credential location. Add a focused unit test for the bootstrap/scanner
  contract and sibling-worktree token resolution.
- CP 2: Implement the smallest local-only bootstrap. Run `npm run sonar:setup`
  against the local service, then from a clean shell with
  `SONAR_TOKEN`, `SONAR_LOGIN`, `SONAR_PASSWORD`, and `SONAR_SCANNER_OPTS`
  unset, start the local service with `npm run sonar:up` and demonstrate that
  `npm run sonar` reuses the local token and submits the `parallix` analysis
  without an interactive prompt.
- CP 3: Confirm the generated credential is owner-readable only at the shared
  `resolveForgejoHome()` location, is discoverable from a sibling worktree,
  and does not appear in tracked configuration. Confirm no remote-server
  setting, source/test scope change, or non-loopback port exposure was
  introduced. Run the declared verification commands and record durable
  evidence for every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Durable evidence first: exact test names, test file paths, and recognized
  repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px
  ...`, or `./...`. Cite the bootstrap test, `package.json`,
  `sonar-project.properties`, `infra/sonarqube/compose.yml`, `npm run sonar:up`,
  `npm run sonar`, `./scripts/verify-local.sh static-analysis`, and
  `./scripts/verify-local.sh all` where applicable.
- A concise summary of the work completed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |`, with one row for every success criterion.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted exact test name, ADR reference, test path, or recognized repository command/path above.
- A non-generic `Next action:` line at the bottom; CP 1 must name the traced authentication source and test result, CP 2 must state the clean-shell submission result, and CP 3 must name the final verifier results.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Local scanner bootstraps one shared local token | bootstrap test, `npm run sonar:setup` | PASS |
| Clean-shell local submission completed | `npm run sonar:up`, `npm run sonar` | PASS |
| Final verifier completed | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not commit or require a user-supplied SonarQube token, password, copied
  secret, remote URL, remote-server mode, or CI credential workflow. The only
  permitted generated credential is `tokens/sonarqube` in the shared,
  Forgejo-resolved ignored home, with owner-only permissions.
- Do not modify GitHub Actions, Parallix pre-integration, quality-gate policy, quality thresholds, source/test/coverage inclusions, or unrelated package scripts.
- Do not change `infra/sonarqube/compose.yml` so that SonarQube binds anywhere other than `127.0.0.1:9000`.
- Do not make focused unit coverage access Docker, a network service, or real SonarQube.

## Stop Rules
- Stop and request direction if the pinned local SonarQube Community image
  cannot mint or accept a local bootstrap token through a supported local-only
  flow.
- Stop and request direction if a linked worktree cannot resolve and reuse the
  shared token through `resolveForgejoHome()`; do not replace this with
  per-worktree credential storage.
- Stop and request direction if the smallest correction changes a remote, GitHub Actions, or pre-integration scanning path rather than only the local `npm run sonar:setup` / `npm run sonar` workflow.
- Stop and request direction if satisfying the workflow requires exposing port 9000 beyond loopback, changing analyzed source/test/coverage scope, or resetting developer Docker volumes.
- Stop if the focused test cannot assert the local configuration contract without launching Docker or contacting SonarQube; report the boundary and proposed test seam instead of weakening the unit-test policy.
