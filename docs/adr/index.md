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
- `docs/adr/0042-workflow-cli-color-rendering-approach.md` — Replace hand-rolled ANSI palette and buggy `useColor()` with Node.js built-in `util.styleText` for batch/headless CLI color; scoped to batch output rather than a project-wide dependency rule
- `docs/adr/0043-git-target-resolution-strategy.md` — Local-first git target resolution for workflow branch ancestry, with explicit invariants that keep rebase and integrate aligned
- `docs/adr/0044-workflow-distribution-model.md` — ESM TypeScript/TSX runtime, canonical bundle, npm CLI package, and Node SEA executable distribution; persistence and UI/application boundaries are explicitly out of scope
- `docs/adr/0045-parallax-branch-model.md` — Two integration modes (trunk-based and feature-branch), Forgejo as PR viewer only, `review` remote wiring, and branch naming conventions
- `docs/adr/0046-npm-publish-process-and-security.md` — Adopt public npm registry publication for `@magnusekdahl/parallix` alongside the local tarball path; audited bundled-dependency posture, manual publish process, and rollback considerations
- `docs/adr/0047-per-mission-change-size-budget.md` — Change the mission size-estimation basis from agent-usage % to **Net Engineering Lines (NEL)** — code+test diff, excluding docs and workflow/admin bookkeeping (the +0.65 reverse-causation confound). Draft estimate becomes a NEL bucket (0–80 / 81–235 / 235+, the empirical risk terciles); capture actual NEL at handoff to calibrate the estimate. No enforcement until the draft bucket is shown reliable.

- `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md` — Fail-closed harness defense against agent hallucinations: error classification, auto-send-back policy, and prioritized implementation plan for closing fail-open paths in the handoff/review/integrate lifecycle
- `docs/adr/0051-ui-neutral-application-boundary.md` — UI-neutral command/query boundary for CLI, Ink TUI, and web transport; Markdown/Git remains the compatibility adapter until the ADR 0053 Mission cutover
- `docs/adr/0053-operational-persistence-and-authority-boundaries.md` — One operator-local SQLite authority for checked domain concepts including Mission, Review, CheckpointData, AgentRunMeasurement, SessionMarker, LaneTransitionEvent, and AgentBlock; speculative entities such as Attempt remain excluded
- `docs/adr/0053-persistence-inventory.md` — Executable inventory of all 15 ADR 0053 durable-state concepts: production readers/writers, six-class taxonomy, architecture guard enforcement, and how future cutover tasks consume the inventory
- `docs/adr/0054-local-web-board-adapter.md` — React/Vite browser board with a Fastify loopback adapter, validated commands, SSE updates, and no browser-owned workflow authority
- `docs/adr/0055-web-board-transport-contract.md` — Versioned, JSON-safe wire DTOs between the local web host and the browser: explicit encodings for indefinite blocks, session-count and liveness states, server-owned action states, fail-closed version handling
- `docs/adr/0056-claude-stream-json-output-rendering.md` — Render the Claude CLI's `stream-json` stdout into a human-readable terminal view on the `spawnAndTee` `stdoutSink` seam, downstream of the telemetry tail; hand-rolled and dependency-free over the generalized-agent-library and `@anthropic-ai/claude-agent-sdk` options

## Cross-reference
- `docs/adr/0023-ai-sdlc-configuration.md` remains in WrGroceries at `/home/magnus/code/visualBoard-task-1302/docs/adr/0023-ai-sdlc-configuration.md`.
