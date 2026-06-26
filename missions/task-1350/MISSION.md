# Mission: Enforce good README.md standard (task-1350)

Base-Branch: skunkworks

## Goal

Create a reusable documentation standard for this repository (capturing the lessons from the task-1336 README rewrite benchmark), wire it into the agent workflow so that future README and documentation updates follow the standard automatically, and update the repo-level README.md to be accurate with current product state as of this release.

## Why Now

The previous README rewrite (task-1336) produced a well-structured README backed by a detailed benchmark (`docs/readme-rewrite-benchmark.md`), but there is no enforcement mechanism — no hook in AGENTS.md or elsewhere — that makes agents consult the standard before editing README.md or similar documentation. Without a hook, the benchmark's lessons are discoverable but not actionable, and future documentation edits risk drifting from the established quality bar. The current AGENTS.md contains only graphify guidance with zero documentation standards.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: benchmark exists but is unused by agents; AGENTS.md has no documentation enforcement; README.md may have drifted from current product state

## Scope

- Create a documentation standard document (e.g., `docs/doc-standards.md` or `docs/seo-content-standards.md`) that codifies the structural and tonal rules from `docs/readme-rewrite-benchmark.md`, including: one-line capability headline with zero internal jargon, problem-first or contrast-first opening, shallow quickstart (2-3 commands to first result), early caveats as trust signals, no superlatives without adoption data, what-the-tool-is-not section, and structure ordering (positioning → Why → What → Workflow → Quick start → Example → Use cases → What it is not → Current status → Documentation → Development → License).
- Add a documentation-enforcement hook to `AGENTS.md` that instructs agents to consult the documentation standard before editing any `.md` files in the repo root or `docs/` directory, with explicit references to the standard file and a checklist of rules to verify before committing documentation changes.
- Update `README.md` to accurately reflect the current product state: verify all claims against `docs/use-cases.md`, confirm the quickstart commands work end-to-end, ensure the "What Parallix is not" section and "Current status" alpha caveats are current, and verify that all linked documentation files still exist and are accurate.
- Update `examples/README.md` and `lib/README.md` to conform to the new standard where applicable (consistent heading hierarchy, clear capability statements, no internal jargon).

## Out of Scope

- Building a CI check or linter for documentation quality (that is a future automation task).
- Editing documentation files outside `.md` (e.g., JSDoc, inline code comments).
- Creating templates for other documentation types beyond README.md and subdirectory READMEs (CONTRIBUTING.md, CHANGELOG.md format rules are covered by existing conventions).
- Rewrite of `docs/use-cases.md`, `docs/authority-reference.md`, or other deep documentation — only surface-level accuracy checks and link validation.
- Screenshot or demo video additions to any documentation.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. A documentation standard file exists at `docs/doc-standards.md` (or equivalent path under `docs/`) and contains at least 8 distinct, rule-level guidelines covering: headline/tagline structure, opening paragraph requirements, quickstart depth, caveat placement, superlative prohibition, "what it is not" section, structural ordering, and tone/voice guidance.
2. `AGENTS.md` contains a new section (after the existing graphify section) titled "Documentation" or "README & documentation standards" that explicitly instructs agents to consult the documentation standard file before editing any markdown documentation, and references the standard file path.
3. The repo-level `README.md` section "Current status" accurately reflects: distribution method (npm publish + local tarball), review surface (Forgejo as optional publication surface), versioning discipline (CHANGELOG.md authority, PATCH bumps), telemetry status (codex/claude structured, local-custom/mistral zeros), and Graphify support (optional, not prerequisite). Each of these five claims can be verified against `workflow.config.json` and `package.json`.
4. All relative links in `README.md` resolve to existing files: `docs/use-cases.md`, `docs/authority-reference.md`, `docs/forgejo-setup.md`, `docs/operator-setup.md`, `docs/readme-rewrite-benchmark.md`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `docs/adr/`.
5. `examples/README.md` begins with a one-line capability statement (no internal jargon) and uses consistent heading hierarchy (H1 → H2 → H3).
6. `lib/README.md` begins with a one-line capability statement and uses consistent heading hierarchy.

## Risks and Assumptions

- The benchmark document (`docs/readme-rewrite-benchmark.md`) is the primary source for the documentation standard rules; if it omits a rule the team considers important, the standard will be less comprehensive than desired.
- Updating README.md to "accurate current state" may reveal claims in the README that are no longer true — this is a risk of discovery, not failure. The mission scope includes fixing inaccurate claims, not debating them.
- Assumption: the agent can edit AGENTS.md without breaking the graphify workflow instructions that already exist there.
- Assumption: the documentation standard, once written, can be expressed as actionable agent instructions in AGENTS.md without becoming overly verbose (>2000 characters).

## Checkpoints

- CP 1: Documentation standard drafted and reviewed against the benchmark document (creates `docs/doc-standards.md`).
- CP 2: AGENTS.md updated with documentation enforcement hook referencing the standard.
- CP 3: README.md audited for accuracy against current code, `workflow.config.json`, `package.json`, and `docs/use-cases.md`; all inaccuracies corrected.
- CP 4: Subdirectory READMEs (`examples/README.md`, `lib/README.md`) updated to conform to the standard.

## Gates

- [ ] `./scripts/verify-local.sh docs`
- [ ] `npm test` passes with exit code 0

## Restricted Areas

- Do not modify `docs/use-cases.md` beyond fixing broken links or obvious factual errors (no rewrites, no restructuring).
- Do not modify `docs/adr/` files.
- Do not modify any `.js` source files — this is a documentation-only mission.
- Do not modify `workflow.config.json` or `package.json`.
- Do not modify `.gitignore`, `scripts/verify-local.sh`, or any other configuration/build files.

## Stop Rules

- Stop if the documentation standard exceeds 10,000 characters — it should be a concise reference, not an essay.
- Stop if AGENTS.md exceeds 4000 characters total — the new documentation section must fit within a reasonable agent context budget.
- Stop if fixing README.md accuracy requires rewriting more than 50% of the file — that indicates a deeper rewrite mission is needed, not this one.
- Stop if `npm test` fails and the failure is unrelated to documentation changes — investigate and fix the root cause, but if the test suite itself is broken, stop and report.
