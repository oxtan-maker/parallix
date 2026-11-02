---
id: TASK-2697
title: >-
  Build a publication-ready engineering case study from the Parallix recovery
  experiments
status: done
assignee: []
created_date: '2026-10-09 09:16'
labels: []
dependencies: []
ordinal: 200008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a compelling, evidence-backed engineering article as a finished responsive HTML page, ready for human editorial review and later GitHub Pages publication.

Give engineers building coding-agent systems a useful account of when resetting context helped, what it did not fix, and how those results changed a recovery policy. The reader should gain a practical decision they can apply without adopting Parallix.

## Editorial brief

Create site/articles/fresh-context-recovery/index.html with styles.css and only the assets the article needs. The HTML page is the primary finished deliverable, not a Markdown report with styling added afterward. Write for an experienced software engineer deciding whether to resume a failed coding-agent session or start fresh. Aim for a focused 1,200–1,800-word article; use fewer words if the story is complete. Open with a documented failure or the central experimental tension, explain the recovery decision, show the paired results, and develop one useful operational lesson. Let the evidence determine the title and argument; do not follow a prescribed heading template.

Research docs/recovery-evidence.md, tools/recovery-context-evaluation/report.md, completed TASK-2575/2588/2652 records, relevant recovery implementation, and available ../parallix-research/ or TASK-2652 archive artifacts. Verify figures against the canonical six-pair dataset; record provenance and any unavailable evidence. Expected findings to check: fresh/resumed focused passes 6/6 versus 4/6; accepted repairs 3/6 versus 3/6; median runtime 75.4 versus 305.6 seconds. Verify token figures before using them. These are a small historical replay with one local model, not proof of general superiority or causality.

Use one or two documented cases to explain what the focused verifier missed and why a repair was accepted or rejected. Explain enough of the paired setup and acceptance rule for a skeptical reader to assess the comparison. Separate measurements from possible explanations in natural prose. Do not invent scenes, quotations, motivations, or first-person experiences. Put the equal accepted-repair result alongside the focused-pass result wherever that comparison is prominent.

Design a quiet editorial page: readable text measure and typography, generous spacing, clear hierarchy, accessible contrast, mobile layout, and useful source links. Avoid dashboard cards, marketing hero sections, badges, stock gradients, decorative AI imagery, and repeated pull quotes. Include a compact six-pair results table or figure that shows focused passes separately from accepted repairs. Add a recovery-flow or cost visual only if it explains something the prose/table cannot. Show counts and n=6; no inflated percentages or headline speedup claims. A chart quota and social preview image are not required.

Retain the methods, per-mission records, calculations and provenance privately in ../parallix-research/fresh-context-recovery-2697/. Keep the public article understandable on its own, including sample sizes, tests, exclusions and limitations in its footnotes. Public links may point to external research, model documentation and official prices; do not publish the supporting CSV/JSON exports, evidence.md or download links. Archive unused mission data in the research workspace too. Keep preview instructions in the private research workspace; do not publish a README alongside the article. Do not create a LinkedIn draft in this mission.

Edit for a human reader: remove generic AI introductions, slogan-like contrasts, manufactured suspense, repeated conclusions, and paragraphs that merely announce the next section. Use concrete behavior and examples rather than abstractions about agentic infrastructure. Technical terms must earn their space. Parallix is the setting, not the sales pitch. Finish with a bounded practical recommendation and its tradeoff, not a claim that the experiment proved the original hypothesis.

## Corrected restart brief: 16 October 2026

The operator clarified that this article covers coding-agent context research,
using PX-0008. Classifier research belongs to TASK-2699 and must stay out of this
article and its retained evidence. The earlier restart's classifier framing
is superseded.

