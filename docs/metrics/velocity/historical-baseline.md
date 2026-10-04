# Historical manual baseline

This retained evidence records the bounded historical source behind the reference line in the throughput graphic. It is preserved here so the baseline remains inspectable from a normal repository checkout; it does not require a local historical Git object.

## Source context and provenance

The source was the **AI Workflow Retrospective — October 2025 to March 2026**, generated on 2026-03-28 on branch `mission/ai-workflow-retrospective-since-october`. Its Section 2.1 recorded the human-only comparison period, and its H0 baseline paragraph recorded the cluster names below. The source described this as a human-only active period in the predecessor repository's 2022 Git history, before the present Parallix workflow and its lifecycle records existed.

This file is a faithful retained extract of the facts used by the graph, not a reconstruction of dates or weekly observations. The historical source was previously at `docs/missions/2026/ai-workflow-retrospective-since-october/RETROSPECTIVE.md`, Section 2.1 and H0, in commit `ba7d445e246bec73c65762da23ae266657eecf73`.

## Retained observation

The source counted nine coherent work clusters from 2022-08-16 through 2022-09-16, an inclusive 32-day observation window. It named these clusters:

1. Redux migration
2. task/UI
3. iOS/throwaway hardening
4. Android mobile
5. Mixpanel analytics
6. shelf/store CRUD
7. inflation/price features
8. Fitbit improvements
9. landing page redesign

The source also reported 68 commits across those clusters. Commits are supporting provenance, not the unit being graphed: one delivery unit is one coherent historical work cluster. The retained source does not provide defensible per-week dates for the clusters, so this evidence intentionally does not turn the aggregate into weekly observations.

## Calculation and limits

The reference rate is `9 / 32 × 7 = 1.96875` delivery units per week, rounded to approximately 2 in the simple graphic. It is an observational aggregate from an earlier product phase and codebase maturity, not a controlled benchmark, causal claim, or productivity multiplier.

The current series records completed Parallix missions; this baseline records predecessor work clusters. Both are delivered engineering work observed by the same maintainer, but their size and difficulty are not identical. The graph therefore uses the historical value only as a labelled reference line.
