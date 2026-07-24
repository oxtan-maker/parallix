# Checkpoint 1: ADR 0042 Ink alignment, ADR 0037 review, index update

## Summary

Edited ADR 0042 to present Ink as the chosen TUI stack and eventual single-stack
direction for all terminal output, motivated by the agent-hallucination problem
of maintaining two rendering frameworks. Reviewed ADR 0037 (no Ink claims to
reconcile). Updated ADR index summary for 0042.

## Changes

- **ADR 0042 decision matrix, Option E (Ink):** Updated Benefits, Fit to
  constraints, and Decision columns to state Ink is the chosen TUI stack and
  eventual direction for all terminal output (ADR 0044), with the single-stack
  motivation (eliminate two-path maintenance / agent hallucination).
- **ADR 0042 alternatives — "Ink (React for terminals)":** Added a dedicated
  paragraph articulating the single-stack direction and its motivation (two
  rendering frameworks create two paths agents forget to maintain). Added a
  new Positive bullet: "Single rendering framework eliminates the
  agent-hallucination surface of maintaining two competing terminal paths."
- **ADR 0042 Links:** Updated the ADR 0044 cross-reference to include the
  single-stack direction and hallucination motivation.
- **ADR 0037:** Reviewed Option E (Gemini CLI-like) — no terminal UI claims
  that contradict ADR 0044's Ink direction. No changes needed.
- **ADR index:** Updated one-line summary for ADR 0042 to reflect the
  single-stack direction and hallucination motivation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: ADR 0042 matrix row E no longer a final rejection; distinguishes batch vs. interactive; mentions single-stack direction | `docs/adr/0042-workflow-cli-color-rendering-approach.md:35`, Decision column: "Reject for batch CLI color; use `util.styleText` here. Ink is the chosen TUI stack and eventual direction for all terminal output (ADR 0044)" | PASS |
| SC2: ADR 0042 alternatives section cross-references ADR 0044 and frames single-stack as motivated by agent hallucination / two-path maintenance cost | `docs/adr/0042-workflow-cli-color-rendering-approach.md:94-101`, paragraph: "The forward direction is **one rendering framework for all terminal output**. The motivation is not richer visuals — it is that two terminal rendering frameworks create two paths agents forget to maintain." | PASS |
| SC3: ADR 0042 Links section contains a reference to ADR 0044 | `docs/adr/0042-workflow-cli-color-rendering-approach.md:126`, link to `0044-workflow-distribution-model.md` with single-stack and hallucination context | PASS |
| SC4: ADR 0042 decision (adopt `util.styleText` for batch CLI color rendering) preserved unchanged | `docs/adr/0042-workflow-cli-color-rendering-approach.md:23-24`, `## Decision` text identical to pre-mission version | PASS |
| SC5: ADR 0042 `## Decision` and `## Consequences` sections not modified | `docs/adr/0042-workflow-cli-color-rendering-approach.md:22-54`, `## Decision` (line 22) and `## Consequences` (line 37) sections unchanged | PASS |
| SC6: ADR 0037 Option E reviewed and updated if contradictory | `docs/adr/0037-ai-workflow-coordination-architecture.md:142-148`, Option E discusses per-CLI config and MCP — no terminal UI claims; no changes needed | PASS |
| SC7: ADR index summary for ADR 0042 reflects updated body content | `docs/adr/index.md:11`, summary updated with single-stack direction and hallucination motivation | PASS |
| SC8: No ADR rejects Ink without qualifying scope | `grep -nil "\bink\b" docs/adr/*.md` — only ADR 0042, 0044, 0051, and index reference Ink; all qualify scope (batch CLI vs. interactive TUI) | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` — 1211 tests pass, 0 failures | PASS |

Next action: stage changes, run handoff for review
