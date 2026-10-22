---
id: TASK-2699
title: an evidence-led Jev article and a minimal Parallix article page
status: done
assignee: [codex]
created_date: '2026-10-09 09:23'
labels: []
dependencies: []
ordinal: 202008
---

## Outcome

Prepare the current author-edited Jev article for independent review as a finished illustrated HTML engineering article, preserving Magnus's approved narrative, workflow explanation and sample-based decision matrix.

The article should help engineers and engineering leaders decide whether bounded Jev re-reviews are useful: approximate Claude API cost, review time, findings and human attention, supported by actual Parallix history. The older execution brief contradicts the operator's later editorial decisions and must not cause reviewers to remove the agreed illustrations, generator or evidence.

## Operator decision — 21 October 2026

This brief and the authoritative `px status task-2699 --json` replace the earlier one-diagram/Markdown-master contract. Magnus has rewritten the article directly. Preserve that HTML and review the current evidence and agreed article design. The earlier checkpoint versions and round-1 findings remain historical records, not instructions to revert the work.

Multiple responsive SVG figures and aggregate JSON/CSV remain intentional public deliverables. The offline Python generator lives in the sibling research directory; only its generated SVGs are published. Python code is not part of the Parallix repository. Do not run a fresh experiment or rewrite the article to manufacture more certain results.

## Editorial follow-up after standard review

The operator authorized selective improvements from the adversarial review, not a new rewrite or the interview questions. Keep the title and core argument; correct unsupported claims, typos and terminology, clarify the panel in methods, and clean public data descriptions without changing measurements. Time saved and the effect on human attention are the main value; API savings can also matter against a token budget. Do not treat the API saving as the whole benefit or invent measured human-time savings.

The standard agent review has passed. Preserve the current integration state and leave the new editorial changes for the operator; do not launch another review or publish anything. This later direction supersedes the earlier instruction to leave the Mission active.

## Timing and monthly budget follow-up

The operator requested the completed timing audit be applied and comparisons changed to monthly budgets. All 25 original Sonnet re-reviews were checked against their raw sessions, 104 message IDs and captured process records. Use the 33.84-second mean reviewer process duration, including tools, startup and shutdown; retain the longest review and its 80-second browser test. The 74-second full-round median includes shared pre-review work and is not time Jev removes. Include Jev evidence preparation in the time projection and disclose the proxies for untimed preparation in methods.

Use an illustrative 800 re-reviews per month (four weeks at the earlier 200/week workload, not an observed monthly rate). The updated comparison is 7.5 vs approximately 5.3 hours of review work and $208.79 vs approximately $134.95: about 2.2 hours (29%) and $73.84 (35%) saved. These remain sample-based projections; human attention is unmeasured. Keep the author’s narrative and opening, with the accounting in footnotes/methods. This update supersedes the earlier weekly and active-time estimates; preserve the integration state and existing gates.

## Scope

The primary deliverable and editorial source of truth is site/articles/jev-review-evidence/index.html as edited by Magnus in this session, with its CSS, responsive SVG figures, aggregate data.json, research-results.csv and minimal site/index.html. These public assets are authorized. Keep the offline Python figure generator outside the Parallix checkout, under /mnt/data/code/parallix-research/jev-article-2026-10-21/figure-source/. It reads the explicit article directory and generates the committed SVGs; no Python source or dependency belongs in the Parallix repository. Multiple substantive figures at ordinary article intervals are required; there is no one-diagram cap. The operator chose relocation of the generator rather than a TypeScript conversion. Preserve the current title, author voice, paragraphs and argument unless a concrete factual, arithmetic, accessibility or rendering defect needs a targeted correction. Results appear early. Time saved and its workflow-dependent effect on human attention lead the economic discussion; API-price savings also matter under token budgets. Keep measured agent time separate from unmeasured human attention. Recover the engineering story from recorded conversations, Git and mission history; old experiments belong in research/methods unless they explain a consequential decision. Do not turn the article into a ledger or internal note.
Use the frozen 114-round comparison: 37 local integration-gate repairs plus4 general re-review clears, 41/114 (36%), 73 general decisions, 41 missions; exclude 7 mechanical restorations. Preserve live/rerun provenance in research/methods rather than making the routing bug the article's organizing distinction. Use an illustrative 800 re-reviews per month for estimates. Matrix cells show the figures; explanations and sample boundaries belong in linked table footnotes. Current estimates are $208.79 vs ~$134.95 API equivalent and 7.5 vs ~5.3 hours of review work (35% cost and 29% time reduction), including Jev evidence preparation. Historical re-review fixes252/786 (32.1%); sample 18 returns/114 plus 1 confirmed miss; sample-based adjusted estimate~31.2%. These are sample estimates, not confidence intervals or population accuracy claims. Human review is retained in both options.
Describe the authorized restored three-question general re-review panel and integration preservation route. First reviews remain general. Show independent agent review, human review, Local integration and a dotted handoff to upstream CI integration. Jev may approve, abstain to the general reviewer, or request changes to the implementer; no returns occurred in this 114-round set. Keep task-2785 r4 as the confirmed repair-introduced duplicate-key miss caught by original-model review/typecheck; task-2792 r2 is the operator-adjudicated reviewer-model-change case, not a wrong clear. Do not reintroduce retired per-obligation/new-defect/orphan questions as current policy.
Private source inventory, claim ledger, raw research, protocols, selected-case adjudications and completion records remain under the existing parallix-research sibling of the primary checkout. The current private CURRENT.json identifies the latest ledger and calculations; historical article builders are obsolete and must never overwrite the author-edited HTML. Preserve limitations in methods without repeating generic caveats through the narrative. The four published article examples already supplied guide plain engineer-to-engineer prose and meaningful visual density; they are not templates or permission for a new rewrite.

