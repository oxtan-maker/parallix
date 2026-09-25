# Mission: Parallel integration gates with readable progress (task-2558)

## Goal

Run independent pre-integration gates concurrently, wait for declared producers before their consumers, and show one stable terminal view with isolated output for each configured gate.

## Why Now

Parallix integration combines CPU-bound tests, real-agent checks, and a SonarQube Cloud analysis. Serial execution wastes time, while mixed output makes parallel failures hard to diagnose. Sonar also needs coverage generated from the candidate being analyzed.

## Scope

- Use the repository's declared gate dependencies and concurrency limit to schedule pre-integration checks.
- Keep child output isolated, bounded in memory, inspectable in a terminal, and actionable on failure.
- Cancel an active gate run without leaving a TERM-resistant child or an integration repair attempt behind.
- Configure Parallix's own coverage and Sonar gates as producer and consumer; align the standalone verifier's sequence.

## Out of Scope

- Built-in Sonar, npm, or test-runner assumptions in Parallix's generic gate scheduler.
- Changes to GitHub's publication verification policy.
- Making CodeQL an automatic integration gate.

## Success Criteria

- With this repository's gate plan, six independent checks can be active after build; Sonar starts only after the coverage gate succeeds.
- A stale LCOV file is removed before coverage; a missing or empty replacement blocks Sonar.
- A terminal run displays one row per configured gate, offers isolated output through Enter, and restores the prior terminal input state when it closes.
- Cancelling a gate that ignores TERM completes after a bounded grace period and does not launch queued gates or integration repair.
- Retained output for each stream and dashboard row is bounded; serial non-interactive runs still show output while the gate is active.
- The standalone verifier uses the same coverage and Sonar commands as the merge gate plan and leaves CodeQL manual.

## Risks and Assumptions

- More concurrent checks can contend for CPU and memory; the repository controls the concurrency limit.
- The terminal view retains the recent output tail when a gate emits more than its memory limit.
- A Sonar result is evidence for the candidate only after its changes are committed.

## Checkpoints

- CP 1: Implement, verify, and record the parallel gate graph, terminal behavior, cancellation, output bounds, and Sonar coverage dependency.

## Gates

- [x] `./scripts/verify-local.sh static-analysis`
- [x] `./scripts/verify-local.sh all`
- [x] `./scripts/verify-local.sh docs`

## Restricted Areas

- Keep generic gate execution independent of this repository's Sonar and npm choices.
- Never weaken a verification gate to improve elapsed time.

## Stop Rules

- Stop before integration if a configured gate fails, the required gate plan is empty, or Sonar cannot evaluate the committed candidate.
