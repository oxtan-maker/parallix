# Mission: Extract primary Parallix use cases for positioning and branding (task-1332)

## Goal

Produce a PM-quality, evidence-backed use-case inventory for Parallix that identifies which capabilities the tool actually delivers today (not aspirational ones), ranks them by credibility as public-facing positioning statements, and outputs a structured document suitable as the foundation for README rewrite, landing page copy, and packaging decisions. The deliverable is a single Markdown file at `missions/task-1332/use-cases.md` containing categorized use cases with supporting evidence references.

The deliverable must survive review by a skeptical senior PM who has not seen this repository. If it would read to that person as a feature list, a restatement of the README, or generic "AI coding tool" messaging, it has failed regardless of how many success-criteria checkboxes are ticked.

## Why Now

The current README opens by branding itself a "parallix Authority Reference" and frames the tool as "the parallix AI mission lifecycle" — an internal authority document, not an external product narrative. Prospective users and contributors encounter the authority stack, config boundaries, and agent-selection internals before they ever learn what problem Parallix solves for them. Without a grounded use-case analysis, any subsequent positioning work (README rewrite, landing pages, marketing copy) risks being generic messaging that does not differentiate Parallix. This mission extracts the truth from the repository so positioning can be built on actual capabilities rather than assumptions.

## Burden of Evidence

This mission exists because of specific, observed pains — not a general wish for "better docs." Every claim the deliverable makes must clear the same evidentiary bar that justifies the mission itself.

### Observed pains (parallix + visualBoard)

- **README is an internal authority doc, not a product story.** `README.md:1` is titled "parallix Authority Reference" and `README.md:3` frames the tool as "the parallix AI mission lifecycle." The first ~60 lines are workflow modes, authority stacks, config boundaries, and agent-selection mechanics — implementation governance, not user value.
- **The public surface is internally inconsistent.** The adjacent mission `missions/task-1331/MISSION.md` documents that `package.json` was marked `"private": true` and described the tool as "unpublished," the README still carried `visualBoard` framing, and the distribution ADR (`docs/adr/0044-workflow-distribution-model.md`) sat at `Status: Proposed` after the repo went public on 2026-06-22. The project reads as "half-renamed and half-unreleased" — a credibility gap that positioning must repair on a factual base.
- **The capability list is real but unstoried.** The backlog task enumerates mission lifecycle, worktree/branch execution, multi-agent execution/review, agent selection/blocklisting, checkpoint resumability, review loops, integration gates, telemetry, verification adapters, and local packaging. These are implementation capabilities, not use cases. Translating them 1:1 into a marketing list is exactly the failure mode this mission must avoid.
- **The differentiating capability is measured, not assumed.** visualBoard's own AI-SDLC retrospectives (`../visualBoard/docs/missions/2026/ai-workflow-retrospective-since-october/EVALUATION_SUMMARY.md` and `.../task-1023/RETROSPECTIVE_P5.md`) quantify the workflow Parallix implements: informal AI **regressed throughput 57%** vs the human baseline (0.12 vs 0.28 user-value units/day) and single-threaded formal AI did no better; throughput only recovered and then **exceeded the human baseline by ~2.0x (0.58/day, +107%)** once the **parallel worktree model** — Parallix's core mechanic — was adopted. The same source flags that **34% of formal missions were AI-workflow overhead**, and that **C2/external review coverage was only 7%** against a 100% rule. This is the strongest positioning asset *and* the clearest honesty constraint: the gains are real and attributable to the parallel model, but only under disciplined gates.

### External research (positioning need + honesty constraint)

