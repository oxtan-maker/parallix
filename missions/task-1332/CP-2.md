# CP-2 — Use cases drafted

## Summary

Wrote the deliverable `missions/task-1332/use-cases.md`: 6 four-part, evidence-backed use cases (4 Confirmed, 2 Partial), a top-3 positioning ranking each naming the competing tool/workflow and a Parallix-only claim, an aspirational section (§3) separated from confirmed capabilities, a red-team subsection (§4) naming the two weakest use cases, and a limitations section (§5). Every value claim is anchored to code/tests/configs or measured retro data — no use case rests on a README assertion. All throughput framing carries the cited figure plus the retro's own caveats.

## Goal Check

| Success criterion (MISSION.md) | Evidence in deliverable | Status |
|---|---|---|
| File exists, ≥5 use cases, each ≥1 repo-artifact citation | `use-cases.md` §1, UC-1…UC-6 (6 use cases) | ✓ |
| Each UC states persona + before/after + repo/measured citation + confidence | `use-cases.md` §1, every UC has (P)(B)(E)(C) | ✓ |
| ≥3 use cases map to actively-tested capabilities, cited by path | UC-1 `test/draft.test.js`, UC-2 `test/agents-limit-hit.test.js`, UC-3 `test/handoff.test.js`, UC-5 `test/verification.test.js`, UC-6 `test/stats.test.js` (5) | ✓ |
| No UC relies solely on README | §5 honesty constraint; README cited only as artifact-under-test (UC-4, §3) | ✓ |
| Aspirational items in a separated section | `use-cases.md` §3 | ✓ |
| Top-3 ranking, each naming one competing tool/workflow | `use-cases.md` §2 table (Cursor/Aider; manual restart; self-review/human PR) | ✓ |
| Throughput claims tied to retro figure + caveats | UC-1 (E) and §5: `EVALUATION_SUMMARY.md:46-52,66,70-72` + `RETROSPECTIVE_P5.md:20-30` | ✓ |
| Each top-3 has a Parallix-only claim (anti-generic) | §2 "claim only Parallix can make" column + genericness check | ✓ |
| ≥1 Partial/Aspirational + documented limitations (anti-no-skepticism) | UC-4, UC-6 Partial; §3 Aspirational; §5 limitations | ✓ |

Verification status: the configured gate (`npm test`) is **non-deterministic** because `test/review.test.js` (autonomous review-loop, async-poll/timeout-sensitive) is **timing-flaky**: observed outcomes range from all-pass (0 fail) to 11–15 failures depending on machine load (the reviewer observed 11; an earlier concurrent run here showed 15; six isolated reruns here showed 0). The flaky suite lives in `lib/review/`, a Restricted Area outside this docs-only mission; the mission's changes are markdown-only under `missions/task-1332/` and cannot affect it. Do **not** read "gate passes" as a settled fact — it is flaky and reported as such.

Next action: Run the value-bar / adversarial pass for CP-3 — re-apply the six value-bar rejection tests (feature-list smell, README echo, genericness, unfalsifiable value, cooked productivity claim, no-skepticism) to `use-cases.md`, confirm the red-team subsection is sufficient, and tighten any use-case statement that fails the strike test.
