---
id: TASK-2697
title: >-
  Build a publication-ready engineering case study from the Parallix recovery
  experiments
status: backlog
assignee: []
created_date: '2026-10-09 09:16'
labels: []
dependencies: []
ordinal: 200008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Turn the completed Parallix recovery research into a **professionally designed, evidence-backed technical case study** that can be reviewed locally now and published later.

Do **not** publish anything in this mission.

Do not:

- enable GitHub Pages;
- create or modify a Pages deployment workflow;
- publish to LinkedIn;
- post anywhere externally;
- modify the repository homepage/README to promote the article;
- create an external website;
- create a release or announcement.

The deliverable is a polished **publication bundle** inside the Parallix repository that can later be reviewed, edited, and published with minimal additional work.

The intended future uses are:

1. a technical article hosted from the Parallix repository, likely through GitHub Pages or an equivalent static host;
2. a LinkedIn post that introduces one useful finding and points interested readers to the full article;
3. public evidence that the maintainer has designed, operated, measured and revised real agentic-development infrastructure.

Professional credibility is the primary objective.

Parallix discovery is secondary.

The article must remain valuable to a reader who never intends to use Parallix.

---

# Evidence base

Treat this as a fresh evidence-synthesis mission.

Do not reconstruct results from memory.

Start from current `main` and inspect the actual repository evidence.

At minimum inspect:

```text
backlog/completed/task-2575 - Give-self-development-gate-rebounds-authority-to-repair-the-failing-defence.md

backlog/completed/task-2588 - Escalate-failed-rebounds-to-fresh-context-diagnostic-repair.md

backlog/completed/task-2652 - Validate-fresh-context-rebound-recovery-by-replaying-historical-Ornith-failed-repairs.md

docs/recovery-evidence.md

tools/recovery-context-evaluation/report.md

src/application/rebound-kernel.ts
src/application/fresh-session-marker-port.ts
src/application/recovery-supervisor.ts
```

Also inspect relevant current verification/review/recovery implementation when needed to check factual claims.

---

# External research workspace

A sibling research directory exists:

```text
../parallix-research/
```

Use it as a research source, not as a publication destination.

Inspect its contents before drafting.

It contains larger research/evaluation artifacts from this and related experiments and should include material such as:

```text
agentic-recovery-linkedin-outline.md
```

and may contain:

- the larger TASK-2652 experiment report;
- datasets;
- charts;
- transcripts;
- prior research packs;
- external-source notes;
- exploratory article outlines;
- other experiment material.

Do not assume exact filenames beyond those that actually exist.

Inventory the directory first.

Use only material whose provenance you can establish.

If the TASK-2652 archive still exists separately at:

```text
../parallix-article-data-task-2652/
```

inspect it as well.

Prefer the canonical/latest version when the same artifact exists in both locations.

Do not copy large raw datasets or transcripts into the Parallix repository.

---

# The TASK-2652 result must constrain the story

The existing repository summary currently reports six paired historical Ornith replays:

```text
Fresh focused verifier:    6 / 6
Resumed focused verifier:  4 / 6

Accepted committed repair:
Fresh:                      3 / 6
Resumed:                    3 / 6

Median duration:
Fresh:                     75.4 s
Resumed:                  305.6 s
```

It also reports materially lower fresh-context token usage:

```text
Uncached input total:
Fresh:     115,023
Resumed:   835,674

Cached input total:
Fresh:      4,911,593
Resumed:   24,213,930

Output total:
Fresh:      62,913
Resumed:   160,359
```

These figures MUST be independently checked against the canonical TASK-2652 dataset before publication artifacts use them.

Do not copy them blindly from this mission text.

The existing TASK-2652 conclusion is deliberately bounded:

> enough for a bounded engineering case study about context cost and verification limits

but:

> inconclusive for TASK-2588's failed-first-rebound hypothesis or a general improvement in repair success.

Preserve that distinction.

---

# Important consequence

Do NOT force the old article thesis:

> fresh context produces better repairs

The experiment does not establish that.