Use the external research workspace's `px-0008/` data: whole-active checkpoint
replays and their incomplete outcomes, matched Qwen checkpoint resets, native
Claude/Codex checkpoint pilots, the completed twenty-pair checkpoint-compaction
comparison, completed rebase pairs and reviewer-context pilot. Preserve the
original repair studies as one part of the broader investigation. Distinguish
retention, prompted compaction, native near-limit compaction and fresh sessions;
keep stage-specific validation and accounting separate. Do not pool reused
missions/models into an independent population or equate active readiness with
accepted quality. Rework the title and argument around the full investigated
scope. Preserve and revisit the four editorial references recorded by the prior
agent. Verify against raw retained data and current main policy; do not run new
trials. Complete the responsive article, source notes, minimal assets, browser
inspection and required gates.

## Factory-first opening: subsequent operator direction

Keep the accepted title, “Keeping, compacting and resetting context for coding
agents.” Redo the article around a strong opening view of the places in the
software factory where context decisions arise, with Parallix as the concrete
example. Restore and retain the original desktop/mobile workflow diagram that
explains implementation, independent agent review, human review, integration
checks and return paths. Place checkpoint continuation, failed-check repair,
rebases, implementer responses to findings and reviewer continuity on that map.
The body must explain how the next job changes the answer, rather than listing
experiments chronologically. Keep the context-only research scope and the four
supplied references; verify and preview the rewritten artifact.

## Out of scope

- Publish, deploy, enable GitHub Pages, change repository settings, or create deployment workflows/configuration
- Post externally, create LinkedIn copy, or promote the article in product docs or the repository homepage
- Rerun empirical trials, use cloud agents for new experiments, or alter historical evidence
- Add a site framework, tracking, analytics, or general blogging infrastructure

## Acceptance criteria

- [x] The primary deliverable is site/articles/fresh-context-recovery/index.html: a complete, responsive, publication-ready article that can be served unchanged from a static host. Markdown alone does not satisfy this mission.
- [x] The article gives an experienced engineer a reason to read within its opening paragraphs, develops one clear argument through documented examples and results, and ends with an actionable recovery decision and its limits. It remains useful without interest in Parallix.
- [x] All empirical figures are verified against canonical records and traceable through the private evidence bundle in ../parallix-research/fresh-context-recovery-2697/. The public article retains its paired setup, sample sizes, tests, exclusions and model limits without shipping data exports or linking to private records.
- [x] The article and results visual clearly distinguish focused-check passes from accepted repairs, prominently report equal accepted counts, and do not imply established causality, statistical significance, or general repair improvement.
- [x] The finished page has been inspected in a real browser at desktop and mobile widths. Text, results, links and assets are readable and usable; semantic structure, alt text where needed, keyboard access and contrast have been checked. Record the preview and observations.
- [x] A final editorial pass removes filler, repetition, unsupported anecdotes and promotional language. Record concrete revisions and remaining editorial uncertainties; review the opening, one case and the conclusion as prose, not merely as a file checklist.
- [x] Local preview instructions work, relative assets and source links resolve, no private/local paths or sensitive transcript data leak into the public page, required docs/static-analysis gates pass, and no external publication or deployment configuration was created.

## Checkpoints

### CP-1

Establish the story from evidence. Verify the paired dataset and acceptance reasons; retain concise private evidence notes. Choose one reader question, a provisional argument, and one or two documented cases. Identify evidence gaps before drafting; do not turn conjecture into fact.

### CP-2

Write and edit the complete article for the reader. Use actual cases and the paired results to carry the argument. Check that the opening earns attention, the negative result changes the conclusion, and every section adds information. Remove template headings, filler and repetition. Keep the prose focused, approximately 1,200–1,800 words.

### CP-3

Produce the finished HTML/CSS article and the minimum useful results visual. Retain reviewer evidence and preview instructions in the research workspace. Serve locally and inspect desktop/mobile in a real browser, including reading the full rendered article and checking all assets. Revise prose and design together; record concrete editorial changes. Run docs and static-analysis gates and report the preview command, article path, verified conclusion and remaining uncertainties. Do not publish.

## Verification

Run `./scripts/verify-local.sh docs` and `./scripts/verify-local.sh static-analysis`. Manually preview and inspect the rendered page as described above. Do not rerun the experiment.
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
