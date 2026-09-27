---
id: TASK-2585
title: >-
  Reuse exact github-publish proof on main instead of rerunning full hosted
  verification
status: done
assignee: [codex]
created_date: '2026-09-26 11:52'
labels:
  - ai_sdlc
dependencies: []
ordinal: 116008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stop rerunning the entire GitHub hosted verification pipeline after an already
verified `github-publish/<sha>` candidate is fast-forwarded unchanged to `main`.

The current `github-publish` path successfully verifies an exact cumulative
publication candidate before remote `main` advances. However
`.github/workflows/ci-required.yml` is also triggered by the subsequent push of
the exact same SHA to `main`.

This causes the exact same source tree to run again through:

- dependency review;
- npm installation;
- typecheck/build;
- unit tests;
- integration-ci tests;
- coverage generation/merge;
- SonarQube Cloud analysis.

Only after that second ~7 minute verification does the release job run.

This second verification provides no new source-tree evidence because:

    github-publish candidate SHA == new main SHA

Live evidence from 2026-09-26:

Previous published head:

    65bb85ec732a9531c9755a19d0fd8bc7ff9bda39

Local `main` accumulated 18 commits and produced publication candidate:

    da88ec17fc0c283117eb52a839a2a831ec11bdf7

The exact tip first ran as:

    github-publish/da88ec17fc0c283117eb52a839a2a831ec11bdf7

GitHub Actions run:

    36237257750

Result:

    ci-required PASS

Only after that proof completed did `origin/main` advance to the exact same SHA.

GitHub then unnecessarily ran the full pipeline again on `main`:

    36237603056

before releasing `@magnusekdahl/parallix@1.5.180`.

The intended model is:

    previously published head P
              |
              v
    zero or more locally integrated commits
              |
              v
        publication tip D
              |
              v
      github-publish/D
              |
              v
    full hosted verification
              |
          PASS for exact D
              |
              v
    fast-forward origin/main P -> D
              |
              v
    verify prior proof identity
              |
              v
            release

The main push must reuse the already-completed exact-SHA proof rather than
re-execute it.
<!-- SECTION:DESCRIPTION:END -->

## Publication-unit clarification

This mission also corrects ADR 0058.

The publication unit is the **exact cumulative publication tip**, not every
intermediate local integration commit.

Example:

    origin/main = P

    local history:

    P -> A -> B -> C -> D

It is valid and intentional to publish only:

    github-publish/D

and run the hosted verification once for exact SHA `D`.

A green verification of `D` proves the complete source tree containing changes
from A, B, C and D.

A, B and C do NOT independently require hosted verification.

This is an explicit throughput trade-off:

Accepted:

- the exact resulting published tree is externally verified;
- every accumulated change is contained in that tree;
- local Parallix integration gates continue protecting individual missions;
- remote `main` advances only by fast-forward from the previously published
  ancestor to the externally verified cumulative tip.

Not provided:

- an independent hosted attestation for every intermediate local commit.

Requiring one hosted run per local commit would impose unacceptable CI latency
on Parallix's high-throughput single-developer model and defeats the reason for
`github-publish`.

## Required Trust Invariant

For a main update from `P` to `D`, release authority requires proof that:

1. `D` is the exact SHA now on `main`;
2. before `main` moved, an Actions run existed for:
   
       github-publish/D

3. that run used `.github/workflows/ci-required.yml`;
4. event type was `push`;
5. run `head_sha` was exactly `D`;
6. run `head_branch` was exactly:

       github-publish/D

7. the `ci-required` job in that run completed successfully;
8. that proof completed before the current main/release workflow began;
9. the current main update is a normal descendant/fast-forward from its prior
   published state.

If that proof cannot be established, release fails closed.

## Required Changes

### 1. Do not run expensive `ci-required` verification on main

