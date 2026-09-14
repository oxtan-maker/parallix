---
id: TASK-2502
title: Add local CodeQL SAST gate and reach zero findings
status: done
assignee: [custom]
created_date: '2026-09-12 13:37'
labels: [ai_sdlc]
dependencies: []
ordinal: 71006
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Objective

Add GitHub CodeQL as a first-class local SAST check for Parallix and make it part of the repository's integration verification.

Run CodeQL against the existing codebase, investigate every finding, fix the underlying defects where appropriate, and leave the repository with a green CodeQL security scan and all existing verification passing.

This mission is complete only when CodeQL is an executable repository-owned integration gate — not merely documented or manually runnable.

## Context

Parallix positions itself as a trust layer around AI-generated software changes. Its own integration path therefore needs independent static security analysis in addition to tests, linting, type checking, review, and runtime verification.

The repository currently routes integration verification through:

* `scripts/verify-local.sh integrate`
* `config/integration-pipelines.json`

The integration pipeline already contains unconditional and area-specific gates. CodeQL should become an unconditional security gate because security-relevant data flows can cross architectural areas and should not depend on Parallix's changed-area classification.

Parallix is primarily TypeScript/JavaScript, so use CodeQL's `javascript-typescript` analysis.

## Requirements

### 1. Provide a reproducible local CodeQL runner

Add a repository-owned command for running CodeQL locally.

Prefer an interface such as:

```bash
npm run test:codeql
```

backed by a script such as:

```text
scripts/codeql-sast.sh
```

The implementation must:

* run from the repository root;
* analyze the current checkout/worktree, respecting `PARALLIX_EXECUTION_ROOT` where appropriate;
* use the official CodeQL CLI;
* use a pinned or otherwise deterministic CodeQL version rather than silently depending on whatever happens to be installed;
* never commit the CodeQL distribution or generated CodeQL database to Git;
* cache/download tooling outside tracked source where sensible;
* fail loudly if CodeQL cannot be obtained or executed;
* return non-zero if qualifying CodeQL findings exist;
* clean up or isolate generated databases/results so concurrent Parallix worktrees cannot corrupt each other's analysis.

A preinstalled `codeql` binary may be used when it satisfies the required version, but running the repository gate must not depend on undocumented machine-specific setup.

### 2. Use an appropriately strong query suite

Run CodeQL for JavaScript/TypeScript using GitHub's maintained security queries.

Use at least the standard security/code-scanning suite.

Prefer `security-extended` if it can be made sufficiently deterministic for a blocking Parallix integration gate without introducing unacceptable false positives.

Do not create a deliberately weak query configuration simply to obtain a green result.

Record the chosen suite explicitly so future runs use the same policy.

### 3. Integrate CodeQL into Parallix's integration gate

Add a CodeQL SAST gate to:

```text
config/integration-pipelines.json
```

It must be unconditional, equivalent to:

```json
"always": true
```

so that:

```bash
./scripts/verify-local.sh integrate
```

cannot succeed without CodeQL succeeding.

Place it sensibly in the pipeline: after the cheap static checks/build prerequisites but before expensive end-to-end/real-agent checks.

The resulting pipeline should conceptually be:

```text
existing static analysis
        ↓
build/tests as currently configured
        ↓
CodeQL SAST
        ↓
expensive lifecycle/E2E gates
        ↓
integration allowed
```

Preserve the existing integration-gate semantics and changed-area behavior.

### 4. Baseline the existing repository

Run CodeQL against the current Parallix codebase before attempting to declare the work complete.

Capture and inspect all findings.

For every finding classify it as one of:

1. genuine vulnerability/security defect;
2. unsafe implementation even if currently difficult to exploit;
3. false positive;
4. intentionally accepted security behavior.

Do not simply suppress findings because they are inconvenient.

### 5. Fix all actionable findings

Fix every genuine or actionable issue found by CodeQL.

Where possible, add a regression test demonstrating the dangerous behavior or security boundary being corrected.

Pay particular attention to Parallix's high-risk boundaries, including:

* `child_process` execution;
* shell command construction;
* agent-controlled or repository-controlled strings reaching process execution;
* filesystem paths derived from external/repository/agent input;
* path traversal;
* command injection;
* unsafe temporary-file handling;
* archive/file extraction;
* HTTP/server input;
* configuration parsing;
* Git command invocation;
* environment-variable propagation;
* dynamic module/code execution;
* unsafe URL handling;
* trust-boundary crossings around Bubblewrap/confinement;
* any flow where mission/repository content can affect privileged local operations.

Do not change intended behavior merely to satisfy the scanner without understanding the underlying data flow.

### 6. Handle false positives transparently

If CodeQL produces a genuine false positive that cannot reasonably be eliminated structurally:

* verify why the flow is safe;
* prefer restructuring/code changes that make the safety visible to both humans and static analysis;
* use suppression only as a last resort;
* keep suppressions as
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
