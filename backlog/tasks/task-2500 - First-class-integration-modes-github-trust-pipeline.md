---
id: TASK-2500
title: 'Wave: First-class integration modes and GitHub trust pipeline'
status: backlog
assignee:
  - custom
created_date: '2026-09-12'
labels:
  - integration
  - github
  - trust-model
  - workflow
dependencies: []
references:
  - config/workflow.config.json
  - config/state-map.json
  - src/adapters/cli/commands/integrate.ts
priority: high
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wave: make Parallix support three explicit development/integration modes without weakening its trust model, and dogfood the GitHub trust path.

MODES (share the same mission/review/gate concepts; transport + final-merge authority vary):
- `local` — GitHub-unaware/local-first. Parallix owns integration into the configured primary branch. Default; preserves current behaviour.
- `github-publish` — fast single-developer. Parallix integrates locally; GitHub independently verifies the exact resulting commit; verified commits publish to protected `origin/main` in order.
- `github-pr` — collaborative. Parallix completes + reviews a mission branch, pushes it, GitHub/PR owns final integration. Parallix must NOT locally merge into remote primary.

DOGFOOD (make Parallix itself use the GitHub trust path):
- define a deterministic GitHub-safe CI test tier;
- create a GitHub Actions required-check pipeline;
- enable appropriate protection on Parallix `main`.

CONSTRAINTS that hold across every mission:
- `local` stays first-class: no GitHub config/credentials/network required.
- review approved ≠ integrated into primary. Authority for review and for final merge are separate.
- external evidence is OBSERVED from GitHub, not self-asserted via a local boolean.
- exact-SHA semantics differ by mode: `github-publish` pins the same SHA; `github-pr` permits a different GitHub merge/squash/rebase SHA and verifies the resulting relationship/tree.
- GitHub latency must not become agent-development latency (esp. `github-publish`: verification gates publication, not the next local mission).
- fail closed at authority boundaries: unexpected remote movement, stale verification, mismatched commits, ambiguous PR results, missing external evidence never silently complete/ publish a mission.

DEPENDENCY / EXECUTION ORDER:
```text
                    Mission 1
              TASK-2500.01
                  /         \
                 /           \
    Mission 2             Mission 3
    github-publish        github-pr
    TASK-2500.02          TASK-2500.03
             |                          |
             |                          |
             |          Mission 4       |
             |          CI taxonomy     |
             |          TASK-2500.04    |
             |                          |
             |          Mission 5       |
             |          GitHub Actions  |
             |          TASK-2500.05    |
             |                          |
              \           /
               \         /
              Mission 6
              dogfood
              TASK-2500.06
```
Mission 4 starts immediately in parallel with Mission 1. Mission 5 follows Mission 4. Missions 2 and 3 share the Mission 1 abstraction. Mission 6 proves the architecture under high mission throughput.
<!-- SECTION:DESCRIPTION:END -->

## Wave Subtasks

### Mission 1 — Model repository integration mode as a first-class configuration (base: TASK-2500.01)
Depends on: none. Default must preserve current behaviour.

- **TASK-2500.01** Audit current `integrate.ts` dispatch and the repository-config conventions (`config/workflow.config.json`, `config/state-map.json`, schema). Map every place that currently assumes `px integrate` owns the final merge. Output: short inventory; no code change yet.
- **TASK-2500.02** Add explicit integration-mode config: `{ "integration": { "mode": "local" | "github-publish" | "github-pr" } }` following existing repo-config conventions. Unknown/invalid mode fails closed with an actionable configuration error. No mode ⇒ `local`.
- **TASK-2500.03** Define a strategy/capability boundary exposing the operations `prepare integration`, `run required local gates`, `produce integration candidate`, `submit for external verification`, `publish`, `observe external integration`, `close mission`. Not every mode implements every operation.
- **TASK-2500.04** Route integration-mode dispatch behind the abstraction (Mission 1.03) instead of scattered `if (mode === ...)` in `integrate.ts`.
- **TASK-2500.05** Domain/application layer expresses integration state and required evidence without depending directly on GitHub APIs.
- **TASK-2500.06** `local` remains behaviourally identical to current workflow (same gates, same merge authority).
- **TASK-2500.07** CLI/status surfaces show the active integration mode where relevant.
- **TASK-2500.08** Tests: existing local integration tests pass unchanged (or only intentional fixture/config updates); all three modes parse + validate; unsupported modes fail closed; `local` retains current semantics.
- **TASK-2500.09** Docs explain the three modes and intended use cases.

