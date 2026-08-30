# CP 1 — Red reproduction (bug label)

## Summary

Authored `test/task-2447-repro.test.ts` before any production change. It builds a
fully populated card via `makeFullCard` from `test/fixtures/board-projection.ts`
(which supplies `pullRequest` and `reviewApproved`) plus an explicit two-round
`reviewHistory` (one `REQUEST_CHANGES` round, one open round with `disposition:
null` and non-empty `findingSummaries`/`pushbacks`/`fixes`), projects it through
`toWebBoardSnapshot`, JSON round-trips the snapshot, and asserts the wire card's
`pullRequest`, `reviewApproved`, and `reviewHistory` equal the source facts.

Run on the mission's parent commit (`6e396a443`) with no production file modified.
The test is red: the wire card has no `pullRequest` key at all, so the first
assertion fails. Exact failing output excerpt:

```text
$ npm test -- test/task-2447-repro.test.ts
✖ wire board card carries pullRequest, reviewApproved, and reviewHistory from the MissionCard (3.838805ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

  AssertionError [ERR_ASSERTION]: wire pullRequest must equal the source reference
  + actual - expected

  + undefined
  - {
  -   id: '42',
  -   kind: 'pull-request',
  -   provider: 'forgejo',
  -   sourceBranch: 'mission/task-1234',
  -   targetBranch: 'main',
  -   url: 'https://example.invalid/pr/42'
  - }
```

The backlog task `backlog/tasks/task-2447 - Expose-complete-mission-card-facts-to-the-web-board.md`
already carries the `bug` and `user_value` labels in its frontmatter, so the
`user_value` classification is recorded and no metadata change was needed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test authored before any production change | `test/task-2447-repro.test.ts` (only file added at this commit; `git show --stat HEAD` lists it alongside the mission docs, no `src/` change) | PASS |
| Reproduction test uses `makeFullCard` + two-round `reviewHistory` and JSON round-trips | `test/task-2447-repro.test.ts`, test `"wire board card carries pullRequest, reviewApproved, and reviewHistory from the MissionCard"` | PASS |
| Red state recorded at parent commit `6e396a443` | `npm test -- test/task-2447-repro.test.ts` output above: `fail 1`, `AssertionError [ERR_ASSERTION]: wire pullRequest must equal the source reference` with actual `undefined` | PASS |

Next action: extend `WebMissionCard`, `toWebMissionCard`, and `checkMissionCard` in `src/interfaces/web/transport.ts` with `pullRequest`, `reviewApproved`, and `reviewHistory`, bump `WEB_TRANSPORT_VERSION` to 2 with `SUPPORTED_WEB_TRANSPORT_VERSIONS = [2]`, add the SC1–SC4 round-trip and rejection tests to `test/web-transport.test.ts`, then re-run the repro test to record the green state.
