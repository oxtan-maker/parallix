# CP-1 — Benchmark research complete

## Summary

Created `docs/readme-rewrite-benchmark.md` documenting seven comparable developer-tool
READMEs (one more than the required six): Aider, Goose, OpenCode, Get Shit Done (gsd),
Continue, Codex CLI, and Cline. Each entry records the required dimensions: opening
headline/tagline pattern, first-paragraph structure, what the README leads with, quickstart
depth, credibility/caveat handling, and explicit borrow-vs-avoid decisions specific to
Parallix's skeptical-engineering-manager positioning.

The doc closes with five cross-cutting findings and a **structure decision**: the
task-1336-specified README structure matches the prevailing credible pattern and is adopted
as-is (no stop-rule escalation), with one adaptation — lead with a fenced command-flow block
rather than a screenshot, since screenshots are out of scope and a CLI harness reads better
as commands.

Baseline `npm test` confirmed green before any change (1603 pass / 0 fail) so the gate
starts from a known-good state.

## Goal Check

| Checkpoint requirement | Evidence | Status |
|---|---|---|
| Benchmark doc exists | `docs/readme-rewrite-benchmark.md:1` | ✅ |
| ≥6 competitors documented | Aider `:25`, Goose `:38`, OpenCode `:52`, gsd `:66`, Continue `:80`, Codex CLI `:94`, Cline `:108` (7 total) | ✅ |
| Required four named (Aider, Goose, OpenCode, gsd) + ≥1 more | All four present plus Continue, Codex CLI, Cline | ✅ |
| Each: headline pattern | e.g. Aider `:25`, Goose `:38`, gsd `:66` ("- **Headline/tagline:**" line in every entry) | ✅ |
| Each: first-paragraph structure | "- **First paragraph:**" line in every entry, e.g. `:27`, `:55`, `:96` | ✅ |
| Each: leads-with analysis | "- **Leads with:**" line in every entry, e.g. `:29`, `:57` | ✅ |
| Each: quickstart depth | "- **Quickstart depth:**" line in every entry, e.g. `:31`, `:71` | ✅ |
| Each: credibility/caveat handling | "- **Credibility/caveats:**" line in every entry, e.g. `:33`, `:98` | ✅ |
| Each: borrow-vs-avoid decisions | "- **Borrow:**" / "- **Avoid:**" lines in every entry, e.g. `:35`/`:37`, `:122`/`:124` | ✅ |
| Structure-fit decision recorded (stop-rule check) | `docs/readme-rewrite-benchmark.md:166` ("## Structure decision", "no stop-rule escalation is triggered") | ✅ |
| Baseline gate green | `npm test` → "pass 1603 / fail 0" (bg task bikuh072g, exit 0) | ✅ |

## Next action

Write the rewritten `README.md` (CP-2) using the adopted structure: extract the current
authority content into `docs/authority-reference.md` first (so nothing is lost), then draft
all nine required sections, drawing the "What it does" bullets directly from
`docs/use-cases.md` UC-1…UC-6 with their Confirmed/Partial confidence levels, and verify the
first 300 words answer all five landing-page questions.
