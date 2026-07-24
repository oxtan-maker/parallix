# Mission: Fix ADR hallucinations (task-2310)

## Goal

Update the ADRs under `docs/adr/` so they present a consistent forward-looking
narrative about the terminal UI stack. The direction is **one rendering
framework for all terminal output** (Ink), motivated by the agent-hallucination
problem of maintaining two competing terminal paths.

The ADRs must read as forward-looking decisions, not accumulated slop history
where earlier ADRs contradict the direction set by later ones.

## Why Now

ADR 0044 (2026-07-23) is the most recent strategic decision and names Ink as
the terminal UI stack. ADR 0042 (2026-05-23) predates this and its strong
rejection of Ink ("Total architectural overkill", "Very poor — wrong tool")
now misleads future implementers who read ADR 0042 without cross-referencing
ADR 0044.

More importantly, the ADRs do not yet articulate **why** one rendering stack
matters. The motivation is not richer visuals — it is that **two terminal
rendering frameworks create two paths agents forget to maintain**. When errors,
progress, or output can flow through either raw `console.log`/ANSI (`fmt.ts`)
or Ink, agents updating one component will miss the other path ~90% of the
time. This snowballing effect is the main driver for enforcing one path toward
each component, and it is the reason the eventual direction is Ink for all
terminal commands (including current headless console output).

Until the ADRs present this narrative, agents and reviewers will encounter
conflicting signals when evaluating terminal UI decisions — exactly the kind
of "slop history" that creates follow-up bug work.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR 0042 decision matrix and alternatives sections need
  reframing around the single-stack direction; ADR 0037 alternatives may need
  Ink context; ADR index entry for 0042 may need summary adjustment

## Scope

### ADR 0042 (`docs/adr/0042-workflow-cli-color-rendering-approach.md`)

The primary target. Changes are confined to sections that shape forward-looking
context — the decision itself (`util.styleText` for batch CLI color) is
preserved.

- **Decision matrix, Option E (Ink):** Rewrite the row so it no longer reads as
  a final rejection of Ink. It should state that `util.styleText` is the correct
  choice for batch/headless CLI color rendering, while Ink is the chosen
  interactive TUI stack per ADR 0044 and the eventual direction for all
  terminal output. Decision column should reflect "Reject for batch CLI; Ink
  is the interactive TUI stack per ADR 0044".
- **Alternatives section — "Ink (React for terminals)":** Rewrite to
  acknowledge Ink as the chosen terminal UI direction from ADR 0044. Clarify
  that the distinction is current-scope (batch rendering where Ink is
  overkill) versus forward direction (all terminal commands converging on Ink
  to eliminate the two-path hallucination problem). The "why" is agent
  maintenance cost, not UI richness.
- **Links section:** Add a cross-reference to ADR 0044.
- **Decision and Consequences sections:** Must not be modified.

### ADR 0037 (`docs/adr/0037-ai-workflow-coordination-architecture.md`)

- Review the Option E (Gemini CLI-like) alternatives section and any other
  terminal UI claims for contradictions with ADR 0044's Ink direction. Update
  if needed.

### ADR index (`docs/adr/index.md`)

- Update the one-line summary for ADR 0042 if the body changes materially
  affect its description.

### ADR 0044, ADR 0051, and other ADRs

- No changes unless a direct contradiction with the updated text is discovered
  during editing.

## Out of Scope

- No changes to source code, tests, or any files outside `docs/adr/`.
- No new ADRs created.
- No implementation of the Ink TUI or `util.styleText` migration — this
  mission only fixes the documentation narrative.
- No changes to `docs/doc-standards.md`.

## Success Criteria

- SC1: ADR 0042 decision matrix Option E (Ink) row no longer states Ink is
  "Very poor — wrong tool" as a final verdict; it distinguishes batch CLI
  rendering (where `util.styleText` is correct) from interactive TUI (where
  Ink is the chosen stack per ADR 0044) and mentions the single-stack
  direction
