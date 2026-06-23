# Mission: Rewrite README.md as a credible GitHub landing page (task-1336)

## Goal

Rewrite `README.md` from an internal authority reference into a credible GitHub landing page that helps a skeptical engineering manager, senior engineer, or AI-workflow operator understand what Parallix is, who it is for, what concrete problems it solves, why it differs from using a single coding agent directly, and how to try it — all within the first 300 words. Move internal operational content (authority stack, state-map, adapter internals, mode tables) into `docs/` rather than deleting it.

## Why Now

The current README (`parallix/README.md`, 309 lines) is titled "parallix Authority Reference" and reads as an operator manual covering workflow modes, authority layers, config boundaries, and command aliases. A visitor to the GitHub repo cannot answer "what does this tool do?" without wading through internal abstractions. Meanwhile, the `docs/use-cases.md` inventory has matured through multiple missions with evidence-backed use cases, measured throughput figures, and red-team analysis — providing the factual foundation needed for credible public positioning. The gap between internal documentation quality and public-facing presence is now wide enough to warrant a dedicated rewrite effort.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: current README is unusable as a landing page; use-cases evidence inventory is complete and ready to draw from; competitor READMEs (Aider, Goose, OpenCode) establish a benchmark for what engineers expect on first glance

## Scope

- Research and document successful competitor README patterns in `docs/readme-rewrite-benchmark.md`
- Rewrite `README.md` using the specified landing-page structure (positioning statement, Why Parallix?, What it does, core workflow, quick start, example, use cases, what it is not, current status, documentation links, development, license)
- Extract internal authority content from the current README into an appropriate `docs/`
- Optimize for discoverability with natural developer search terms (AI coding workflow, multi-agent coding, git worktree, agent usage limits, mission-based development, CLI)
- Maintain skeptical, non-hype tone consistent with engineering-manager credibility

## Out of Scope

- Publishing to npm registry, Homebrew, Docker, or any public distribution channel
- Building a website, landing-page host, or marketing microsite
- Adding screenshots, animated demos, or video content
- Rewriting docs/use-cases.md, ADRs, or other documentation files
- Changing the parallix runtime code or workflow behavior
- Adding or removing agent families, config schemas, or workflow modes
- Creating a separate marketing copy or press materials

## Success Criteria

> **Falsifiability rule (ADR 039 Part 2):** Each criterion must be falsifiable. No subjective adjectives without attached metrics.

1. readme-rewrite-benchmark.md exists and documents at least 6 competitor READMEs (Aider, Goose, OpenCode, Get Shit Done, plus at least one more) with opening headline pattern, first-paragraph structure, quickstart depth, credibility/caveat handling, and specific borrow-vs-avoid decisions for each.
2. The rewritten `README.md` top section (first 300 words) answers all five questions: what is Parallix, who is it for, what pain does it solve, why not use Claude Code/Aider/OpenCode directly, and what is the first concrete thing to do.
3. The README contains all nine required sections in order: "Why Parallix?", "What it does", "The core workflow", "Quick start", "Example", "Use cases", "What Parallix is not", "Current status", "Documentation".
4. "What it does" contains 5-7 bullets, each tied to a real use case from `docs/use-cases.md` (UC-1 through UC-6), with confidence levels (Confirmed/Partial) carried through.
5. The README avoids starting with internal abstractions: no mention of "authority stack", "state-map", "adapter internals", "mode tables", "config boundary", "canonical markdown companion", or "conflict resolution" in the first 500 words.
6. The README contains at least 6 of the 9 specified SEO phrases: "AI coding workflow", "AI coding agents", "multi-agent coding", "git worktree", "coding agent review", "agent usage limits", "local-first developer workflow", "mission-based development", "CLI".
7. The "What Parallix is not" section explicitly addresses: not a model, not an IDE, not a magic autonomous engineer
8. The "Current status" section states alpha/local-first status and public-distribution caveats (npm pack only, no registry publish).
9. The internal authority content from the old README (authority stack table, mode table, command aliases, validation model details) is preserved in `docs/authority-reference.md` or a similarly named `docs/` file.
10. `npm test` passes after the rewrite (no test files are modified; the README rewrite must not break any existing tests).

## Risks and Assumptions

- **Assumption:** The specified README structure is sufficiently aligned with competitor patterns. Benchmark research may reveal a better structure, in which case the rewrite adapts.
- **Risk:** Balancing SEO optimization with senior-engineer credibility is difficult. Over-optimization reads as marketing; under-optimization reduces discoverability. Mitigation: prioritize natural phrasing, place key terms in title and first paragraph, defer SEO concerns after credibility is established.
- **Risk:** Compressing the current 309-line authority reference into a landing page may cause loss of operational detail. Mitigation: extract, don't delete — move deep-dive content to `docs/`.
- **Assumption:** `docs/use-cases.md` is accurate and complete enough to serve as the primary source of truth for value propositions.
- **Risk:** The "Example" section requires a realistic end-to-end scenario that may need to reference workflow mechanics (mission → worktree → agent run → checkpoint/review/integrate). This assumes the reader has some Git familiarity.

## Checkpoints

- CP-1: Benchmark research complete. `docs/readme-rewrite-benchmark.md` committed with analysis of Aider, Goose, OpenCode, and at least one additional competitor. Each entry includes headline pattern, structure analysis, credibility handling, and specific borrow/avoid decisions.
- CP-2: Draft README written and committed. All nine required sections present. Internal authority content extracted to `docs/authority-reference.md`. First 300 words verified to answer all five questions.
- CP-3: SEO and credibility review passed. At least 6 of 9 SEO phrases present. No internal abstractions in first 500 words. Tone check: sounds like it was written by a skeptical engineering manager, not a hype marketer.
- CP-4: Final gate passes. `npm test` succeeds. All success criteria verified.

## Gates

- [ ] npm test

## Restricted Areas

- Do not modify any files under `parallix/` runtime code (lib/, test/, config/, index.js, px.js).
- Do not modify `docs/use-cases.md`, any ADR files under `docs/adr/`
- Do not modify `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, or `package.json`.
- Do not publish to any registry or create any distribution artifacts.

## Stop Rules

- Stop if benchmark research reveals the specified structure is significantly inferior to competitor patterns and no clear alternative structure emerges — escalate for structure decision rather than forcing a poor fit.
- Stop if extracting old README content cannot be organized into a coherent `docs/` file without duplicating ADR or use-case content already covered elsewhere.
- Stop if achieving all six SEO phrase requirements forces unnatural phrasing that compromises the skeptical-engineering-manager tone.
- Stop if `npm test` fails and the failure trace indicates the README rewrite caused unintended side effects (e.g., broken symlink in docs/, malformed markdown in a referenced file).
