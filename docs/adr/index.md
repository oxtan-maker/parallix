# Architecture Decision Records (ADRs)

This repository carries the parallix-owned ADRs migrated out of WrGroceries.
ADR 0023 remains in WrGroceries and is cross-referenced here instead of copied.

## Index
- `docs/adr/0031-ai-agent-instruction-boundary-and-command-floor.md` — Workflow-security decision: classify authoritative instruction sources explicitly and accept a bounded autonomy tradeoff for broader Claude local scripting
- `docs/adr/0032-mission-refinement-state-and-usage-budget-signals.md` — Add `refined` as the pre-activation mission state and keep `% usage limit` selection signals in `MISSION.md`
- `docs/adr/0034-module-and-skill-invocation-model.md` — Module/skill invocation model: phase-bound baseline, explicit rule-based self-invocation, and mandatory validation-module loading
- `docs/adr/0036-mission-sizing-and-dependency-wave-heuristics.md` — Mission sizing tracks, "Too Large" thresholds, and dependency-wave heuristics
- `docs/adr/0037-ai-workflow-coordination-architecture.md` — Node.js `workflow/` package as repo-adapted coordination CLI for startup, checkpoint, and session handoff; replaces agent-followed documented procedures
- `docs/adr/0041-integration-pipeline-gates.md` — Integration-time pipeline gates + per-area gate dehallucination: add staging-deploy + e2e gates before squash-merge, driven by repo-side config; remove hallucinated stage-e2e from `gate_web`
- `docs/adr/0042-workflow-cli-color-rendering-approach.md` — Replace hand-rolled ANSI palette and buggy `useColor()` with Node.js built-in `util.styleText`; zero-dep color detection that handles NO_COLOR/FORCE_COLOR/TERM/TTY correctly
- `docs/adr/0043-git-target-resolution-strategy.md` — Local-first git target resolution for workflow branch ancestry, with explicit invariants that keep rebase and integrate aligned
- `docs/adr/0044-workflow-distribution-model.md` — parallix productization path with `px` naming, runtime/target-state boundary, and a 5-alternative decision matrix; Accepted (2026-06-22, task-1331) on the near-term local npm tarball / global `px` install stance
- `docs/adr/0045-parallax-branch-model.md` — Two integration modes (trunk-based and feature-branch), Forgejo as PR viewer only, `review` remote wiring, and branch naming conventions
- `docs/adr/0046-npm-publish-process-and-security.md` — Adopt public npm registry publication for `@magnusekdahl/parallix` alongside the local tarball path; zero-dependency security posture, manual publish process, and rollback considerations

## Cross-reference
- `docs/adr/0023-ai-sdlc-configuration.md` remains in WrGroceries at `/home/magnus/code/visualBoard-task-1302/docs/adr/0023-ai-sdlc-configuration.md`.