Instead, determine the strongest thesis supported by the evidence.

A promising direction to test is:

> **Fresh context changed the cost and local verification profile far more clearly than it changed actual repair correctness.**

or:

> **A fresh agent context can reduce the context tax without making verification someone else's problem.**

or:

> **The surprising result wasn't that fresh context fixed more bugs. It was that it reached focused green checks faster and cheaper — while valid repair rates stayed the same.**

or:

> **A green check is evidence about a check, not proof that the repair is good.**

Do not adopt any of these blindly.

Choose the thesis after inspecting the complete evidence.

---

# Required reasoning structure

The article should distinguish four layers throughout:

## Observed

What the experiments actually measured.

## Interpretation

What mechanism might explain the result.

## Design response

What Parallix currently does because of these observations.

## Generalization

What another engineering team might reasonably take from it.

Never combine all four into one factual claim.

Example:

Bad:

> Fresh context makes coding agents faster and more reliable.

Better:

> In six paired historical replays, the fresh-context arm completed faster and passed the focused verifier more often. The rate of accepted committed repairs was identical. That makes fresh context interesting as a recovery-cost control, but the experiment does not show that it generally produces more correct repairs.

---

# Candidate article angle

Start by testing this candidate structure against the evidence.

## 1. Original operating problem

A coding agent produces incorrect work.

Verification catches it.

A targeted repair is attempted.

The repair still does not satisfy the system.

What should the harness do next?

---

## 2. Reasonable first design

Explain why a resumed, targeted repair is attractive:

- relevant context already exists;
- the agent knows what it changed;
- rediscovery is expensive;
- exact diagnostic evidence is available.

Avoid hindsight.

---

## 3. The design change

Explain the TASK-2575 / TASK-2588 evolution:

```text
targeted repair
      ↓
authoritative verification
      ↓ still red
fresh-context diagnostic repair
      ↓
authoritative verification
      ↓ still red
human
```

Important distinction:

```text
preserve:
repository
commits
mission constraints
failure evidence

reset:
conversation
inherited diagnosis
previous repair narrative
```

---

## 4. Then test the design

Introduce TASK-2652 as an attempt to challenge the assumption rather than prove it.

Explain the paired replay approach clearly enough for another engineer to understand what was compared.

Keep experimental mechanics concise.

Avoid making the article read like an academic paper.

---

## 5. The surprising result

Candidate core observation:

```text
focused verifier:
fresh 6/6
resumed 4/6

accepted committed repair:
fresh 3/6
resumed 3/6
```

This gap may be the article's strongest point.

A focused green test is useful evidence.

It is not the same thing as a valid delivered repair.

Explain concrete rejected cases from TASK-2652 where useful, for example:

- green focused check but uncommitted edits;
- green focused check but adjacent behavior broken;
- green focused check but broader task/documentation contract unmet.

Only use examples supported by the experiment records.

---

## 6. Context cost

Explain the timing/token result carefully.

The interesting observation may be that carrying the old conversation imposed a substantial context cost in this small local-model study.

If canonical data confirms current summary:

```text
median:
fresh ~75 s
resumed ~306 s
```

That is roughly a fourfold median wall-time difference.

Do not write:

> fresh context is 4x faster

without the full qualifier.

Acceptable direction:

> Across these six Ornith replay pairs, the fresh arm's median runtime was about one quarter of the resumed arm's.

Likewise for token counts.

Always keep:

```text
six pairs
one local model family
specific historical Parallix failures
specific experiment design
```

near quantitative claims.

---

# Possible strongest engineering lesson

The article should test whether the evidence supports a synthesis like:

> **Conversation history is useful state, but it has a carrying cost. Durable engineering state belongs in the repository and evidence system; conversational state should be disposable when it stops earning its cost.**

This could be stronger than the original:

> change the reasoning context, not just the prompt

because TASK-2652 directly provides evidence about cost while remaining inconclusive about repair correctness.

Another candidate:

> **Fresh context is a recovery optimization. Verification is still the quality system.**

