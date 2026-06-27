# Mission: Research per-mission change-size budget — metric, threshold, and breach action (task-1355)

## Goal

Produce a findings document that recommends (a) which metric to use for measuring per-mission change size (net lines, files touched, hunks, or cyclomatic complexity delta), (b) at what point in the mission lifecycle to measure it (draft prediction vs handoff actual), (c) what threshold to apply, and (d) what action to take on breach (hard block, warn+override, force decomposition into sub-missions, or escalate review depth). The recommendation must be evidence-based, grounded in the hypothesis from TASK-1267 that smaller missions correlate with fewer defects, and explicit about why agent up-front size estimation is unreliable.

## Why Now

TASK-1267 hypothesized that reducing mission size increases quality controls, proposing a <1000-row ceiling. Parallix now has three enforcement gates in flight (TASK-1268 shift-left verification, TASK-1353 deterministic static analysis, TASK-1354 regression-test-first for bug missions) and a project-wide Definition-of-Done defaults mission (TASK-1357) approaching completion. Without a researched, evidence-based change-size budget, any future gate that enforces it would rest on a guessed threshold and an undefined breach response — making the guardrail either useless (too loose) or counterproductive (too blunt, forcing artificial decomposition). The research must land before any implementation gate is built, so the design decisions are locked in first.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: hypothesis from TASK-1267 needs evidence-based grounding; three enforcement gates nearing completion create urgency to define the size-budget discipline before any gate enforces it.

## Scope

- Review the hypothesis from TASK-1267 ("reduce mission size to increase quality controls", proposed <1000-row ceiling).
- Analyze available metrics for measuring per-mission change size: net changed lines, files touched, hunks, cyclomatic complexity delta. Assess each for: ease of computation, ability to be gamed, correlation with review effort, and relevance to defect detection.
- Determine the measurement point: draft (predicted, unreliable per TASK-1355 description) vs handoff (actual, but potentially too late to decompose cheaply). Justify the choice.
- Propose a breach-action taxonomy and recommend one: hard block, warn+override, force decomposition into sub-missions, escalate review depth (multi-pass review), or do not implement. Include justification for why the rejected options are inferior.
- If archived mission data is available in this repository, attempt a preliminary correlation analysis between diff size and defect rate to inform the threshold. If insufficient data exists, state the limitation explicitly and recommend collecting data before setting a numeric threshold.
- Produce a single findings document (markdown) covering all four areas above.

## Out of Scope

- Implementing any change-size budget gate or enforcement mechanism.
- Writing code, modifying configuration, or changing any workflow scripts.
- Setting a numeric threshold based solely on intuition without data support.
- Analyzing metrics outside the four candidates (lines, files, hunks, complexity delta).
- Modifying any existing gate implementations (TASK-1268, TASK-1353, TASK-1354).
- Creating new milestones, tasks, or backlog entries beyond the findings doc.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- **SC1:** A findings document exists at `missions/task-1355/findings.md` (or equivalent path under the mission directory) with content covering all four research questions from the backlog task description. Falsifiable: file does not exist or is missing any of the four sections.
- **SC2:** The document recommends exactly one metric from the four candidates (net lines, files touched, hunks, cyclomatic complexity delta) and provides a rationale comparing the chosen metric against the other three. Falsifiable: document recommends zero metrics, more than one, or a metric outside the four.
- **SC3:** The document recommends exactly one measurement point (draft or handoff) with a rationale that explicitly addresses the trade-off between prediction reliability and decomposition timeliness. Falsifiable: document omits a measurement-point recommendation or fails to discuss both trade-offs.
- **SC4:** The document recommends exactly one breach action from the taxonomy (hard block, warn+override, force decomposition, escalate review depth, or do not implement) and explicitly explains why each of the other four options is rejected. Falsifiable: document recommends zero or multiple breach actions, or fails to address all five options.
- **SC5:** The document explicitly addresses why agent up-front size estimation is unreliable, citing at least one concrete reason (e.g., agents lack historical diff data, prediction variance exceeds 30%, agents optimize for optimistic estimates). Falsifiable: document makes no mention of agent estimation unreliability.
- **SC6:** If archived mission data is found and analyzed, the threshold recommendation is supported by at least one quantitative finding (e.g., "missions exceeding X lines had Y% higher defect rate"). If no data is available, the document explicitly states this limitation and recommends a data-collection step before threshold implementation. Falsifiable: data exists but no quantitative finding is cited, or data is unavailable but the document silently proposes a threshold anyway.

## Risks and Assumptions

- **Risk:** Insufficient archived mission data to support a data-driven threshold. Mitigation: the document must explicitly state this and recommend data collection; the recommendation should not rely on an arbitrary number.
- **Risk:** Net lines (the simplest metric) is easy to game (e.g., whitespace changes, commented-out code). Mitigation: evaluate all four metrics and justify why the chosen one is harder to game than alternatives.
- **Risk:** Handoff measurement (actual size) may be too late to decompose a mission cheaply. Mitigation: the document must assess whether handoff measurement is viable or whether a predictive approach with guardrails (e.g., confidence intervals on agent predictions) is preferable.
- **Risk:** A hard block on breach could disrupt ongoing missions. Mitigation: the document should consider graduated responses (warn first, block only on repeated breaches) if recommending any enforcement mechanism.
- **Assumption:** The findings document will be reviewed by the mission operator before any downstream implementation decisions are made.
- **Assumption:** TASK-1267's hypothesis (<1000-row ceiling) is the starting point for analysis but is not assumed correct — the research may reject it entirely.
- **Assumption:** The four metric candidates (lines, files, hunks, complexity delta) encompass the relevant design space for a change-size budget.

## Checkpoints

- **CP 1:** Metric analysis complete — all four candidates evaluated against ease-of-computation, game-ability, correlation with review effort, and relevance to defect detection, with the chosen metric justified.
- **CP 2:** Measurement point and breach action decided — the document recommends one measurement point and one breach action, each with explicit rejection of alternatives.
- **CP 3:** Findings document complete — all four sections written, reviewed for clarity, and committed under the mission directory. Data-driven threshold supported by quantitative evidence (if data available) or data-gap acknowledged (if not).

## Gates

- [ ] ./scripts/verify-local.sh docs

## Restricted Areas

- Do not modify any source code files in `lib/`, `tools/`, `scripts/`, `prompts/`, `templates/`, or `config/`.
- Do not modify any existing backlog tasks, milestones, or configuration files.
- Do not run `npm test` beyond the single gate check at the end of the draft phase.
- Do not create new files outside the mission directory (`missions/task-1355/`).
- Do not implement any enforcement mechanism, gate, or workflow change.

## Stop Rules

- Stop if the research reveals that no single metric from the four candidates is clearly superior — in that case, recommend a hybrid approach or a decision framework rather than forcing a single choice.
- Stop if the findings document reaches the conclusion that the change-size budget should not be implemented at all — this is a valid deliverable per the backlog task description.
- Stop if archived mission data is insufficient to draw any meaningful correlation — flag the gap and recommend data collection before threshold implementation.
- Stop if the recommended breach action would require modifying workflow scripts or gate infrastructure — escalate to a separate implementation task rather than expanding scope.
