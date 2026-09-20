# Mission: Isolate SonarQube analysis per worktree (task-2544)

## Goal
Give every SonarQube analysis an identity and query path that are isolated per
worktree or per branch, so a scan from one mission worktree can no longer
overwrite the issue results that another mission worktree reads, while a
separately defined main-branch quality view stays queryable.

## Why Now
`sonar-project.properties` pins `sonar.projectKey=parallix`, and
`scripts/sonar-local.ts` (`runSonar`, `assertNewIssuesFail`) hardcodes the same
`parallix` key in every query. Every mission worktree therefore submits its
analysis to one shared project. The last scan wins: a mission can read findings
that belong to another checkout and falsely treat them as its own baseline or as
completion evidence. The local no-token scanning path (TASK-2527) and the
GitHub + pre-integration mandatory quality gate (TASK-2525.03) are now in place,
so the analysis identity itself is the remaining gap.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: reliability, sonarqube, ai_sdlc

## Scope
- Derive the SonarQube analysis identity from the active git worktree/branch
  instead of the fixed `parallix` key, in `sonar-project.properties` handling and
  `scripts/sonar-local.ts`.
- Route every SonarQube query (`assertNewIssuesFail` quality-gate lookup and any
  mission verification query) through the same per-worktree/branch identity so a
  mission reads only its own analysis.
- Keep a separately defined main-branch quality view: the `main` branch (and the
  primary worktree) keeps its own dedicated analysis identity, distinct from
  feature/mission worktrees.
- Update the CI mandatory quality-gate step in `.github/workflows/ci-required.yml`
  and the pre-integration `quality-gate` gate in `workflow.config.json` /
  `config/integration-pipelines.json` so both run the isolated command and query
  the isolated identity.
- Preserve the existing local no-token, loopback-only SonarQube path
  (`npm run sonar:up`, `npm run sonar:setup`, `npm run sonar`, forgejo file-token
  resolution under `.forgejo-local/tokens/sonarqube`).
- Add a focused automated test proving two distinct worktree/branch analyses
  remain independently queryable.

## Out of Scope
- Changing the SonarQube quality-gate rule itself (the `new_violations > 0`
  requirement, including High/Critical/Blocker).
- Adding remote-server mode, a token/credential-management path, or any
  non-loopback SonarQube server.
- Altering the forgejo token resolution or the `.forgejo-local` file-token auth
  path (only the analysis identity changes, not who authenticates).
- Modifying `package.json` engines, the npm publish path, or the SEA build.
- Re-keying the legacy whole-tree coverage threshold or the `test:coverage`
  runner.
- Reimplementing a second test or scanner path; reuse the LCOV report already
  produced by `npm run test:coverage`.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and
> carries an attached metric or named artifact.

- SC1: A scan launched from mission worktree A publishes under an identity that
  differs from the identity used by mission worktree B, so the two analyses do
  not overwrite each other. Falsified if both worktrees resolve to the same
  analysis identity string.
- SC2: Mission verification queries (`assertNewIssuesFail` quality-gate lookup and
  any mission-facing quality query) resolve against the identity of the current
  worktree/branch, not a shared constant. Falsified if a query still targets the
  literal `parallix` key.
- SC3: The `main` branch retains an explicitly defined, dedicated quality view
  whose identity is distinct from every feature/mission worktree identity.
  Falsified if main shares an identity with a non-main worktree or if main has
  no defined identity.
- SC4: The local no-token path is unchanged: after `npm run sonar:up`, running
  `npm run sonar` from a clean shell still submits analysis to the loopback
  service without a pre-created token, and `runSonar` still pins the new-code
  reference branch to `main`.
- SC5: Both pipeline declarations — the CI step in
  `.github/workflows/ci-required.yml` and the pre-integration `quality-gate` gate
  in `workflow.config.json` / `config/integration-pipelines.json` — invoke the
  isolated scan command and query the isolated identity.
