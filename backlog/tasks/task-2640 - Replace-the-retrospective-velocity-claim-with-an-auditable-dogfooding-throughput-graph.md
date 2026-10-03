---
id: TASK-2640
title: >-
  Replace the retrospective velocity claim with an auditable dogfooding
  throughput graph
status: backlog
assignee: []
created_date: '2026-10-03 15:35'
labels: []
dependencies: []
ordinal: 158008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Dependency

Run this mission after the review/stats/active architecture wave.

The implementation must consume the resulting canonical application/statistics boundary.

Do not create a new dependency on the current large `stats.ts` adapter merely because it exists today.

---

# Goal

Replace the README's prose claim:

```text
+57% to about an order of magnitude
```

with a simple visual built from real observed data:

```text
manual-coding baseline
vs.
actual completed Parallix missions per week
```

The graph should make the observed throughput visible without converting one maintainer's dogfooding data into a universal productivity claim.

The data, definitions, and graph-generation code must be inspectable.

The desired credibility model is:

> Here are the observations. Here is exactly how they were counted. Draw your own conclusion.

---

# Product intent

Parallix exists partly to let one engineer keep more trustworthy work moving concurrently.

It is therefore legitimate to show whether throughput changed in the repository where Parallix is itself developed.

It is **not** legitimate to present that observation as:

- a controlled benchmark;
- proof of causation;
- an expected customer uplift;
- a universal multiplier.

The README should sell the throughput hypothesis by exposing the evidence rather than by strengthening the prose.

---

# Mission 0 — Validate the baseline before building anything

Locate the real data behind the historical manual-coding baseline used in the earlier internal retrospective.

Do not use the existing README percentages as a source.

Determine:

- exact dates covered;
- each observation available;
- what counted as one delivered unit;
- whether observations are weekly or can legitimately be grouped weekly;
- whether the baseline counted all work or only a classification such as `user_value`;
- whether the work occurred in the same repository/product context;
- whether incomplete weeks were included;
- whether the original data is still auditable.

## Hard stop

If the underlying manual baseline cannot be reconstructed from actual recorded observations or an authoritative retained dataset:

**STOP.**

Report what is missing.

Do not reverse-engineer a baseline from:

```text
+57%
10x
README prose
memory
desired outcome
```

Do not manufacture historical weekly observations from an average.

If only an honestly recorded aggregate baseline survives, it may be shown as an aggregate baseline, but it must be labelled as such and must not be represented as weekly raw observations.

---

# Canonical Parallix throughput population

Use the same lifecycle-completion authority used by Parallix's mission-flow / board metrics after the architecture wave.

Today that concept is represented by the mission-outcome population behind the metrics projection, rather than by telemetry measurement rows.

Preserve that distinction.

A completed mission is a **lifecycle outcome**, not:

- an agent invocation;
- a checkpoint;
- a telemetry record;
- a review round;
- a commit that happens to contain a task ID.

Do not count Git commits as missions merely because doing so is easier.

Do not count agent telemetry rows as completed work.

---

# Define the comparison before rendering it

The manual baseline and Parallix series must measure the same thing.

For example, if the historical baseline counted only user-value work, then:

```text
manual user-value deliveries/week
```

must not be compared against:

```text
all Parallix missions/week
```

including internal SDLC/refactoring missions.

Likewise, if the baseline genuinely counted all delivered work, use that definition for both periods.

## Required rule

Choose the narrowest metric that is actually comparable.

If no apples-to-apples comparison can be established, STOP and document the mismatch instead of drawing the baseline line.

---

# Weekly aggregation

Use the repository's existing canonical week/window semantics if one exists after the stats refactor.

Otherwise define one deterministic convention and document it.

Preferred fallback:

```text
ISO week
Monday 00:00 through Sunday 23:59:59
UTC
```

Requirements:

- use only complete weeks for headline comparison;
- omit the currently incomplete week from the README graph;
- include zero-delivery weeks between the first and last included observation;
- do not silently omit low weeks;
- do not choose the start date based on where the result looks best;
- include all trustworthy Parallix weeks from the beginning of the valid measurement period through the latest completed week.

