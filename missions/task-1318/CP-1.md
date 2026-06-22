# CP-1: Bug Reproduction (corrected)

## Work Done

Ran `px stats` (weekly) and `px stats task-1316` (phase report) against the live
CSV at `/home/magnus/.local/state/parallix/stats.csv`, and cross-checked the
numbers against the **authoritative** ground truth (Forgejo PRs and the on-disk
review artifacts under `missions/<slug>/review-events/` + `review-state.json`).
The stats CSV itself is not trusted — it is a derived, lossy projection.

## Discrepancies found

### Observation 1: "1 input token" on the execute phase — NOT a bug
- `px stats task-1316` execute: `Input 1, Output 4010, Cached 462739`.
- This is **legitimate prompt caching**: Anthropic streaming reports only the
  uncached prompt delta as `message_start.usage.input_tokens` (here 1); the bulk
  of the re-sent context (462739) is billed under `cache_read_input_tokens`,
  which the table already shows in its `Cached` column.
- The earlier "fix" (a heuristic that overwrote `input<10 && output>1000` from
  `resultUsage`) therefore **clobbered correct data**. Root issue is presentation
  framing, not parsing.

### Bug 2: review phase mislabels the actor
- `px stats task-1316` review row showed `Implementer: claude` although the
  reviewers were qwen/mistral/codex. The writer already stores `reviewer_agent`
  correctly; the **renderer** just never used it for the review phase. This is a
  render bug, not a writer bug.

### Bug 3: Cost column missing from the phase report
- The table headers ended at "Usage %"; `cost_usd` existed in the schema and was
  populated but never rendered.

### Bug 4: codex 0.00 average fix rounds (and other agents likely wrong too)
- `px stats` showed `codex 9 0.00`. In the CSV, per-stage rows always carry
  `pr_fix_rounds=0`; the real count only ever lands on `default` (integration)
  rows. The in-window codex missions (1278/1279/1282/1285/1289/1302/1310) have no
  integration row at all, so codex collapses to 0.00.
- Root cause is in the **writer's derivation**: `deriveFixRoundsFromReviewStateHistory`
  matched a commit format (`round N (reviewing <impl>)`) that no longer exists —
  the real format is `round N (reviewing) [reviewer -> implementer]` — so it
  silently fell back to a guess; and `deriveImplementerAndFixRounds` never read
  the authoritative on-disk review event store. Fix rounds are a review-loop
  quantity and must be derived from ground truth, independent of integration.

## Test evidence (before fixes)

```
$ node px.js stats task-1316
execute  anthropic  claude-opus-4-8  claude  1  4010  462739  4  1  0   (no cost col)
review   claude     claude           claude  0  0     0       0  2  0

$ node px.js stats
codex            9                          0.00
```

## Next action: audit the four subsystems against ground truth (CP-2).