- SC2: ADR 0042 alternatives section for "Ink (React for terminals)" includes
  a cross-reference to ADR 0044 and frames the single-rendering-stack
  direction as motivated by agent hallucination / two-path maintenance cost
- SC3: ADR 0042 Links section contains a reference to ADR 0044
- SC4: ADR 0042 decision (adopt `util.styleText` for batch CLI color
  rendering) is preserved unchanged
- SC5: ADR 0042 `## Decision` and `## Consequences` sections are not modified
- SC6: ADR 0037 Option E (Gemini CLI-like) section is reviewed and updated if
  it contains terminal UI claims that contradict ADR 0044's Ink direction
- SC7: ADR index one-line summary for ADR 0042 accurately reflects the updated
  body content
- SC8: No ADR in `docs/adr/` contains a statement that Ink is rejected or
  unsuitable as the terminal UI stack without qualifying the scope (batch CLI
  vs. interactive TUI)

## Risks and Assumptions

- **Risk:** Editing ADR 0042 could inadvertently change its decision or
  consequences, not just its forward-looking context. Mitigation: the `##
  Decision` and `## Consequences` sections are restricted areas — only the
  decision matrix, alternatives, and links sections are modified.
- **Assumption:** ADR 0044 is the authoritative source for the Ink terminal UI
  direction. If ADR 0044 is later superseded, this mission's changes should be
  revisited.
- **Assumption:** No other ADRs beyond 0042 and 0037 contain terminal UI
  framework claims that contradict ADR 0044. A quick scan of remaining ADRs at
  draft time confirms this.

## Checkpoints

- CP 1: Edit ADR 0042 decision matrix Option E row and alternatives section to
  align Ink references with ADR 0044, add the single-stack / hallucination
  motivation, add cross-reference, and update ADR index summary

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g. `docs/adr/0042-workflow-cli-color-rendering-approach.md:42` (must point to an existing file and line)
  2. **Test names** — e.g. `"ADR 0042 decision matrix row E mentions ADR 0044"` (must match a test name in the repo, if applicable)
  3. **Test file paths** — e.g. `test/adr-consistency.test.ts` (must be an existing test file)
  4. **ADR references** — e.g. `ADR 0044` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g. `` `./scripts/verify-local.sh docs` ``, `` `./scripts/verify-local.sh all` ``, or `` `grep -r "ink" docs/adr/` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| ADR 0042 matrix row E updated for Ink | `docs/adr/0042-workflow-cli-color-rendering-approach.md:62-64`, row E decision changed from "Reject" to "Reject for batch CLI" with ADR 0044 reference and single-stack motivation | PASS |
| ADR 0042 alternatives section cross-references ADR 0044 | `docs/adr/0042-workflow-cli-color-rendering-approach.md:89-92`, paragraph added referencing `ADR 0044` and framing single-stack direction as hallucination defense | PASS |
| ADR 0042 decision preserved unchanged | `docs/adr/0042-workflow-cli-color-rendering-approach.md:28-30`, `## Decision` text identical to pre-mission version | PASS |
| ADR index summary updated | `docs/adr/index.md:17`, summary line for ADR 0042 updated | PASS |
| Verification gate ran | `` `./scripts/verify-local.sh all` `` | PASS |

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `docs/adr/0042-workflow-cli-color-rendering-approach.md` sections `## Decision` and `## Consequences` — must not be modified; only decision matrix, alternatives, and links sections may change
- `docs/adr/0044-workflow-distribution-model.md` — no changes
- `docs/adr/0051-ui-neutral-application-boundary.md` — no changes
- All files outside `docs/adr/` — no changes

## Stop Rules

- Stop if editing ADR 0042 reveals that its `## Decision` or `## Consequences`
  sections also need Ink-context updates — escalate to human review before
  modifying those sections
- Stop if more than three ADRs require Ink-direction reconciliation — the
  scope may need broadening into a separate mission
- Stop if ADR 0044 itself is found to have an incorrect or ambiguous Ink
  statement — escalate to human review