If an instrumentation/migration boundary makes older weeks unreliable, show or document that boundary explicitly.

---

# Visual design

Keep the graph deliberately simple.

Preferred form:

```text
weekly completed units
│
│            █
│      █     █ █
│  ───────────────── manual baseline
│ █  █   █ █     █
└──────────────────────── week
```

If individual manual-coding weekly observations exist and are comparable, prefer showing those actual observations rather than hiding their variance behind only an average.

A particularly strong presentation would be:

```text
manual period             Parallix period
actual weekly observations | actual weekly observations
                            ↑
                     Parallix introduced
```

with an average manual-baseline reference line if helpful.

Do not add:

- percentage uplift labels;
- `10x`;
- trend extrapolation;
- forecast lines;
- polynomial fits;
- cherry-picked moving averages;
- decorative gauges;
- benchmark scores.

The y-axis is simply:

```text
Completed missions per full week
```

or the more precise comparable unit discovered in Mission 0.

---

# README placement

Put the graph close to the throughput argument in `## Why Parallix?`.

Do not bury the principal evidence at the bottom of the README.

Remove the existing paragraph under `## Use cases` that advertises the internal retrospective as:

```text
+57% ... to about an order of magnitude
```

Do not replace it with a new numerical marketing sentence.

Use only a short factual caption around the graph.

Suggested semantic content, not mandatory wording:

```text
Observed dogfooding throughput on Parallix itself.
Manual baseline and weekly Parallix outcomes use the same delivery definition.
This is maintainer data, not an external benchmark.
```

Link the methodology/data so an interested reader can inspect it.

The graph should do most of the communication.

---

# Evidence artifacts

Create a small committed evidence surface, for example:

```text
docs/metrics/velocity/
  README.md
  weekly.json

docs/assets/
  velocity-throughput.svg

scripts/
  export-readme-velocity.ts
  render-readme-velocity.ts
```

Exact names may change if the repository has an established convention.

## `weekly.json`

Commit only aggregate/non-sensitive observations needed to reproduce the graph.

It should include enough metadata to understand the dataset, for example:

```json
{
  "metric": "completed comparable missions",
  "weekConvention": "ISO week UTC",
  "baseline": {
    "source": "...",
    "definition": "...",
    "from": "...",
    "to": "..."
  },
  "parallix": {
    "source": "canonical lifecycle mission outcomes",
    "through": "..."
  },
  "weeks": []
}
```

Do not export:

- prompts;
- private task contents;
- tokens unnecessarily;
- local paths;
- credentials;
- raw SQLite state.

---

# Separate export from rendering

The local Parallix database is operator state and will not exist on a clean GitHub CI runner.

Design accordingly.

Use two distinct operations:

## Export

Something equivalent to:

```text
npm run docs:velocity:export
```

reads the canonical local lifecycle outcomes and writes/updates the committed aggregate snapshot.

This is an explicit maintainer action.

It may require the normal local Parallix state.

## Render

Something equivalent to:

```text
npm run docs:velocity:render
```

reads **only the committed aggregate snapshot** and deterministically generates the chart.

CI must therefore be able to verify the visual without access to the operator database.

## Verify

Add a deterministic verification path that regenerates the graph from the committed aggregate snapshot and fails if the committed asset differs.

Do not hand-edit the generated graph.

Do not create a second production statistics authority for this feature.

---

# Keep chart tooling lightweight

Prefer a deterministic generated SVG using the existing Node toolchain.

Do not add a runtime charting dependency to Parallix for one README asset.

Do not add a browser application just to render the graph.

The artifact should have:

- readable axes;
- readable week labels;
- explicit baseline label;
- sensible dimensions on desktop/mobile;
- no unnecessary visual effects;
- meaningful alt text.

---

# GitHub + npm rendering requirement

This is a hard requirement.

The npm package ships `README.md` but does **not** ship `docs/assets/`.

Therefore the README must **not** reference the graph as:

```markdown
![Velocity](docs/assets/velocity-throughput.svg)
```

