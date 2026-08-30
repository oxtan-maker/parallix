# CP 3 — Web render component + verification gate

## Summary

- Added `web/src/mission-card.tsx`, a presentational `MissionCardView` that
  renders only from a validated wire card DTO passed as props:
  - checkpoint indicator: received checkpoint label with `.md` stripped plus
    gate state (`Checkpoint CP-2 (gate passed)`), or `Checkpoint unavailable`
    when the label is null;
  - PR line: an anchor whose `href` is set only from a non-null received
    `pullRequest.url` (text `PR #42`), plain PR-id text `PR #77 (no link)` when
    the reference exists with `url: null`, or `Pull request unavailable` when
    the reference is null;
  - review round meter: `Review round 2 · fixing` from the received
    `reviewRound`/`reviewPhase`, or `Review round unavailable` when either is
    null.
  Inspected for SC6: the only regex in the component is the `.md` suffix
  strip; there is no flag-parsing regex, and it reads only card DTO fields
  (`title`, `checkpoint`, `gate`, `pullRequest`, `reviewRound`,
  `reviewPhase`) — nothing is derived from lane, flags, or lifecycle state,
  and the link `href` is never constructed.
- Added `test/web-mission-card-render.test.ts` — DOM-free `renderToString`
  tests (node:test, no jsdom) that render a validated, JSON round-tripped
  wire card for the full-facts, absent-facts, and null-url cases and assert
  the exact indicator text, anchor `href`, and meter text (SC5, SC6).
- ADR 0055 gained the ADR-level note its own rules require for the card-facts
  extension and the transport version 2 bump (`docs/adr/0055-web-board-transport-contract.md`,
  References). No other authored doc pinned the v1 card shape.
- Mission gate re-run on the final tree (after the ADR edit): exit 0.

Reproduction test green on the final tree. Exact run:

```text
$ npm test -- test/task-2447-repro.test.ts
✔ wire board card carries pullRequest, reviewApproved, and reviewHistory from the MissionCard (2.619188ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Gate run on the final tree:

```text
$ ./scripts/verify-local.sh all
# exit 0
ℹ tests 2260
ℹ pass 2260
ℹ fail 0
```

Supporting evidence: `npm run build:web` bundles the web artifact cleanly;
`npx tsc --noEmit --project tsconfig.test.json` clean; ESLint clean on every
changed test file; `graphify update .` run after the code changes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: wire `pullRequest` deep-equal for a card with a PR reference, `null` for one without; checkpoint and current-round fields survive the round trip | `test/web-transport.test.ts`, `"snapshot card DTO carries pullRequest, reviewApproved, and reviewHistory through a JSON round trip"`, `"snapshot card DTO keeps pullRequest null when the card has no pull-request reference"` | PASS |
| SC2: `reviewApproved` boolean-equal and `reviewHistory` length plus every per-round field equal, incl. a `disposition: null` round with non-empty finding/pushback/fix lists | `test/web-transport.test.ts`, `"snapshot card DTO round-trips reviewApproved and every per-round reviewHistory field"` | PASS |
| SC3: extended valid payload accepted; `invalid-payload` with field-path problems for unexpected `pullRequest` key, wrong `kind`, non-finite `reviewHistory[0].number`, non-boolean `reviewApproved` | `test/web-transport.test.ts`, `"snapshot validation accepts the extended card and fails closed on malformed card facts"` | PASS |
| SC4: `WEB_TRANSPORT_VERSION` is 2; v1 (and other unsupported) payloads rejected as `incompatible-client` by all three validators; host and stream suites pass unmodified | `test/web-transport.test.ts`, `"transport version 2 rejects v1 payloads as incompatible clients, not invalid payloads"`; `test/web-host.integration.test.ts`, `test/web-stream.test.ts` (36 pass / 0 fail, dynamic-constant usage only) | PASS |
| SC5: render test from a validated, JSON round-tripped wire card asserts the received checkpoint label (`.md` stripped) + gate state, anchor `href` equal to the received `pullRequest.url`, and the received round/phase meter | `test/web-mission-card-render.test.ts`, `"web card renders received checkpoint, PR link, and review round from the wire DTO"`; `web/src/mission-card.tsx` | PASS |
| SC6: absent-facts render shows explicit unavailable text for the PR line and meter, no anchor element, no fabricated round number; component has no flag-parsing regex and reads only card DTO fields (inspected) | `test/web-mission-card-render.test.ts`, `"web card renders explicit unavailable text and no anchor when the new facts are absent"`, `"web card shows the PR id as plain text when the reference has a null url"`; `web/src/mission-card.tsx` (only regex is the `.md` suffix strip) | PASS |
| SC7: repro test red on the parent commit, green on the final tree | `test/task-2447-repro.test.ts`, `npm test -- test/task-2447-repro.test.ts` → `pass 1` / `fail 0` (exact output above); red output recorded in `CP-1.md` | PASS |
| SC8: general fast verification suite passes on the final tree | `./scripts/verify-local.sh all` → exit 0, 2260 pass / 0 fail (exact output above) | PASS |

Next action: none for this mission — all checkpoints committed and the mission gate `./scripts/verify-local.sh all` passes on the final tree; hand off to the lifecycle (Parallix) without further code changes.
