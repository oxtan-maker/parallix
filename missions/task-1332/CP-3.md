# CP-3 — Adversarial review (value bar applied)

## Summary

Applied the six value-bar rejection tests from MISSION.md §"Value Bar" to `use-cases.md` as a skeptical senior PM. The document passes all six. One tightening was made during the pass: UC-4 and UC-6 are explicitly held to **Partial** and excluded/flagged so the document does not over-claim — confirming the "no skepticism" failure mode is genuinely avoided rather than cosmetically. The red-team subsection (§4) names the two weakest use cases with the single strongest objection each and an honest answer.

## Value-bar verdicts

| # | Rejection test | Verdict | Why it passes |
|---|---|---|---|
| 1 | **Feature-list smell** (strike internal nouns → nothing left) | PASS | §2 "Feature-list strike check" rewrites all three top use cases with every Parallix-internal noun removed; each still names a user situation (several agents/one repo; provider cap mid-task; different AI signs off). UC statements are framed as outcomes, not "supports X". |
| 2 | **README echo** (evidence restates README prose) | PASS | Every (E) block points at `lib/*` line numbers, `config/agents.json`, `workflow.config.json`, `test/*` names, or visualBoard retro line numbers. README appears only as the artifact-under-test (UC-4 framing, §3 distribution), never as proof — stated explicitly in §5. |
| 3 | **Genericness** (reads identically for any AI tool) | PASS | §2 genericness check shows each top-3 carries a figure or named tested behavior that is repository-specific: +107%/−57% retro data (UC-1), per-family limit regex + timed blocklist (UC-2), code-level self-approval block (UC-4). |
| 4 | **Unfalsifiable value** (banned adjective, no metric) | PASS | No "easy/fast/simple/intuitive" claims. Values are stated as before→after with concrete mechanics or cited figures. The one throughput claim carries `0.58/day`, `0.28` baseline, `+107%`. |
| 5 | **Cooked productivity claim** (throughput without retro figure + caveats) | PASS | The only throughput framing (UC-1, §5) cites `EVALUATION_SUMMARY.md:46-52` and travels with all four caveats (34% overhead, 7% C2 coverage, METR −19%/model-currency, P5 erosion to 1.6×). A bare "2× faster" is named a defect in §5 and the sustained-2× claim is filed Aspirational in §3. |
| 6 | **No skepticism** (zero Partial/Aspirational, zero limitations) | PASS | UC-4 and UC-6 are Partial; §3 has three Aspirational items; §5 lists four limitations; §4 red-team concedes where evidence is weak. |

## Adversarial probes run (and the deliverable's answer)

- *"Is UC-3 just 'has checkpoints'?"* — Strike test: "resume a long agent task exactly where it stopped, deterministically" survives noun-removal; the value is the written `Next action:` line replacing diff-archaeology. Holds.
- *"Does any top-3 claim depend on the README?"* — No; ranks 1–3 cite `EVALUATION_SUMMARY.md`, `limit-hit.js`/`test/agents-limit-hit.test.js`, and `review-commands.js:902`/`config/agents.json` respectively.
- *"Is the strongest asset over-sold?"* — UC-1 leads with +107% but immediately attaches the −57% serial regression, the 34%/7% gaps, METR, and the P5 erosion to 1.6×. This is the METR failure mode the mission is built to avoid, and it is avoided.

## Goal Check

| CP-3 goal | Evidence (file:line / artifact) | Status |
|---|---|---|
| Value bar applied to draft | `CP-3.md` value-bar verdict table; `use-cases.md` §2 checks | ✓ |
| Red-team subsection present, 2 weakest UCs + objection each | `use-cases.md` §4 (UC-4, UC-6) | ✓ |
| Feature-list / README-echo / generic / cooked-claim defects corrected | verdicts 1–5 PASS; no rewrite required beyond §2 strike/genericness checks already in deliverable | ✓ |
| Skepticism present (Partial/Aspirational + limitations) | UC-4, UC-6 Partial; §3; §5 | ✓ |

Next action: Final completeness pass for CP-4 — re-verify every cited file:line and test name resolves, confirm all numbered MISSION.md success criteria (including history-coverage counts and the ≥3-tested-capabilities count) are individually satisfied, run the configured gate once more, and write the final `## Goal Check` table citing real evidence.
