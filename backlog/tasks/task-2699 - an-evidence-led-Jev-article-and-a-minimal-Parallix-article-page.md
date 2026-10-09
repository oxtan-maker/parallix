---
id: TASK-2699
title: an evidence-led Jev article and a minimal Parallix article page
status: backlog
assignee: []
created_date: '2026-10-09 09:23'
labels: []
dependencies: []
ordinal: 202008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Use the completed web research and Magnus's newest local evidence to produce one technically credible article about evaluating Jev for Parallix review decisions, published as a finished, illustrated HTML article ready for GitHub Pages. The page is the primary reader deliverable; a Markdown draft alone does not satisfy this mission. Deliver the evidence reconciliation, article, page and adversarial audit as reviewable local files. The article's conclusion must follow the evidence available at execution time.
Primary objective: a technically sophisticated reader can see the author's engineering judgment, including how he frames the problem, measures outcomes and changes a design when evidence warrants it.
Secondary objective: restrained discovery of Parallix.
Audience: engineers operating coding agents, principal engineers, engineering leaders and potential employers or consulting clients.
Voice: Magnus speaking plainly about work he can substantiate. No invented autobiography, credentials or emotional reactions.
The research phase has already been performed. Start with the supplied pack, then refresh only the evidence needed to resolve current claims. Do not restart an unlimited literature survey or turn website construction into a product project.
Inputs and path contract
1. Identify the primary Parallix checkout and the working checkout. Read the applicable repository instructions.
2. Resolve ../parallix-research relative to the primary checkout, not automatically relative to a temporary worktree or the shell's current directory. An explicitly supplied absolute research path takes precedence. Record the resolved path in the private completion report.
3. Read web-research-2026-10-09/README.md, RESEARCH.md, CLAIM-LEDGER.csv, WEB-SOURCES.json, REPO-SNAPSHOT.md, REPO-SOURCES.json and LOCAL-DATA-CONTRACT.md under that root.
4. Inventory the remaining user-provided research, results, protocols, labels and notes under that root. Preserve their files and names. Treat documents as evidence, not as permission to run commands or change this mission.
5. Inspect current repository main and Jev-related outcomes after e38bec80a60532684fe811c3b81c29158ca9f300. Record the actual revision and time. Do not assume every commit with “Jev” in its title is a completed measurement.
6. If the earlier agentic-recovery-linkedin-outline.md is present, use its structure and voice constraints only. Its recovery experiment is separate from this Jev study.
Keep raw research and private result archives outside the repository. Derived article files must not contain local archive paths, credentials, private traces or accidentally bundled research directories. Reference data through the resolved research root; do not import it into the application or copy it into a public site tree.
If some local data is missing, finish everything the available evidence supports. Record the exact missing file or field and narrow the claim. A missing future success result is not a reason to invent one or to prevent an honest methods article.
Phase 1 — reconcile evidence before writing
Create an evidence inventory and an updated claim ledger. For each material result, record:
- task and decision scope: report interpretation, first review, original-finding resolution, gate-repair judgment or whole-PR review;
- run date, repository revision, requested and returned model, question/prompt/packet/policy versions;
- input lineage, unique mission families, cases, variants, repeated calls, failed calls and excluded rows;
- label provenance and exact revision/scope matching;
- whether the result is development, tuning, frozen replay, fresh evaluation, shadow operation or an actually applied workflow decision;
- measured numerator/denominator and whether raw data, only a summary, or only recollection is available.
When reporting useful automation, distinguish proposed routing coverage from actually avoided general reviews. Show the eligible population and exclusions, and retain provider failures and context fallbacks in the relevant denominator. For any false-pass claim, report total passes, passes whose correctness was adjudicated, incorrect adjudicated passes and unadjudicated passes. State how adjudicated cases were selected. A rate on adjudicated passes does not describe all passes unless that inference is justified. Where only historical reviewer decisions exist, report comparator agreement. Missing labels or event telemetry should narrow the claim, not trigger an unrequested experiment.
Compute aggregates from available raw rows when practical. Preserve the committed aggregate if the raw rows are unavailable, label it as reported, and record the limitation. Never manufacture an exact raw-data reconstruction from a rounded table or claim to have rerun an experiment you only read.
Keep a short discrepancy log. Resolve factual conflicts through the original records and revision history. A newer report can supersede an operational state; it must not erase an earlier negative experiment. Use dated stages when methods changed.
Mandatory starting-state distinctions
The supplied snapshot contains all of the following; recheck them before relying on them:
- TASK-2692's frozen comparison has 120 evaluation rows from 10 families, four arms and three repetitions. There were 108 API attempts, 87 model responses, 21 provider rejections and 12 local size fallbacks. Every row retained general review. This was not 120 independent PRs or 120 successful model calls. [R01]
- A token-aware follow-up made 33 successful replacement calls, while the completed 120-row comparison still had no useful routes. Complete original failure capture had been unavailable; do not describe that arm as a successful full-trace intervention. [R01]
- A later operator-authorized implementation changed the prompt, repair packing and routing thresholds. Its final replay had 11 studied cases and 33 calls. Twelve calls had exact historical approval comparators; eighteen had historical rejection comparators; three had no exact comparator. It is not fresh independent validation of the selected policy. [R01]
- Report-label interpretation, including local Kev, is a different task from patch correctness. Keep model identity and timing populations separate. [R09–R12]
- Historical 14.7% estimates and a timing comparison that skipped zero actual reviews do not establish a measured Jev workflow speedup. [R08, R10]
- First-review eligibility and repair policy changed after the original study. Historical scope guards and old “no production changes” language must not be presented as current behavior without checking source. [R14–R20]
These are evidence constraints, not a predetermined negative verdict. New data may strengthen, weaken or replace the current interpretation.
Phase 2 — choose the argument from the strongest evidence
Compare three possible lead questions:
1. Evidence construction: What must a bounded review packet contain, and what does the harness do when it cannot provide it?
2. Useful automation: How many decisions can the tested policy handle, with what observed bad passes, bad returns and abstentions?
3. Workflow economics: Does the complete path reduce elapsed review time or total work at the quality bar the operator actually chose?
Choose one spine. Explain why the other two are supporting questions or remain open. Do not score novelty with fabricated numbers. Do not select the most dramatic headline and retrofit the evidence.
The current pack recommends an evidence-construction lead. A particularly defensible example is the byte-budget/token-budget problem followed by successful requests that still did not produce useful routes. Use the later tuned replay as a separately dated stage. A fresh local example with inspectable inputs and independently checked outcomes may be stronger.
Write a brief argument note before full prose: observation; plausible interpretation; design response; observed result; limitation; transferable engineering decision. Distinguish these six parts even if the final article expresses them in connected prose.
Phase 3 — draft one article
Start with a sourced event, a concrete decision or a compact empirical result. Explain why the original approach was reasonable using documented rationale, not reconstructed motives. Show the mechanism and the key tradeoff. Place the most important limitation beside the result it limits. End with a useful design or measurement decision supported by the case.
Editorial direction from Magnus's review of TASK-2697
The deliverable must read like an engineer's published article, not an internal mission note, audit report or research ledger. Use the real conversations, Git history and mission records to recover concrete decisions and their rationale, while respecting the evidence and first-person constraints below. Keep reconciliation tables, task IDs, audit mechanics and completion bookkeeping in the private report unless a detail is essential to understanding the result.
Build the story from what actually happened in Git history, mission logs and the recorded conversations: the initial approach, the concrete failure or unexpected result, the decision it prompted, and what happened after the change. Select only the turning points that explain the central engineering decision. Connect them with short causal transitions so the reader can follow why one step led to the next; do not substitute a commit-by-commit chronology or a list of findings for a narrative. Verify ordering and rationale from the records, distinguish documented reasons from interpretation, and preserve negative results that explain the next move. Weave this story into the problem, mechanism and results sections rather than adding a separate history section. Improve flow by replacing disconnected exposition with these concrete events, not by expanding the word count. Keep results early; unfold additional history beside the result or mechanism it helps explain.
Read these four examples before drafting. Study how they move from a concrete problem to mechanism and evidence, and how figures support the reading flow; do not copy their prose or impose a common template:
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://www.lucasfcosta.com/blog/backpressure-is-all-you-need
- https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/wsff.md
- https://imil.net/blog/posts/2026/rtx-5080-+-rtx-3090-setup-80+-tok-s-on-qwen-3.6-27b-q8/
Keep the opening and initial explanation short enough to reach the first substantive result within roughly 300 words. Use a heading that announces the result plainly, rather than making readers guess whether another methods section follows. Preserve useful narrative and technical explanation, but cut any section that delays the evidence without changing its interpretation. Do not stretch the article to a word target.
For Jev's economics, lead with approximate API costs and the quality or accepted decisions obtained for that cost, rather than raw token consumption. Estimate the Codex/Claude API cost of historical review workloads from their recorded token consumption, using explicitly named models and dated, verified official API prices. Treat this as a pricing estimate on historical workloads, not an observed bill or proof that another model would use identical tokens or reach the same decisions. Separate uncached input, cached input and output where the historical counters and the relevant pricing support that distinction; do not assume missing cache usage or silently apply subscription prices. Retain the token counts, rates, currency, calculation and missing fields in the supporting evidence so the estimate is reproducible. Show what Jev could replace, what still reaches general review, and the cost of Jev, retries and fallback where measured or estimable; distinguish gross avoided API cost from net savings and actual avoided reviews from hypothetical routing. If a component cannot be priced, identify it and narrow the total rather than inventing it. Elapsed time is supporting evidence, especially where it depends on Parallix scheduling or local hardware. Keep the public explanation short and the detailed accounting in the appendix or private ledger.
Use the outline in RESEARCH.md only where it serves the chosen argument. Section purpose, evidence and overclaim analysis belong in planning notes, not as a visible form in the article. Each retained section must answer a new reader question. A vivid UI anecdote or code excerpt earns space only if it explains the central result or a consequential design decision.
Remove empty transitions such as “There are important limits.” State the material limitation directly beside the affected claim, once. Avoid repeated caveats, methodological throat-clearing and generic conclusions. End with the actual engineering decision the evidence supports, including an unresolved alternative when relevant.
Keep a source-bearing master article. Use direct links for factual claims and exact commit permalinks for repository evidence. Prefer a small number of well-chosen sources in the reading flow, with methodological details and other sources in a compact appendix. Internal source IDs alone are insufficient for the public article.
Guardrails against agent slop
A. Claims must be earned
- Every quantitative claim needs the actual numerator, denominator, unit, sample scope, method and source. Include an interval only when its method and assumptions are defensible.
- A probability-like model score is not a measured probability of correctness. An operator-selected cutoff is a policy, not a calibration certificate.
- Zero observed bad passes in a small or reused sample is not a zero production error rate. Repeated calls do not turn a few families into many independent observations.
- Historical reviewer agreement is agreement with a comparator. It becomes correctness evidence only to the extent that the exact obligation and revision have been adjudicated.
- A passing test establishes the behavior covered by that check at that revision. A lifecycle fixture establishes a working integration path on its fixture. Neither proves general PR correctness.
- A model response, a routing recommendation, a published verdict and an avoided review are different events. Never silently substitute one for another.
- “No finding,” “insufficient evidence,” “provider error,” “context fallback,” “return to implementer,” and “clear the scoped obligation” are not interchangeable labels.
- Do not merge report interpretation, finding closure, gate repair and first-review results into one accuracy figure.
B. Preserve counterevidence and alternative explanations
- Keep the frozen negative result visible even if a later configuration works.
- Do not credit context alone when prompt, selected examples, model, thresholds or scope changed too.
- Distinguish transport acceptance from decision quality; distinguish changed question wording from added information.
- If a source reports a fast call but no quality-matched workflow measurement, report exactly that scope.
- If routing falls back often, include its added work. A hypothetical perfect fallback selector is not an observed cascade.
- Use the same start/end boundary and a matched workload for elapsed-time comparisons. Include preparation, provider retries and additional review reached through fallback. Record batching and concurrency differences. Do not sum overlapping parallel durations and call the result wall time. If only call timings or an offline cascade are available, leave full workflow latency unknown.
- Include the strongest relevant objection and answer it with evidence or a precise open question. Do not create an easy straw man.
- Publish a mixed or negative conclusion when warranted. Do not keep expanding the search, tuning thresholds or changing endpoints until a positive story appears.
C. Treat context neutrality as a testable design objective
- Preserve the original requirement and complete obligation being judged. Source repository rules from the applicable trusted revision.
- Identify review targets separately from supporting context. Bind code, tests and diagnostics to explicit base/head revisions.
- Keep the implementer's explanation visibly labelled as a claim. Do not silently turn persuasive prose or an agent's “done” message into verified evidence.
- Record selection, truncation and omitted material. Never describe a packet as complete merely because it fits a limit.
- Apply packet construction before seeing the answer. Do not choose passages because they make a desired verdict likely.
- Delimiters, JSON, ASTs and deterministic selectors do not prove neutrality or resistance to misleading text. Avoid those claims.
- To claim a causal packaging effect, require controlled add/remove or equivalent perturbation evidence with the question, policy, labels and model fixed. Otherwise describe the observed bundle of changes.
- A precomputed test or behavioral trace may provide new information; it must not be passed off as a pure formatting improvement. Account for its acquisition cost.
D. Evaluation must not leak its answer
- Keep target labels, later reviewer decisions, fix commits and developer reference patches outside the model-visible packet unless the study is explicitly reference-assisted.
- Keep earlier findings that genuinely define the re-review obligation; remove later answers that reveal the expected verdict. Record this distinction.
- Preserve development/test family separation. A selected-threshold replay is tuning evidence even if called “validation” in a filename.
- Record whether the packet builder, selection rules, examples or thresholds were developed after inspecting the evaluation families or expected outcomes. Freezing execution does not make previously inspected cases unseen. Reserve an independent-evaluation claim for cases withheld from those design choices.
- Retain errors and missing contexts in the appropriate coverage denominator. Report successful-call quality separately if useful, without hiding the full population.
- Treat disagreements as cases to adjudicate. Do not assume either Jev or the larger LLM is correct because of model size, author preference or majority vote.
- Do not call new models or run a paid benchmark as part of this writing mission. Identify a concrete additional experiment only if a central claim depends on it; do not silently expand scope.
E. Sources must support the actual sentence
- Prefer official implementation/docs, original papers and the experiment author's report. Mark vendor claims, preprints and anecdotes as such.
- Cite a paper for the task it studied. A classification, simulation or comment-generation result does not establish autonomous PR approval quality.
- A Hacker News comment shows that a named participant asked a question or reported an experience. It does not measure market demand, prevalence or product accuracy.
- Check the primary body before quoting or using a number. Inaccessible leads remain unverified; do not launder search snippets or another agent's summary into verification.
- Confirm identity. Similar-looking Jev domains and similarly named GitHub organizations are not automatically official TypeSafe sources.
- Never fabricate titles, authors, links, dates, quotations, source contents or citations. Recheck living documentation when a current specification matters.
- Do not dump paper abstracts into the article. Synthesize only what changes the reader's understanding of this case.
F. No fabricated personal authority
- First-person statements must come from Magnus's records or supplied account. Do not invent a late-night debugging scene, frustration, surprise, dialogue, customer story or decision rationale.
- Attribute an agent-written task report as a record where relevant. Do not imply Magnus personally inspected each event unless documented.
- Separate what the author observed from what the article infers. Do not infer hidden model cognition from outputs.
- Do not inflate a dogfood experiment into production use at scale or imply external customer adoption.
- Do not claim scientific novelty, state of the art, a benchmark record or general superiority without a review that supports that precise claim.
G. Prose must carry information
- Use connected paragraphs, concrete nouns and active verbs. Explain one mechanism in enough detail that another engineer can question or reproduce it.
- Remove generic openings about how fast AI is changing software and generic endings about the future.
- Remove influencer cadence, rhetorical question/answer tricks, repeated one-line paragraphs, manufactured suspense, forced three-part lessons and self-congratulatory leadership claims.
- Avoid “game changer,” “10x,” “unlock,” “revolutionary,” “delve,” “leverage,” “in today's landscape,” “the future is,” and similar filler. A banned-word scan is a first pass, not a quality test.
- Do not make a paragraph sound more senior by adding abstractions such as “orchestration layer” when “the code that builds the packet” is what it means.
- Do not repeat the thesis in the opening, each heading, a callout and the conclusion. Spend those words on the case and its limit.
- Avoid an unrequested tutorial, glossary, shopping list of tools, generic best practices or an SEO FAQ appended to thin evidence.
H. Keep the article useful without the product name
- Parallix identifies the experiment; it is not the argument. One natural introduction and one restrained footer/link are enough unless a specific technical detail requires another mention.
- No feature catalogue, install CTA, signup funnel, adoption claim or comparison designed to belittle competing tools.
- If removing “Parallix” leaves no concrete engineering decision, rewrite the article.
- If removing “Jev” leaves only generic “context matters” advice, add the specific task, packet boundary, result and uncertainty that make this study worth reading.
Phase 4 — build a small article page
Inspect the existing repository's publishing conventions first. Reuse them if present. Otherwise create a self-contained static article under a clearly scoped directory such as site/articles/jev-review-evidence/. Choose the smallest equivalent path compatible with the repository; do not reorganize unrelated documentation.
Produce semantic HTML and restrained CSS with readable typography, good mobile wrapping, source links, author attribution, publication/update dates and accessible figures integrated throughout the article. A small index linking the article is sufficient. Use a real final URL for canonical/social metadata only when the destination is known; otherwise record the pending configuration rather than inventing it.
Keep page-building to a short session, approximately two hours as an effort cap. If an existing stack makes that impractical, deliver the article and plain static page draft and state the specific remaining deployment step.
Do not add a CMS, framework migration, dependency tree, newsletter service, analytics integration, payment flow, bespoke design system or full Parallix marketing site for one article. Do not modify review logic, gates, tokens, thresholds, application dependencies or test infrastructure to make the article appear complete.
Visual density is part of the article, not optional decoration. Aim for a meaningful figure to be visible through most of an ordinary desktop reading scroll, with several distinct inline figures distributed alongside the relevant paragraphs. Achieve this by shortening prose and illustrating different mechanisms, examples and results. Never simulate density with sticky/fixed pictures, scrolling sidebars, repeated figures, oversized empty diagrams or decorative filler. Keep normal document flow and verify the actual reading experience on desktop and mobile; do not enforce a brittle every-pixel viewport quota.
Use original SVG diagrams or reproducible data charts as appropriate. The early figure should explain the relevant top-level workflow beside the opening paragraph; later figures should expand the decision or evidence boundary and show the measured outcomes. Every figure must convey something the reader can use, with readable labels, a caption and alternative text. Simple active-agent/reviewer icons inside boxes can help distinguish actors, but arrows must explain who hands what to whom and what causes a return or fallback.
Explain enough of Parallix's defences to make the problem understandable without cataloguing every safeguard. Distinguish implementation, independent review by another agent, Human review, and Integration checks. In Parallix the integration lane includes human-in-the-loop review; Integration checks follow human approval. Do not label human review simply “Integration,” repeat “checks” across a box title and subtitle, or imply model approval replaces the human. Verify the Jev decision's actual position, scope, fallback and return path against current source. Separate implemented flows from proposals. Show only states relevant to this article, including where a defect can be caught or escape.
Visuals must clarify an evidence path or a measured comparison. Show missing-context fallback explicitly if the diagram describes classification. No decorative robots, brains, glowing nodes, gradients posing as a technical diagram, fake dashboards or metric cards without data. A schematic must not look like an implemented architecture if it is only a proposal.
Keep raw evidence outside the public tree. Publish only deliberate, redacted examples whose meaning survives the redaction. Give any chart its denominator and scope, and distinguish hypothetical illustrations from observations.
Phase 5 — adversarial review and verification
Run separate evidence and editorial reviews. Parallel reviewers may help, but agreement among them does not validate a fact. Resolve each material finding against a source or revise the prose.
Evidence reviewer: find denominator errors, answer leakage, scope mismatch, unsupported causality, undisclosed tuning, missing failed attempts, stale model/policy claims and unjustified workflow savings.
Senior-engineer reviewer: identify the real engineering decision, the strongest alternative explanation and the missing detail needed to assess it. Flag generic content that could describe any agent project.
Editorial reviewer: remove invented experience, promotional language, repeated conclusions and jargon. Check that the article presents one connected argument and that limitations are visible without overwhelming it.
For each substantive audit finding record the passage, reason, supporting source, correction and final disposition. Do not merely write “passed all guardrails.” If a central claim cannot be supported, narrow the thesis and complete the deliverable in that narrower form.
Verify numbers from available rows, source links and revision links, article/page consistency, and that no private data or research files enter the public directory. Render the page at narrow and wide widths; check heading structure, contrast, table overflow, keyboard navigation and diagram alternative text. Read the rendered page end to end as an external engineer: confirm the results arrive early, figures explain distinct points throughout the scroll, and the narrative stands without the private audit. Use existing lightweight checks. Do not create an elaborate test suite for a prose/static-page change.
Deliverables and acceptance
Save private research reconciliation under the resolved research root, in a new dated output directory. Save only the intended public article/page files in the scoped repository directory or an external publication-draft directory if repository writes are unavailable.
Required outputs:
1. Updated evidence inventory and claim ledger, including exact snapshot/model/policy versions and missing data.
2. Three thesis candidates with an evidence-based selection and a section outline using purpose/claim/evidence/overclaim limits.
3. Final article source and the static article page; source appendix and a compact author footer.
4. Several purposeful inline figures covering the relevant workflow, decision/evidence boundary and measured results; data and generation source for quantitative charts. No fixed one-diagram quota and no artificial scroll-persistent illustration.
5. Adversarial-review record showing concrete corrections and any unresolved claim boundary.
6. Completion report: selected thesis, strongest original evidence, strongest external support and counterevidence, material limits, files changed, checks actually performed and exact publishing steps remaining.
Completion requires a useful, reviewable artifact, not a positive Jev result. Do not enable hosting, publish, merge, post to LinkedIn or send messages as part of this mission unless Magnus separately instructs that action. Prepare the concrete files first so any later publishing decision concerns a finished result.
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
