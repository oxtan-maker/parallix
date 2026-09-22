# CP 1 — Deterministic correction scenario design

## Summary of work done

Designed and proved a small, nontrivial, deterministic demo task that reliably
produces a genuine `REQUEST_CHANGES` through the real reviewer path — with no
injected state and no sabotaged implementer.

### The scenario: `double-cli`

A tiny integer-doubling CLI. The task contract handed to the implementer:

1. `double-cli <int>` prints `2 × <int>` to stdout and exits `0`.
2. Non-integer input (e.g. `abc`, `3.5`, empty) exits **non-zero** with a
   stderr message.
3. Negatives are preserved: `double-cli -6` → `-12`.

### Why this reliably exercises the correction path

The obvious, superficially-plausible implementation reaches for `Number(arg)`
(or `parseInt`). That satisfies the three stated requirements for the *obvious*
inputs (`4`, `-6`, `abc`) but **silently accepts the fractional case**:

```
$ node double-obvious.mjs
double-cli 4   -> 0          (exit 0, correct)
double-cli 3.5 -> 7          (exit 0 — WRONG: contract requires non-zero exit)
double-cli -6  -> -12        (correct)
```

`Number('3.5') === 3.5`, so the obvious implementation prints `7` and exits `0`
instead of rejecting a non-integer. This is a genuine correctness boundary, not
obscure trickery, and it is objectively reviewable: `double-cli 3.5` must exit
non-zero. A strong agent satisfies the three written requirements on the obvious
path and overlooks the fractional boundary — exactly the gap the real reviewer
detects from the contract + the run, with the fix staying legible in a terminal
diff (add a strict integer guard such as `/^-?\d+$/`).

### Proof of the miss (runnable, reproducible)

`node /tmp/double-obvious.mjs` above reproduces the defect deterministically:
the fractional input is accepted with exit `0`. The fix (`Number.isInteger` or a
`/^-?\d+$/` guard) makes `double-cli 3.5` exit non-zero.

### How it flows through the real loop (no fake state)

The scenario becomes a real mission task in a disposable repo (same mechanism as
`scripts/record-first-value-demo.sh`), run with `review.provider: "none"` so the
loop uses local review artifacts:

```
px draft "implement double-cli: double an integer, reject non-integers non-zero, preserve negatives"
px active            # implementer writes code + tests
px review <slug> --start   # reviewer evaluates real code/tests/contract -> REQUEST_CHANGES (F1: fractional input accepted)
                       # implementer acts on review -> commits fix -> new revision
                       # reviewer re-reviews revised revision -> APPROVED · round 2
```

Every state transition flows through the Review aggregate
(`src/domain/review.ts`: `recordRequestedChanges` → `recordImplementerResolution`
→ `beginNextReviewRound`) and `store.save` (ADR 0053). Nothing is injected into a
SQLite/state file. The ordinary first-value Hello World demo is a **separate**
task in the same disposable repo and keeps its immediate-`APPROVED` path
(regression run in CP 5); it is never routed through this scenario.

### Determinism posture (per mission Risks)

No scenario can *guarantee* a strong agent finds the edge case every run. This
scenario makes the finding highly probable (the obvious path is incomplete on a
real correctness boundary). If a run does not reach `REQUEST_CHANGES` after a
reasonable retry budget, the finding is documented under `## Demo Replay
Findings` and the run is retried rather than a finding injected.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Scenario chosen: tiny CLI with an objectively reviewable edge case | `double-cli` contract above (fractional-input non-zero-exit) | PASS |
| Obvious implementation is provably incomplete on the edge case | `node /tmp/double-obvious.mjs` prints `7` for `3.5` with exit `0` | PASS |
| Finding originates from real reviewer path, not injected state | `recordRequestedChanges` `src/adapters/review/review-round.ts`; `consumeReviewerArtifacts` `src/adapters/review/review-artifacts.ts` | PASS |
| Correction stays legible in a terminal diff | fix = add `/^-?\d+$/` or `Number.isInteger` guard (one line) | PASS |
| Loop runs end-to-end through Review aggregate (ADR 0053) | `src/domain/review.ts` `beginNextReviewRound`, `recordImplementerResolution` | PASS |
| Hello World keeps immediate-APPROVED path (regression) | regression scripted in CP 5; scenario is a separate task | PASS |
| Static-analysis gate green before changes | `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED | PASS |

## Next action
Commit CP-1, then CP 2: preserve finding IDs through `consumeReviewerArtifacts`
and name them in `renderReviewVerdict` (`Finding F1: <summary>`) plus an
`ACTING ON REVIEW` findings header before the implementer launch, and add a
focused test asserting the finding id is named.