The full hosted verification job must continue to execute for:

    pull_request -> main
    push -> github-publish/**

It must NOT re-execute its expensive verification payload for:

    push -> main

Specifically a main push must not rerun:

- dependency review;
- `npm run test:ci`;
- coverage generation or merge;
- SonarQube Cloud analysis.

Do not implement this using caching or proof reuse inside individual commands.

The correct optimization is:

    do not execute the redundant verification at all.

### 2. Keep main as a workflow trigger

Do NOT simply remove `main` from the workflow trigger.

The same workflow file must still receive a main push because it owns the
trusted npm release.

npm Trusted Publishing is currently configured for the workflow filename:

    ci-required.yml

Do not move publication into another workflow file.

Do not require the operator to authorize another npm Trusted Publisher.

### 3. Add a main-only exact publication-proof check

Add a small repository-owned main-only verification step/job.

Its purpose is NOT to verify source code again.

Its purpose is to verify that the exact main SHA already received the required
pre-publication proof.

Prefer a small repository-owned script rather than complex inline YAML.

Conceptually:

    scripts/verify-github-publication-proof.ts

Inputs should come from the GitHub environment, including the repository,
current workflow run and exact candidate SHA.

The proof reader may use GitHub's API through the ephemeral workflow token.

It must be read-only.

### 4. Verify workflow-run identity, not merely a check name

Do NOT accept:

    "there is a green check named ci-required on this SHA"

as sufficient evidence.

The proof must establish that the successful check came from the expected
pre-publication execution context.

At minimum verify:

    workflow path = .github/workflows/ci-required.yml
    event         = push
    head_sha      = exact current main SHA
    head_branch   = github-publish/<exact SHA>
    conclusion    = success

Also verify the actual `ci-required` job completed successfully if the GitHub
API representation makes that distinction necessary.

Do not trust another workflow that happens to create a job with the same name.

### 5. Proof must predate publication

The main workflow must not satisfy its proof requirement from:

- itself;
- a run created because the SHA is already on main;
- a PR run;
- a historical run for another SHA.

The qualifying `github-publish/<sha>` proof must have completed before the
current main workflow execution began.

Use GitHub timestamps/run IDs/API evidence rather than assuming that a green
check necessarily predates publication.

### 6. Do not require the verification ref to still exist

`cleanup-verification-ref.yml` deletes:

    refs/heads/github-publish/<sha>

after publication.

The release proof therefore must use durable GitHub Actions/check history.

Do not make successful release depend on a race against verification-ref
cleanup.

The proof is the completed run, not the continued existence of its temporary
Git ref.

### 7. Add least-privilege GitHub API permission

If the publication-proof reader requires GitHub Actions metadata, grant only
the read permission required for that API.

Do not grant workflow-wide write access.

The release job keeps its existing narrow elevated authority:

    contents: write
    id-token: write

Do not give publication credentials to the proof job.

### 8. Release depends on publication proof, not a second CI run

Change the main release dependency from conceptually:

    main ci-required
        ->
    release

to:

    prior github-publish ci-required
        ->
    main exact-proof verification
        ->
    release

The release job must still:

- checkout exact `${{ github.sha }}`;
- validate `package.json` / lockfile version;
- reject stale/foreign npm versions;
- preserve npm Trusted Publishing;
- preserve provenance;
- create the matching tag/release.

Do not weaken `scripts/release-publish.ts`.

### 9. Preserve the existing required check contract

The `Protect main` GitHub ruleset currently requires:

    ci-required

from GitHub Actions.

The exact candidate obtains that successful check while it is
`github-publish/<sha>`.

Do not rename this required check as part of this mission.

Do not replace it with a main-only check that occurs after publication.

The key property is:

    exact SHA obtains required ci-required proof BEFORE main advances.

### 10. Preserve regular GitHub PR publication

Both original ADR integration paths must work. A main SHA with valid earlier
exact `github-publish/<sha>` proof reuses it without repeating verification.
A regular GitHub merge, squash, or rebase SHA without reusable proof must run
full hosted verification on that exact main SHA before release. PR proof alone
cannot authorize release. Lookup errors and malformed evidence fail closed.

### 11. ADR 0058 correction — verified cumulative publication tips

Update ADR 0058 in this mission.

Replace the current implication that every intermediate local mission/commit
must independently be externally verified.

The accepted publication model is:

    P = current published remote head
    D = cumulative local publication tip

    P -> ...local commits... -> D

    verify exact D externally
    re-read remote state
    confirm P remains the publication base / ancestor
    fast-forward P -> D

Intermediate local commits do not require independent hosted runs.

Rewrite affected sections consistently, including:

- Context;
- Decision;
- publication invariant;
- state model;
- fail-closed invariant;
- consequences;
- head-of-line discussion;
- examples.

Do not leave contradictory "every commit must be externally verified" language
elsewhere in the ADR.

### 12. ADR 0046 release correction

Update ADR 0046's trusted publication sequence.

It currently implies that a full `ci-required` run on the `main` push gates the
release.

Correct it to state that:

- the exact cumulative publication tip receives full verification under its
  `github-publish/<sha>` ref;
- the verified exact SHA is then fast-forwarded to `main`;
- the main-triggered release workflow verifies the durable prior proof rather
  than rerunning the expensive verification;
- package/tag/release identity remains bound to that same exact SHA.

Do not change the npm Trusted Publishing decision.

### 13. ADR 0057 consistency check

Review ADR 0057 for wording that incorrectly implies every main push must rerun
the hosted tier.

Only adjust it if needed for consistency.

Do not broaden the mission into a redesign of verification tiers.

## Red-to-Green Tests

### A. Exact prior github-publish proof passes

Given:

    current main SHA = D

and GitHub API evidence:

    workflow:    ci-required.yml
    event:       push
    head_branch: github-publish/D
    head_sha:    D
    conclusion:  success
    completed:   before current main run

the proof verifier passes.

### B. PR proof is insufficient

Given a green run for:

    pull_request
    head_sha = X

it must not authorize release of:

    main SHA = Y

Even if X/Y have similar trees.

### C. Main run cannot authorize itself

A green run with:

    head_branch = main

must not satisfy publication proof.

### D. Wrong SHA fails

A green publication run for SHA X must not authorize SHA Y.

### E. Failed/pending/cancelled publication proof fails

Only successful completed proof is release authority.

### F. Check-name spoof is insufficient

A check/job named `ci-required` from another workflow/context must not satisfy
proof.

### G. Missing/unavailable GitHub API fails closed

Provider/API failure is not equivalent to proof absence/success.

Report the error clearly.

## Live Self-Proof Requirement

TASK-2584 must prove itself through the normal publication path.

Its final locally integrated cumulative tip `D` must:

1. run full hosted verification exactly once on:

       github-publish/D

2. pass `ci-required`;
3. advance unchanged to `main`;
4. trigger the main workflow;
5. NOT rerun:
   - tests;
   - coverage;
   - dependency review;
   - Sonar;
6. verify the durable prior exact-SHA publication proof;
7. run the release job;
8. publish the new package version successfully;
9. produce tag/release at exactly `D`.

The final Goal Check must cite both workflow runs and their exact SHA.

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Full hosted source verification runs for PRs and `github-publish/*`, and on regular PR merge SHAs on main, but not again for a push of an already-verified exact publication SHA.
- [ ] #2 `main` remains a trigger of `ci-required.yml` so npm Trusted Publishing continues using the already-authorized workflow filename.
- [ ] #3 Main release is gated by successful full verification of its exact SHA or durable evidence of a successful earlier `github-publish/<exact-sha>` run from the expected workflow/event/job context.
- [ ] #4 A PR check, main check, wrong-SHA check, pending/failed run, or same-name check from an incorrect context cannot satisfy publication proof.
- [ ] #5 Publication-proof lookup remains valid after `cleanup-verification-ref` deletes the temporary Git ref.
- [ ] #6 GitHub API/provider failure fails release closed.
- [ ] #7 Release validation, npm OIDC Trusted Publishing, provenance, exact-SHA tag and GitHub Release semantics remain unchanged.
- [ ] #8 ADR 0058 is corrected to make the externally verified cumulative publication tip — not every intermediate local commit — the publication unit.
- [ ] #9 ADR 0046 describes proof reuse on main instead of a second full verification run.
- [ ] #10 The resulting TASK-2584 publication demonstrates one full hosted verification for the publication tip and no duplicate full main verification.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
