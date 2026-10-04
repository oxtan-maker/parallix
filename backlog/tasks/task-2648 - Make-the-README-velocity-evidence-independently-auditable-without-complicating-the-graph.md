---
id: TASK-2648
title: >-
  Make the README velocity evidence independently auditable without complicating
  the graph
status: backlog
assignee: []
created_date: '2026-10-04 15:11'
labels: []
dependencies: []
ordinal: 165008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Keep the README velocity graph visually simple while making its evidence chain robust enough that an external reviewer — human or AI — can investigate it without relying on undocumented maintainer knowledge.

This is a trust/evidence mission.

It is **not** a new productivity benchmark and **not** a graph redesign.

The high-level README story should remain approximately:

```text
Parallix delivery throughput
Completed delivery / missions per week
Historical manual baseline: ~2/week
Observed Parallix weekly throughput
```

A reader should understand the high-level point in seconds.

Someone who chooses to investigate should be able to trace every material claim to public evidence.

---

# Product decision

The current Parallix weekly mission counts are accepted as the relevant observed delivery-velocity measure.

Do not reopen whether a completed Parallix mission is a legitimate throughput unit.

Do not add complicated internal classification terminology to the graph.

Do not add a productivity multiplier.

Do not add statistical significance language.

The mission is to make the supporting evidence robust.

---

# 1. Preserve the simple README graph

Do not turn the graph into an internal Parallix taxonomy diagram.

Avoid labels such as:

```text
user_value
ai_sdlc
classification
cohort
MissionOutcome
integration → done
```

in the visual.

Prefer user-facing concepts such as:

```text
Completed missions / week
Historical manual baseline: ~2 delivery units / week
```

or similarly compact language.

The exact final wording should optimize immediate comprehension.

The methodology page owns the precision.

---

# 2. Make the historical baseline publicly inspectable

The current snapshot points to a historical commit:

```text
ba7d445e246bec73c65762da23ae266657eecf73
```

and provides a `git show` reproduction command.

That commit is not currently resolvable from the public Parallix repository.

An external reviewer therefore cannot reproduce the claimed baseline using the published instructions.

Fix this.

## Preferred solution

Preserve the relevant historical evidence under the current public repository, for example:

```text
docs/metrics/velocity/
  README.md
  weekly.json
  historical-baseline.md
```

`historical-baseline.md` should contain only the evidence required to establish the baseline, not an entire historical project archive.

At minimum preserve:

- observation period;
- the nine historical work clusters;
- enough description to understand why each was one coherent delivered unit;
- the original repository/source context;
- how the 9 / 32-day calculation was derived;
- provenance of the retained evidence.

If the original source exists in another public repository and commit that can be permanently referenced, linking that immutable source is also acceptable.

Do not retain a reproduction command that fails for an external clone.

---

# 3. Preserve provenance, not just the number

Do not create:

```text
Historical baseline = 1.96875
```

with no evidence behind it.

The public evidence chain should be:

```text
source evidence
    ↓
9 historical delivered work units
    ↓
32-day observation window
    ↓
9 / 32 × 7
    ↓
1.96875 delivery units/week
    ↓
graph displays ~2/week
```

The exact value may remain in the inspectable snapshot/methodology.

The graph should continue displaying the simple rounded number.

---

# 4. Explain comparability once, compactly, in methodology

The historical development process did not use the current Parallix mission/classification model.

Do not pretend it did.

Document the comparison in plain language.

Something approximately like:

> The historical baseline counts coherent delivered work clusters from the predecessor development period. Current Parallix throughput counts completed missions. Parallix missions classified internally as product work or improvements to the AI-development system both represent delivered work for this comparison. The historical taxonomy did not use those later labels.

The exact wording may be shorter.

The important facts are:

- the historical units are real retained observations;
- the current units are real completed missions;
- both represent delivered engineering work;
- the comparison is observational;
- it does not claim those units are identical in size or difficulty.

Do not make README readers learn the internal labels.

---

# 5. Resolve classification ambiguity in the evidence pipeline

This is principally a broader data-quality problem rather than a velocity-product problem.

Current mission classification supports:

```text
user_value
ai_sdlc
unknown
```

For the velocity evidence, encode the actual intended population deterministically rather than relying on accidental current data.

The current graph intends to include delivered Parallix work, including both product work and work improving the AI-development system.

Investigate how `unknown` can reach a completed/integrated mission.

## If integration is already intended to require classification

Fix the defect at the authoritative lifecycle/integration boundary so a mission that requires classification cannot complete without a valid classification.

Do not add a graph-specific workaround for a broken lifecycle invariant.

Add tests proving the invariant.

## Historical records

Do not rewrite historical state merely to make the graph convenient.

If old completed missions lack trustworthy classification:

- establish whether they are valid delivered missions from authoritative historical records;
- preserve them where evidence supports inclusion;
- document the historical limitation compactly.

Do not invent labels.

## Velocity exporter

The exporter should consume the authoritative completed-mission population.

Do not turn it into a second classification authority.

If the lifecycle invariant guarantees completed missions are validly classified going forward, encode only the minimum filtering/check necessary to detect corrupted or legacy ambiguity.