That may work on GitHub and fail on npm.

Use the same publication pattern already proven by the first-value demo:

```markdown
![Observed Parallix delivery throughput](https://raw.githubusercontent.com/oxtan-maker/parallix/main/docs/assets/velocity-throughput.svg)
```

If linking the full image, use the corresponding absolute raw URL there as well.

Do not use a GitHub `blob/...` page as the image `src`.

Do not depend on an asset being present inside the npm tarball.

---

# Prevent regression of the npm image path

Extend the existing documentation/package verification with a narrow assertion that:

1. the README velocity graph uses the expected absolute raw-GitHub asset URL;
2. the referenced asset exists in the repository;
3. the README does not accidentally regress to a relative `docs/assets/...` URL for this graph.

Apply the same rule to the existing first-value demo if it naturally fits the check.

Do not create an internet-dependent CI test just to fetch raw.githubusercontent.com.

Verify the contract statically.

---

# Methodology page

`docs/metrics/velocity/README.md` should be short and boring.

Document:

- exact metric definition;
- baseline source;
- baseline dates;
- Parallix observation dates;
- week boundary;
- classification/filtering;
- incomplete-week treatment;
- source of lifecycle completion state;
- how to refresh the snapshot;
- how to regenerate the graph;
- known limitations.

Explicitly state:

```text
This is an observational dogfooding series from one maintainer and one product.
It is not a controlled benchmark and does not establish that another developer or repository will see the same change.
```

No marketing prose is needed beyond that.

---

# README cleanup resulting from this mission

Remove the old retrospective multiplier text.

Search the public docs for other places where:

```text
+57%
order of magnitude
10x
```

are presented as current product evidence.

Keep historical records where appropriate, but make sure the main README and current capability documentation point to the observed dataset rather than repeating an unsupported multiplier.

A historical design document may retain its historical discussion if clearly identified as such.

---

# Tests / verification

Add targeted tests for:

- weekly aggregation boundaries;
- exclusion of current partial week;
- zero weeks being retained;
- metric/classification filtering;
- deterministic rendering;
- malformed snapshot rejection;
- baseline/Parallix definition mismatch failing closed where mechanically detectable.

Run normal repository verification.

---

# Post-release acceptance

Because npm rendering cannot be proven from an unpublished local checkout, after the release containing this change the operator must verify:

1. GitHub README renders the graph.
2. The npm `@magnusekdahl/parallix` package page renders the graph.
3. The graph is readable at normal README width.
4. The raw image URL returns the expected current artifact.
5. The first-value demo still renders on npm.

If SVG rendering is not supported reliably by npm's README path in practice, switch the published visual to a raster format while retaining the same source-data/generator contract.

Do not declare npm presentation complete based only on GitHub rendering.

---

# Success criteria

This mission is complete when:

1. the old `+57% → ~10x` README claim is gone;
2. README contains a graph of actual observed weekly throughput;
3. the manual baseline comes from real retained data;
4. baseline and Parallix observations use a demonstrably comparable definition;
5. every trustworthy full week in the defined period is represented;
6. incomplete current week is not presented as comparable;
7. the aggregate dataset is committed and inspectable;
8. chart generation is deterministic;
9. the graph derives from that dataset;
10. the README uses an npm-safe absolute image URL;
11. CI protects the README asset-link contract;
12. methodology and limitations are available one click away;
13. no causal/productivity multiplier is asserted.

---

# Anti-agent-slop guardrails

Do not:

- invent missing baseline observations;
- infer baseline numbers from the old multiplier;
- select only favorable weeks;
- omit zero weeks;
- compare different mission classifications;
- count commits as missions;
- count telemetry events as completed missions;
- count agent runs as delivery;
- smooth the data to make it look better;
- turn the result into a benchmark;
- calculate a new headline multiplier;
- add marketing adjectives to compensate for weak data;
- add a heavy charting/runtime dependency;
- expose the local database;
- hand-edit generated chart coordinates;
- create a second metrics authority;
- use a relative README image URL.

If the comparable data does not support the intended story, **show the data anyway**.

The evidence is the feature.
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