### Mission 2 — Implement fast single-developer GitHub publication mode (base: TASK-2500.10)
Depends on: Mission 1.

- **TASK-2500.10** Durable representation of at least: locally integrated, external verification pending, externally verified, published, external verification failed. Internal state/evidence is acceptable; do not necessarily add board lanes.
- **TASK-2500.11** Submit each exact locally-generated integration commit to GitHub for independent verification WITHOUT modifying its SHA (verification ref mechanism). Continue integrating later missions while earlier ones are checked.
- **TASK-2500.12** Publication invariant: remote `main` advances only through the highest contiguous sequence of externally verified local integration commits. No skipping a failed commit. No force-push of protected `main`. Fail closed if `origin/main` is no longer the expected ancestor.
- **TASK-2500.13** Recovery: verification failure; GitHub unavailable; verification ref already exists; local main ahead by multiple missions; remote main unexpectedly moved; verification completed out of order; retry after transient GitHub failure.
- **TASK-2500.14** Operator status: local integration head, published head, missions awaiting verification, missions verified but blocked behind an earlier mission, failed verification.
- **TASK-2500.15** Tests: `P->A->B->C` local while `origin/main->A` without rewriting B/C; out-of-order CI completion does not produce out-of-order publication; failed A blocks B/C even if green; fetch of updated `origin/main` does not rewrite/diverge local history for already-published commits; unexpected remote movement fails closed.
- **TASK-2500.16** Docs/notes for `github-publish` flow and invariants.

### Mission 3 — Implement standard collaborative GitHub PR integration mode (base: TASK-2500.17)
Depends on: Mission 1. Can run largely in parallel with Mission 2.

- **TASK-2500.17** In `github-pr` mode, `px integrate` must NOT treat a local update of repository `main` as mission completion.
- **TASK-2500.18** Distinguish lifecycle stages: Parallix mission work complete → review approved → local gates passed → PR submitted/updated → GitHub checks pending → GitHub integration observed → mission complete. Make clear which boundary Parallix owns vs GitHub owns.
- **TASK-2500.19** Support a configured integration target/base branch (e.g. `main -> feature/payment-rewrite -> mission/task-1234`); completing the mission integrates into the feature branch, not necessarily `main`.
- **TASK-2500.20** Observe GitHub merge state (not infer from local branch); closing a GitHub-integrated mission requires fresh external evidence the expected PR/commit merged. Do NOT assume the GitHub merge SHA equals the mission head; verify resulting relationship/tree/integration evidence.
- **TASK-2500.21** Recovery: PR closed without merge; branch updated after Parallix review; PR merged with unexpected resulting tree; PR rebased/squashed by repo policy; GitHub unavailable; target/base branch changed.
- **TASK-2500.22** Tests: (1) mission directly targeting GitHub `main`; (2) mission targeting a developer feature branch; (3) PR pending after Parallix review; (4) successful externally owned merge; (5) PR closed without merge; (6) GitHub-created squash/rebase result; (7) target branch changes; (8) no premature mission closure before external integration evidence.

### Mission 4 — Define and enforce a GitHub-safe CI verification tier (base: TASK-2500.23)
Depends on: none. Start immediately in parallel with Mission 1.

- **TASK-2500.23** Define explicit test categories (unit, integration-ci, integration-local, agent-e2e). Positive membership ("these tests ARE CI-safe") over negative filtering. A new boundary test must not silently enter the CI tier.
- **TASK-2500.24** Audit the current suite and classify every test family into a documented category.
- **TASK-2500.25** Add stable commands: `npm run test:ci`, `npm run test:integration:ci`, `npm run test:integration:local`, `npm run test:agent-e2e` (naming may vary).
- **TASK-2500.26** GitHub-safe tier covers (where practical): build, typecheck, hermetic unit tests, deterministic clean-checkout integration tests, package/bundle validity. No local AI, no operator model config, no Forgejo credentials/state, no workstation state, no worktree assumptions, no private local services.
- **TASK-2500.27** Measure CI-safe-suite runtime; tune obvious pathological cases without weakening meaningful coverage. Record the runtime.
- **TASK-2500.28** Deliverable doc: what GitHub CI proves / what local Parallix verification proves / what only real-agent/local-AI proves (part of the trust model).