This may capture the 6/6-vs-4/6 focused result alongside the 3/6-vs-3/6 accepted result.

Choose based on the full evidence.

---

# Do not hide inconvenient results

The equal accepted-repair result is not an embarrassment.

It may be the reason the article is credible.

Do not:

- select only the 6/6 vs 4/6 number;
- present focused verifier pass as successful repair;
- omit semantic rejection;
- omit uncommitted repairs;
- omit timeouts;
- merge checkpoint/documentation cases into code correctness without distinction;
- imply statistical significance that was not established.

The article should visibly show that the experiment changed or narrowed the original belief.

That is a feature of the story.

---

# External research

Use the prior research in:

```text
../parallix-research/agentic-recovery-linkedin-outline.md
```

as a starting source map.

Re-check external sources where a current/public claim matters.

Do not create a giant literature review.

The finished article needs at most a few high-quality external references.

Strong categories:

- engineering guidance on fresh-context verification;
- long-running agent harness design;
- independent verification;
- repair/retry research;
- skeptical engineering discussion.

External evidence should provide context.

Parallix's own experiment should remain the core evidence.

---

# Publication format

Create a self-contained publication bundle inside the repository.

Do not add deployment infrastructure.

Before choosing the location:

1. inspect current repository documentation conventions;
2. inspect `docs/doc-standards.md`;
3. avoid turning README into a development diary;
4. avoid introducing a large general-purpose website framework for one article.

Preferred characteristic:

> a static bundle that can later be served unchanged or with trivial configuration by GitHub Pages.

A reasonable shape, if consistent with repository conventions, is something like:

```text
docs/fresh-context-recovery/
  index.html
  article.md
  styles.css
  assets/
    ...
  evidence.md
  linkedin-draft.md
  README.md
```

The exact location is not mandatory.

Choose the smallest sensible repository structure and document the decision.

---

# No publishing in this mission

Explicitly do NOT create:

```text
.github/workflows/pages.yml
_config.yml solely to enable Pages
CNAME
deployment scripts
GitHub Pages API configuration
external hosting configuration
```

Do not change repository settings.

The artifact must simply be **ready to publish later**.

---

# HTML publication artifact

Create a polished static HTML version of the article.

Requirements:

- self-contained or simple relative assets;
- no server;
- no database;
- no runtime API;
- no heavyweight JavaScript framework;
- no analytics;
- no trackers;
- no external fonts required for correct rendering;
- usable directly from local filesystem or a simple static HTTP server;
- suitable for GitHub Pages later.

Prefer semantic HTML and modest CSS.

JavaScript should be unnecessary unless it creates clear reader value.

---

# Professional visual design

The page should look like a serious engineering publication, not generated documentation.

Desired direction:

- restrained technical editorial design;
- excellent typography;
- generous whitespace;
- readable line length;
- strong hierarchy;
- visually clear evidence blocks;
- responsive desktop/mobile layout;
- tasteful use of data visualization;
- no startup-marketing gradients;
- no glassmorphism;
- no glowing AI brains;
- no generic robot imagery;
- no fake terminal wallpaper;
- no visual clutter.

Reference aesthetic:

> senior engineering blog / high-quality technical case study

rather than:

> SaaS landing page.

---

# Images and diagrams

Generate publication-quality visual assets as part of the mission.

The visuals must communicate evidence or mechanism.

## Required visual 1 — recovery architecture

Show:

```text
targeted repair
      ↓
verify
   red
      ↓
fresh-context diagnostic repair
      ↓
verify
   red
      ↓
human
```

Also communicate:

```text
repository state preserved
conversation context reset
verification authority unchanged
```

This should be an SVG or similarly crisp vector asset.

---

## Required visual 2 — experiment outcome

Visualize the six paired replay results.

Do not create a misleading percentage chart from six samples.

Prefer a paired/trial visualization showing each historical failure and:

```text
fresh focused result
resumed focused result
accepted repair result
```

The viewer should immediately see:

```text
focused pass != accepted repair
```