- **Documentation is a primary adoption driver, and the first paragraph decides.** The README's title and one-paragraph pitch determine whether developers keep reading and whether they trust the project; Stripe/Twilio-grade docs are repeatedly cited as direct drivers of developer-tool adoption. Each use case should name its target user and the problem solved, with a path to "how Parallix does it." ([draft.dev](https://draft.dev/learn/documentation-best-practices-for-developer-tools), [dev.to](https://dev.to/georgekobaidze/15-essential-sections-every-readme-needs-give-your-project-what-it-deserves-fie))
- **Unsubstantiated speed/productivity claims are a known credibility trap.** METR's July 2025 RCT (16 experienced OSS developers, 246 tasks on mature repos) found that early-2025 AI tooling made developers **19% slower**, even though the same developers *predicted* a 24% speedup and *believed afterward* they'd gotten a 20% speedup. The lesson for positioning: claimed AI productivity gains are routinely wrong in the optimistic direction, so any throughput claim Parallix makes must be tied to its verifiable gate/parallelism mechanics and the measured retro data — never to vibes. ([METR](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/), [arXiv](https://arxiv.org/pdf/2507.09089), [Simon Willison](https://simonwillison.net/2025/Jul/12/ai-open-source-productivity/))

### What this burden requires of the deliverable

Every use case must carry its own evidence the way this section carries the mission's: a named user/buyer, the concrete pain removed, a repository or measured-data citation, and an honest confidence/limitation note. Throughput or productivity framing is permitted **only** when anchored to the visualBoard retro data and Parallix's actual gate/parallel mechanics, and must be presented with the same caveats the retro itself states (overhead share, review-coverage gap, model-currency caveat).

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: README credibility gap, need for positioning foundation before branding work, measured differentiator (parallel worktree model) at risk of being mis-sold

## Scope

- Inspect repository artifacts: README.md, package.json, AGENTS.md, CHANGELOG.md, docs/, docs/adr/, prompts/, templates/, examples/, missions/, config/, lib/, index.js, px.js, tests
- Inspect git history for both parallix and ../visualBoard repositories to find agent missions, retros, hypotheses, bets, and resulting data vs. unproven claims — explicitly mine the visualBoard AI-SDLC retros for measured throughput/quality data that substantiates or limits each candidate use case
- Extract and categorize primary use cases that Parallix supports today
- Rank use cases by strength as public positioning statements
- Produce `missions/task-1332/use-cases.md` with categorized, evidence-backed use cases
- Cross-reference each use case to specific repository evidence (files, code paths, test behavior, config examples) and, where a value/throughput claim is made, to the measured retro data
- For each use case, separate the *capability* (what the code does) from the *value* (the user pain it removes) — a use case that states only the capability is incomplete

## Out of Scope

- Rewriting the public README
- Creating aspirational marketing claims unless clearly marked as future/not yet supported
- Renaming the product
- Changing runtime behavior (only tiny documentation-supporting corrections if explicitly justified)
- Generic "AI coding tool" positioning — output must be specific to Parallix
- Building landing pages, website copy, or brand guidelines (these consume the output of this mission)
- Citing the README as evidence for the value of a capability (README claims may be cited only as the thing being tested, never as proof)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Deliverable file `missions/task-1332/use-cases.md` exists and contains at least 5 distinct use cases, each with at least one repository artifact cited as evidence (file path or code path, not a README assertion)
- Each use case states all four of: (1) a named target user or buyer persona, (2) the specific pain it removes stated as a before/after, (3) at least one repository or measured-data citation, (4) a confidence level (Confirmed / Partial / Aspirational) with a one-line justification. A use case missing any of the four is incomplete and does not count toward the minimum of 5.
- At least 3 use cases map to capabilities that are actively tested (confirmed by presence of corresponding test files in `tests/`/`test/` or executable behavior in `lib/` or `px.js`, cited by path)
- No use case relies solely on README claims; every capability claim is corroborated by code, tests, configs, examples, or measured retro data
- The document explicitly flags any aspirational / not-yet-supported use cases in a section separated from confirmed capabilities
- The document includes a ranking section identifying the top 3 use cases recommended for immediate public positioning, and for each top-3 item states the one competing/alternative tool or workflow a user would otherwise reach for, so the differentiation is explicit rather than implied
- Any throughput, speed, or productivity claim is tied to the visualBoard measured retro data with the figure cited, and carries the retro's own caveats (workflow-overhead share, review-coverage gap, model-currency caveat). A productivity claim without a cited figure and caveat is a defect.
- Git history inspection of parallix repo covers at least 10 missions or retros (verifiable by counting mission files or retro entries referenced)
- Git history inspection of visualBoard repo covers at least 3 missions or retros (verifiable by counting mission files or retro entries referenced)

## Value Bar (Senior-PM Acceptance — anti-checkboxing)

The success criteria above are necessary but not sufficient. A deliverable that satisfies every checkbox but fails the value bar below must be rejected and reworked. This section exists specifically to stop an agent from optimizing for countable artifacts at the expense of PM value.

**The deliverable is REJECTED if any of the following are true:**

1. **Feature-list smell.** The use cases are restatements of capabilities ("supports worktree isolation," "has a review loop") rather than user outcomes. Test: strike every Parallix-internal noun (worktree, checkpoint, mission, gate, adapter) from a use-case statement — if nothing about a user's situation or outcome remains, it is a feature, not a use case.
2. **README echo.** The evidence column substantially restates README prose instead of pointing at code/tests/configs/measured data.
3. **Genericness.** A use case would read identically if "Parallix" were replaced with the name of any other AI coding tool. Each top-3 use case must contain at least one claim that is *only* true of Parallix given the cited evidence.
4. **Unfalsifiable value.** A stated value relies on a banned subjective adjective with no attached metric, persona, or before/after.
5. **Cooked productivity claims.** Any speed/throughput framing not anchored to the cited retro figures and their caveats (this is the METR failure mode the mission is built to avoid).
6. **No skepticism.** The document contains zero use cases marked Partial/Aspirational and zero documented limitations — a sign the author advocated rather than assessed.

**Adversarial self-review (required, written into the deliverable):** Before finalizing, the author must include a short "Red-team" subsection that names the two weakest use cases in the document and states, for each, the single strongest objection a skeptical senior PM would raise and how the evidence answers (or fails to answer) it. A deliverable with no red-team subsection fails the value bar.

## Risks and Assumptions

- **Risk:** Git history of `../visualBoard` may not be accessible in this worktree. **Mitigation:** Inspect whatever local mirrors or archived mission/retro files exist (the AI-SDLC retros and `EVALUATION_SUMMARY.md` are known-present); note absence as a constraint in the output.
- **Assumption:** The repository contains enough evidence (code, tests, examples, configs, retros) to substantiate at least 5 real use cases. If the codebase is too sparse, the output will reflect that limitation explicitly.
- **Risk:** Agent-generated missions in git history may contain aspirational claims that diverge from delivered behavior. **Mitigation:** Cross-reference every claim against actual code/test/config/measured evidence before accepting as a real use case.
- **Risk:** The author over-sells the measured throughput gain (the +107% figure) without its caveats, reproducing the exact METR over-optimism failure. **Mitigation:** Success criteria and the value bar both require the figure to travel with its caveats.
- **Assumption:** The product name "Parallix" and its core capabilities (mission lifecycle, worktree isolation, px runner, multi-agent coordination) are stable and not subject to imminent rebranding.

## Checkpoints

- CP 1: Evidence collection complete — all specified repository directories inspected, git history reviewed for both parallix and visualBoard (including the AI-SDLC retros), initial raw findings documented with citations
- CP 2: Use cases drafted — categorized inventory written with four-part evidence per use case, aspirational items flagged, top-3 ranking with named alternatives produced
- CP 3: Adversarial review — value bar applied to the draft, red-team subsection written, any feature-list/README-echo/generic/cooked-claim defects corrected
- CP 4: Final review — document reviewed for completeness, falsifiability of all claims, and readiness as positioning foundation

## Gates

- [ ] ./scripts/verify-local.sh docs

## Restricted Areas

- Do not modify README.md, package.json publish fields, or any files outside `missions/task-1332/`
- Do not modify `.agents/`, `.claude/`, or opencode configuration files
- Do not alter CI/CD pipelines, Docker configurations, or deployment scripts
- Do not publish, release, or distribute any output from this mission

## Stop Rules

- Stop if evidence gathering reveals fewer than 3 substantiated use cases — document the gap and recommend next steps rather than padding with weak claims
- Stop if the visualBoard repo is inaccessible and parallix history alone yields insufficient cross-referenced missions (fewer than 5 verifiable missions/retros)
- Stop if you cannot produce at least 3 use cases that each pass the value bar (named persona + before/after pain + non-README evidence + survives the feature-list strike test) — do not substitute volume for value
- Stop if the output begins to drift into README rewriting, brand strategy, or marketing narrative — those are downstream consumers of this deliverable