A suspicious completed `unknown` should not silently disappear or silently count.

Prefer failing the evidence export with a clear diagnostic so the underlying data is resolved.

---

# 6. Add machine-auditable evidence metadata

`weekly.json` should be enough for a reviewer or AI to understand the graph without reverse-engineering source code.

Keep it compact.

Include fields that establish:

- metric displayed;
- observation window;
- weekly values;
- exclusion of current partial week;
- historical baseline rate;
- historical baseline observation count;
- historical baseline days;
- public evidence/source path;
- short limitations.

Do not expose:

- private prompts;
- personal filesystem paths;
- raw SQLite records;
- irrelevant agent telemetry;
- credentials;
- private task descriptions.

---

# 7. Add an explicit integrity check for the baseline

The graph generator must not merely trust that:

```json
"unitsPerWeek": 1.96875
```

was typed correctly.

Where practical, encode the primitive evidence values:

```text
historical units = 9
observation days = 32
```

and derive the weekly rate deterministically.

At minimum verification should fail if the stored derived rate disagrees with:

```text
count / days × 7
```

Prefer deriving the rate at render time rather than duplicating it manually.

The published evidence should have one computational source of truth.

---

# 8. Verify referenced public evidence exists

Extend the existing velocity verification so it fails when the methodology references an evidence path that is absent from the current repository.

Do not perform an internet request in CI.

For evidence committed in the repository, verify locally.

If an immutable external repository reference is intentionally used, validate its syntax and retain a local summary sufficient to understand the baseline even if that external source later disappears.

---

# 9. Keep the graph npm-safe

The current publication contract is proven to work on npm:

```text
https://raw.githubusercontent.com/oxtan-maker/parallix/main/docs/assets/velocity-throughput.svg
```

The operator has confirmed the SVG renders correctly on npmjs.

Preserve this.

Do not:

- switch back to a relative `docs/assets/...` image source;
- bundle `docs/assets` into npm solely for this;
- replace the working raw URL without reason.

Keep the existing static README asset verification.

---

# 10. Keep claims intentionally modest

README should not calculate or state:

```text
X× faster
Y% improvement
productivity increased by ...
Parallix caused ...
```

The graph is sufficient.

The surrounding language should remain something close to:

> Observed one-maintainer dogfooding throughput.

with a methodology/evidence link.

Let the reader infer the magnitude.

---

# 11. Historical source material must be clearly scoped

If a historical baseline evidence document is added to the repository, clearly mark it as:

```text
retained evidence for the velocity baseline
```

not current Parallix documentation.

Do not let historical workflow terminology leak back into current architecture/product documentation.

---

# Tests

Add/update focused tests for:

- historical rate derivation;
- invalid/missing baseline primitive evidence;
- public baseline evidence path exists;
- current partial week exclusion;
- zero-week preservation;
- deterministic SVG rendering;
- malformed weekly data;
- completed-mission classification invariant where the lifecycle fix belongs;
- evidence export failing loudly on unresolved current data rather than silently manipulating it;
- README absolute raw-GitHub image contract.

Do not add a generalized analytics testing framework.

---

# Agent-slop guardrails

Do not:

- redesign the graph;
- add internal classification labels to the visual;
- invent new historical observations;
- infer historical observations from the old +57%/10x claim;
- recreate fake weekly historical bars from an aggregate baseline;
- claim causation;
- calculate a new multiplier;
- cherry-pick Parallix weeks;
- omit low/zero weeks;
- make the graph exporter the authority for mission classification;
- silently drop questionable missions;
- retroactively label historical work without evidence;
- add raw private operator state to Git;
- duplicate derived baseline numbers across multiple files;
- add a database migration solely for README evidence;
- add a charting framework;
- change the npm-safe image URL;
- add paragraphs of qualification beside the graph.

Precision belongs in the linked evidence.

The visual belongs to the reader.

---

# Success criteria

The mission is complete when:

1. the graph remains visually simple;
2. npm rendering remains unchanged and working;
3. the baseline's public source can actually be inspected;
4. the nine historical delivery units are documented as evidence rather than asserted;
5. the 32-day window is documented;
6. the ~2/week line is mechanically derivable from primitive evidence;
7. an external reviewer can reproduce the baseline without access to the maintainer's old local Git objects;
8. methodology explains historical-vs-current comparability in plain language;
9. current mission data cannot silently contain an unresolved classification state relevant to the graph;
10. any classification lifecycle defect discovered is fixed at its authoritative boundary, not papered over in the graph;
11. every full trustworthy Parallix week remains represented;
12. no multiplier or causal claim appears in the README.

---

# Adversarial completion check

Before finishing, pretend the reviewer asks an AI:

> “Investigate whether the Parallix throughput graph is misleading. Trace where every number comes from.”

The repository alone should allow that AI to answer:

```text
- where the historical baseline observations are;
- how many there are;
- what dates they cover;
- how ~2/week was calculated;
- where the current weekly counts come from;
- what counts as one current delivery;
- why the current and historical units are treated as comparable;
- what limitations remain;
- how the SVG was generated.
```

If any material step requires:

> “Ask Magnus; he remembers why”

the evidence chain is not complete.
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