- SC6: A focused automated test asserts that two distinct worktree or branch
  analyses remain independently queryable (querying one returns that analysis's
  result, not the other's).
- SC7: `./scripts/verify-local.sh static-analysis` reports clean on every changed
  file and no focused or unannotated skipped tests were introduced (no `.only`,
  no bare `.skip`).

## Risks and Assumptions
- SonarQube edition capability: native branch analysis (the `sonar.branch.name`
  property) requires the Developer/Enterprise/Data Center edition and may be
  unavailable on the loopback community edition used locally. Assumption: prefer
  per-worktree/per-branch project-key isolation, which works on every edition,
  and fall back to branch-property isolation only where the server supports it.
- Main-branch identity must stay dedicated: if isolation is keyed on the branch
  name, `main` must map to its own identity, not to a generic fallback that a
  feature branch could also hit.
- The shared forgejo file token is fine to keep; only the analysis identity and
  its query path change. Do not conflate token scope with analysis scope.
- CI checkout is a detached merge commit for `pull_request` events (see
  `ci-required.yml` "Provide the primary worktree" step); the identity derivation
  must not depend on a checked-out worktree that CI does not have.
- No regression to the mandatory quality gate: `new_violations > 0` must still
  fail the gate on every new issue.

## Checkpoints
- CP 1: Map the current analysis identity and query path end to end
  (`sonar-project.properties`, `scripts/sonar-local.ts` `runSonar` /
  `assertNewIssuesFail`, `.github/workflows/ci-required.yml`,
  `workflow.config.json`, `config/integration-pipelines.json`) and record every
  place the `parallix` key is hardcoded.
- CP 2: Choose the isolation mechanism (per-worktree project key vs. branch
  property), define the main-branch identity, and record the decision in an ADR
  when it changes durable behavior.
- CP 3: Implement the per-worktree/branch analysis identity and route every
  query through it, preserving the local no-token path.
- CP 4: Update the CI step and the pre-integration gate to the isolated command,
  and update docs for any workflow or user-facing behavior change.
- CP 5: Add the focused automated test proving two distinct worktree/branch
  analyses remain independently queryable.
- CP 6: Run the verification gate and complete the Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references.
  Parallix verifies today using these forms, in priority order:
  1. **Recognized repo commands or paths** — e.g., `` `npm run sonar` ``,
     `` `./scripts/verify-local.sh all` ``, `` `./scripts/verify-local.sh static-analysis` ``,
     `` `npm run test:integration` ``, `` `git worktree list` ``,
     `` `npm run test:coverage -- --threshold 0 --lcov && npm run sonar` ``
  2. **Test names** — must match a test name in the repo, e.g.
     `"local SonarQube setup stores one shared token and scanner reuses it"`
     (from `test/task-2527-local-sonar.test.ts`)
  3. **Test file paths** — must be an existing test file, e.g.
     `test/task-2527-local-sonar.test.ts`, `test/sonarqube-reliability-repairs.test.ts`
  4. **ADR references** — must correspond to an existing file under `docs/adr/`,
     e.g. `ADR 0057`
  5. **File:line references** — accepted when needed, but line numbers eventually
     rot; prefer the forms above
- The weak-agent failure mode is explicit: raw `stat`/`ls` output or generic
  prose alone is NOT enough. Pair any shell output with at least one of the
  accepted references above (a recognized repo command, a matching test name, an
  existing test file path, or an existing ADR). A checkpoint that only pastes
  `ls`/`grep` output without an accepted reference fails.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not change the SonarQube quality-gate rule (`new_violations > 0`).
- Do not alter the forgejo file-token auth path (`.forgejo-local/tokens/sonarqube`)
  or the token resolution in `scripts/sonar-local.ts` beyond what the identity
  change requires.
- Do not add a remote-server mode, non-loopback server, or credential-management
  path.
- Do not modify `package.json` engines, the npm publish/release path, or the SEA
  build.
- Do not change the `ci-required` CI job name (it is a literal required by branch
  protection).
- Do not introduce `.only` or bare `.skip` tests.
- Do not implement during this draft phase; this document is the only artifact.

## Stop Rules
- Stop drafting once this MISSION.md is filled; do not implement any change.
- Do not run tests beyond the single `./scripts/verify-local.sh all` gate.
- Do not touch source files outside `MISSION.md` and the backlog task file.
- Do not start a review, execute, or integrate phase.
- If the isolation mechanism is blocked by a SonarQube edition limitation,
  record the fallback (per-worktree project key) in the mission rather than
  shipping a broken branch-property path.