---

## Required visual 3 — context cost

Create a restrained comparison for at least:

```text
median wall time
uncached input
cached input
output tokens
```

Use the canonical dataset.

Make sample size obvious.

Do not use truncated axes or decorative scale distortion.

---

## Social / article preview image

Generate one publication preview asset suitable for:

- GitHub Pages/OpenGraph later;
- LinkedIn link preview if used later;
- repository documentation preview.

Recommended dimensions approximately:

```text
1200 × 630
```

The preview should contain a concise article title or thesis and a simple visual motif derived from the recovery architecture.

Do not put a paragraph of text on it.

---

# Image-generation policy

For factual diagrams and charts:

> derive visuals deterministically from real experiment data.

Do not use generative imagery to invent data.

If an image-generation capability is available, it may be used for a restrained decorative hero/background element only if it materially improves the publication.

Any generated decorative imagery must remain secondary to the factual diagrams.

If no image-generation system is available, create the required visuals as SVG/CSS/programmatic assets.

Do not block the mission on decorative image generation.

---

# Accessibility

All images require meaningful alt text.

The page must:

- preserve readable contrast;
- work without animation;
- work at narrow mobile width;
- use semantic headings;
- not encode critical distinctions by color alone.

SVG charts should have accessible labels or textual equivalents.

---

# Article writing constraints

Write the full technical article.

This mission DOES produce final long-form article prose.

Voice:

- senior engineer to senior engineer;
- technically precise;
- calm;
- concrete;
- willing to preserve ambiguity;
- clear distinction between measurement and interpretation.

Avoid:

```text
game changer
revolutionary
unlock
future of software engineering
AI changes everything
10x
here's the thing
let that sink in
```

Do not use influencer formatting.

Do not write every sentence as its own paragraph.

Do not write a listicle.

---

# Strong opening

Open on the engineering problem or experiment.

Do not open with:

> AI coding agents are transforming software development.

Good opening direction:

```text
A repair agent can fail in two different ways.

It can fail the test.

Or it can make the test green without producing a repair you would actually accept.
```

This is direction only, not mandatory prose.

Another possible opening:

```text
We changed Parallix so a second failed repair gets a fresh agent context.

Then I tried to find out whether that actually helped.
```

Use whichever best fits the evidence.

---

# Article structure

Do not mechanically follow headings if better prose emerges, but cover these ideas.

## Failure

The operating problem that led to TASK-2575/TASK-2588.

## Design

Why targeted first repair + fresh second context was reasonable.

## Experiment

How TASK-2652 challenged it.

## Result

Focused verification, accepted repairs, runtime/context cost.

## What was wrong with the original hypothesis

Fresh context did not show a higher accepted-repair rate in this dataset.

## What did survive

Potentially:

- lower context/time cost;
- better focused-verifier outcomes;
- value of external verification;
- disposable conversational state;
- preservation of durable repository evidence.

## Engineering implication

What a harness should own around unreliable workers.

## Limits

One concise section.

---

# Claims ledger

Create an internal publication claim ledger before finalizing prose.

For every numeric or important causal statement record:

```text
CLAIM
source
observed / interpreted
allowed wording
stronger wording to avoid
```

This may live in:

```text
evidence.md
```

Do not expose internal raw transcript material in the public article unnecessarily.

---

# Quantitative reporting

Any prominent number must specify enough context to interpret it.

For example, if verified:

Good:

> Across six paired historical Ornith replays, the fresh-context arm had a median runtime of 75.4 seconds versus 305.6 seconds for resumed context.

Bad:

> Fresh context was 4x faster.

Good:

> Fresh passed the focused verifier in all six pairs, versus four of six resumed runs. But only three repairs in each arm were accepted after inspecting the actual delivered change.

That second sentence is likely one of the most important in the publication.

---

# Article title candidates

Generate and evaluate at least eight.

Directions worth testing include:

```text
Fresh context made the agent cheaper. It didn't make the repair more correct.

What six failed coding-agent repairs taught me about context and verification

Reset the conversation, keep the evidence

Fresh context is a recovery optimization — not a quality system

A green test is not the same thing as a repaired task

What happened when I replayed six coding-agent failures with and without their old context

The hidden cost of resuming a coding-agent conversation

When should a coding-agent harness throw away the conversation?
```

Do not select based on clickbait.

Select based on:

- fidelity to result;
- technical interest;
- credibility;
- discoverability;
- suitability as a GitHub Pages article.

---

# Parallix placement

Parallix is the experiment and implementation source.

It may appear naturally.

Avoid repeated product promotion.

The article should make clear that:

- these observations came from building and dogfooding Parallix;
- Parallix implements the recovery policy;
- the experiment replayed actual historical Parallix failures.

Do not add:

- installation CTA;
- npm metrics;
- stars;
- feature inventory;
- generic product pitch.

A restrained footer may link to repository root.

---

# LinkedIn companion draft

Create, but do not publish:

```text
linkedin-draft.md
```

The LinkedIn text is an introduction to the article, not a compressed copy of it.

Objective:

> expose the surprising result and give technically interested readers a reason to read the full case study.

It should likely center on:

```text
fresh passed more focused checks
but accepted repair rate was equal
and resumed context cost much more
```

Do not make LinkedIn the evidence authority.

The article is the durable source.

Do not include a real publication URL yet if none exists.

Use a placeholder such as:

```text
[article URL after publication]
```

or clearly document where the future link belongs.

---

# LinkedIn constraints

Create one primary draft.

Target:

```text
~1,800–2,600 characters
```

unless the argument genuinely needs less.

No emojis.

No influencer listicle.

No fake dramatic one-line staircase.

No “I learned something wild”.

No marketing CTA.

End with a restrained pointer to the full experiment/article.

---

# Source and evidence treatment

The eventual public artifact should be independently auditable where practical.

Use public GitHub links for public repository evidence.

For experiment data that remains outside the repository:

- summarize the canonical aggregate evidence in the publication bundle;
- record its source artifact hashes/provenance;
- do not create public links to nonexistent local sibling paths;
- do not claim the reader can access private/local raw artifacts.

Where useful, link to:

```text
TASK-2575
TASK-2588
TASK-2652
docs/recovery-evidence.md
tools/recovery-context-evaluation/report.md
```

via stable GitHub paths.

---

# Research workspace is not publication content

Paths such as:

```text
../parallix-research/
../parallix-article-data-task-2652/
```

are development sources.

They must never appear in the rendered public page as links.

A future reader will not have those directories.

---

# Local preview

Provide a trivial local preview path.

For example:

```text
python3 -m http.server <port> --directory <publication-root>
```

or an existing repository-native static preview mechanism if one already exists.

Do not add an npm web framework just to preview one article.

Document the exact preview command.

---

# Publication readiness

The bundle should be deployable later through a simple static-host action without rewriting paths.

Check:

- all asset paths relative;
- no local absolute paths;
- no `file://`;
- no sibling-repo links;
- no localhost references;
- no build-time secrets;
- no private paths;
- no missing images;
- social-preview asset exists;
- page has useful `<title>` and description metadata;
- canonical URL may remain unset until publication;
- OpenGraph metadata may use relative/local placeholders where an absolute published URL is not yet known.

Do not guess the final GitHub Pages URL.

---

# Do not change project/product docs unnecessarily

This is a publication artifact.

Do not rewrite:

```text
README.md
docs/agents.md
docs/use-cases.md
```

to accommodate it.

Do not turn public product documentation into a link farm.

A later publication mission can decide whether and where to link the article from README.

---

# Review artifacts

Create a short reviewer README next to the article explaining:

```text
what to read first
how to preview locally
which data is canonical
which claims deserve particular scrutiny
what remains intentionally unpublished
```

This is for maintainer review before publication.

---

# Visual review

Before completing:

1. render the HTML locally;
2. inspect desktop width;
3. inspect a narrow/mobile width;
4. inspect every chart;
5. inspect social-preview image;
6. confirm no text clipping;
7. confirm code/labels remain readable;
8. confirm charts do not misstate small N;
9. confirm image alt text exists.

Use screenshots if needed for visual inspection.

Do not declare visual quality based only on source code.

---

# Adversarial editorial review

Run one final skeptical pass from four viewpoints.

## Principal engineer

Where does the article overstate causality?

## Engineering manager / CTO

Is the operational lesson clear enough to justify the detail?

## AI engineer

Where could they object to the experiment design?

## Potential consulting buyer

Does this demonstrate engineering judgment, or does it merely advertise an open-source project?

Revise accordingly.

---

# Required deliverables

At minimum leave behind:

```text
<publication-root>/
  index.html
  article.md
  styles.css
  evidence.md
  linkedin-draft.md
  README.md
  assets/
    recovery-ladder.svg
    replay-results.svg
    context-cost.svg
    social-preview.png
```

Exact names may differ for a good reason.

The bundle must contain:

1. final long-form article;
2. polished static HTML rendition;
3. professional responsive layout;
4. at least three useful technical/data visuals;
5. publication/social preview image;
6. evidence/claim ledger;
7. source references;
8. unpublished LinkedIn companion draft;
9. local preview instructions;
10. publication-readiness notes.

---

# Verification

At minimum:

```text
./scripts/verify-local.sh docs
./scripts/verify-local.sh static-analysis
```

Run broader repository verification only when changed executable code requires it.

Also verify:

- HTML asset references resolve;
- Markdown relative links resolve;
- SVG/XML is valid;
- generated chart data matches canonical source values;
- no private research paths leak into public HTML;
- no secrets/session identifiers appear;
- no Pages deployment was created.

---

# Non-goals

Do not:

- publish;
- deploy;
- enable Pages;
- change repository settings;
- make this a new Parallix product feature;
- build a general blogging engine;
- adopt Astro/Jekyll/VitePress/etc. for one article unless the repository already has a compelling reason;
- rerun the expensive Ornith experiment merely for nicer numbers;
- use cloud agents for additional empirical trials;
- generate decorative AI imagery instead of useful engineering visuals;
- rewrite experiment history;
- hide negative or inconclusive findings;
- turn the article into Parallix marketing.

---

# Success criteria

This mission succeeds when:

1. A technically strong article exists and is ready for human editorial review.
2. Every important empirical claim is traceable to TASK-2652 evidence.
3. The article reflects that fresh context improved focused-check outcomes and cost in this small experiment but did not improve accepted repair count.
4. The original fresh-context hypothesis is visibly refined rather than retroactively declared proven.
5. The distinction between focused verification and accepted repair is unmistakable.
6. The publication has professional typography and layout.
7. Data visualizations accurately convey n=6 rather than visually inflating the evidence.
8. Visual assets make the mechanism/results easier to understand.
9. The HTML can later be served from a static host without restructuring.
10. No publishing configuration or external publication occurs.
11. A restrained LinkedIn companion draft exists for later review.
12. Parallix appears as the source of the engineering experience, not as the subject of an advertisement.
13. A skeptical Principal Engineer can see both the interesting result and its limitations.
14. The maintainer can inspect the complete result locally before deciding whether to publish anything.

---

# Final checkpoint

End with:

```text
PUBLICATION BUNDLE
<path>

SELECTED ARTICLE THESIS
<one sentence>

WHY THIS THESIS
<2–3 sentences tied to evidence>

PRIMARY EXPERIMENT RESULT USED
<bounded summary>

MOST IMPORTANT NEGATIVE / LIMITING RESULT
<result>

ARTICLE TITLE
<title>

VISUALS CREATED
<files + purpose>

LOCAL PREVIEW
<command>

LINKEDIN DRAFT
<path>

CLAIMS REQUIRING MAINTAINER SCRUTINY
<short list>

PUBLICATION ACTIONS TAKEN
none

RECOMMENDED NEXT STEP
human editorial review before any publication or repository linking
```
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