### Mission 5 — Add GitHub Actions required verification pipeline (base: TASK-2500.29)
Depends on: Mission 4. Can proceed before Missions 2/3 fully complete.

- **TASK-2500.29** Workflow triggered for refs/events needed by both modes: verify an exact integration commit pushed to a verification ref (`github-publish`) and PRs targeting protected branches (`github-pr`).
- **TASK-2500.30** Node version satisfies declared engine requirement; clean checkout; deterministic dependency install; caching only where it does not weaken reproducibility.
- **TASK-2500.31** Stable required-check name (e.g. `ci-required`); do NOT change it dynamically (branch protection depends on it). Minimal permissions. Concurrency cancellation for superseded PR commits only; do NOT cancel immutable publication candidates still needed by `github-publish`.
- **TASK-2500.32** Acceptance: PRs receive the required check; publication verification refs receive the same (or explicitly equivalent) check; clean runner needs no local AI; a failing test fails the check; name is stable and protection-suitable; permissions minimal; CI runtime measured.

### Mission 6 — Dogfood protected GitHub main on Parallix (base: TASK-2500.33)
Depends on: Missions 2, 4, 5. Recommended after Mission 3 stable enough not to paint the model into a corner.

- **TASK-2500.33** Configure the Parallix repo to use `github-publish` for its own development; `origin/main` becomes the externally verified publication boundary; local main stays the high-speed trunk.
- **TASK-2500.34** Before enabling protection, prove: (1) required GitHub check works; (2) a locally created integration commit can be independently verified; (3) the exact verified SHA can advance protected `main`; (4) local main can stay multiple commits ahead; (5) publication catches up without local-history rewriting; (6) failed verification blocks publication but not continued local development.
- **TASK-2500.35** Enable branch protection: required status check `ci-required`, prevent force pushes, prevent deletion; evaluate linear-history where compatible. Do NOT require PR-before-merge, second human approval, or up-to-date (Parallix ordered-publication rule is the stronger invariant for this mode).
- **TASK-2500.36** Demonstrate the publication sequence: `P->A->B->C` local with independent verification; `A✅ B pending C✅` ⇒ `origin/main = A` until B green; then B and C publish without recreating any commit; a failed candidate leaves remote main at the last contiguous verified commit; `git fetch`/remote-tracking updates do not diverge or require rebasing already-integrated descendants.
- **TASK-2500.37** Record resulting repository settings and rationale for each protection rule.

## Wave Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All three modes (`local`, `github-publish`, `github-pr`) parse and validate through repository configuration; unknown/invalid fail closed with an actionable error.
- [ ] #2 No-mode repo behaves as `local`; `local` retains current integration semantics (existing local integration tests pass unchanged or only intentional fixture/config updates).
- [ ] #3 Integration-mode dispatch sits behind an explicit strategy/capability abstraction, not scattered `if (mode === ...)` branches.
- [ ] #4 Domain/application layer expresses integration state and evidence without depending directly on GitHub APIs.
- [ ] #5 `github-publish` publication invariant holds: remote `main` advances only through the highest contiguous sequence of externally verified local commits; no force-push; fail closed on unexpected `origin/main` movement; exact SHA preserved; out-of-order CI does not produce out-of-order publication; failed candidate blocks later publication.
- [ ] #6 `github-pr` never treats a local `main` update as completion; requires fresh external merge evidence to close; supports configured target/base branch; tolerates GitHub squash/rebase with a different SHA; recovers from the listed failure modes.
- [ ] #7 GitHub-safe CI tier is a first-class, positively-defined category; every test family is classified; stable `test:ci`/`integration:ci`/`integration:local`/`agent-e2e` commands exist; CI-safe suite runs on a clean machine with no local AI.
- [ ] #8 GitHub Actions required-check pipeline exists with a stable `ci-required` name, minimal permissions, correct triggers for both modes, and measured runtime.
- [ ] #9 Parallix dogfoods `github-publish`: protected `main` advanced by exactly-verified commits without rewriting local history; protection settings and rationale recorded.
- [ ] #10 Architectural invariants 1–7 (local first-class; review vs merge authority separate; external evidence observed; exact-SHA differs by mode; GitHub latency not development latency; trust-tiered tests; fail closed at authority boundaries) hold across all missions.
- [ ] #11 Docs updated: three modes + use cases; what each verifier proves.
<!-- AC:END -->