## Out of scope

- No src/, web/, application, classifier routing, model pin, prompts, thresholds, packing, tests, dependencies, package manifests or verification-gate changes; TASK-2805 owns the routing restoration separately.
- No model calls, new experiments, threshold tuning, expanded validation cohorts or new safety blockers. Use the recorded research and operator-adjudicated cases.
- No rewriting author-approved prose, resetting the title, enforcing the superseded one-diagram cap, removing authorized aggregate data or discarding the private figure-generation source, sticky illustrations, artificial word/mention quotas, or forcing old negative experiments into the main narrative.
- No raw sessions, private archive paths, credentials or research directories in the public site; no runtime scripts, frameworks, analytics, CMS or new dependencies.
- No publication, deployment, merging or new reviewer launch in this paperwork pass. Preserve TASK-2699's current integration state for the operator's next action; preserve normal configured review and integration gates.

## Acceptance criteria

- [x] 1. The author-edited site/articles/jev-review-evidence/index.html remains the primary article; preserve its title, voice, narrative and conclusions. Keep the minimal site index and static assets. Only targeted corrections supported by concrete evidence are required; no old master draft or builder may overwrite it.
- [x] 2. The article and data consistently report 41/114 (36%) clears: 37 local integration-gate repairs and 4 general re-reviews, 73 general decisions across 41 missions, excluding7 mechanical restorations. Methods preserve the 37 production/4 rerun provenance and matched-review boundaries; no inflated population or independent-validation claim.
- [x] 3. Use an illustrative 800 re-reviews per month and audited mean-based estimates: 7.5 vs ~5.3 hours of review work and $208.79 vs ~$134.95 at Claude API rates (29% time, 35% cost reduction). Include Jev preparation, retries and fallback; disclose untimed preparation proxies and exclusions in footnotes/methods. Figures, prose, JSON and CSV agree. Keep human attention unmeasured; no confidence-interval claim.
- [x] 4. Defect detection means reviews requesting fixes: 252/786 historical re-reviews (32.1%); the 114-round sample has 18 returns and 1 confirmed additional miss; adjusted estimate~31.2%. State sample bounds once with the table. Keep 2785 r4 as the duplicate-key miss and 2792 r2 as reviewer-model-change; do not infer a population error rate or treat every new out-of-repair finding as a wrong clear.
- [x] 5. Keep multiple meaningful responsive SVG figures in normal reading flow, including independent reviewer and human-review roles, repair preservation and Jev routing. Publish the static page, SVGs and aggregate JSON/CSV. Keep the offline Python generator in the sibling research directory, outside Parallix; add no Python dependency. It must reproduce the published SVGs from current aggregate data. The one-diagram restriction remains superseded.
- [x] 6. Workflow prose and figures retain first general review, independent agent review, human approval, Local integration and dotted upstream CI integration. Jev supports approve, request-changes and abstain/general fallback; current general re-reviews use the restored three-question panel. No claim that Jev waives gates, human review or sees the whole repository.
- [x] 7. The article is readable engineering prose with a compact opening, results early, cost-led tradeoffs and only the historical turning points needed to explain decisions. Respect Magnus's revised text and the four supplied article examples. Put tuning details, task IDs, replay provenance and accounting in methods/private records; no internal-note template or repetitive caveats.
- [x] 8. The static page remains responsive and accessible at desktop and narrow mobile widths, with functioning links/footnotes, logical headings and figure alt text; no horizontal overflow or clipped content. Public files contain no private paths, raw traces, secrets or runtime scripts. Focused browser, documentation and applicable static checks have recorded results; normal declared gates remain unchanged.
- [x] 9. The authoritative PX brief, success criteria and a current final checkpoint reflect these operator decisions. Retain previous checkpoints/review history; record the disposition of review findings and generator relocation and current evidence inventory, claim ledger, calculations and checks. Keep the mission in integration for the operator's next action; do not launch review or publish.

## Style references

- https://www.anthropic.com/engineering/multi-agent-research-system
- https://www.lucasfcosta.com/blog/backpressure-is-all-you-need
- https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/wsff.md
- https://imil.net/blog/posts/2026/rtx-5080-+-rtx-3090-setup-80+-tok-s-on-qwen-3.6-27b-q8/

## Review handoff

CP-6 records the current contract and evidence; CP-1 through CP-5 retain the earlier execution history. Read `px checkpoint read --slug task-2699 --name CP-6` and the table footnotes/methods before judging the article. Assess factual, arithmetic, workflow, privacy, rendering and accessibility defects against the current criteria. Changes to Magnus’s title, prose or chosen argument are editorial proposals, not automatic repair instructions.

Keep the existing declared gates unchanged. The operator decides the next action after the editorial follow-up. Preserve the current integration state; do not launch another reviewer or publish anything.
