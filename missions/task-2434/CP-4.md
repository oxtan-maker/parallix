# CP-4: Visual-diff review against the reference artifact, and the gate

## Summary

Captured the implemented board and the reference acceptance artifact at the
same wide and narrow viewport dimensions in headless Chromium, compared them,
resolved the defects the comparison exposed, and recorded every remaining
deviation with its reason.

### How the comparison was reproduced

```sh
unzip -o -d /tmp/pxref "/tmp/Parallix Kanban Board Controller.zip"
npx tsx missions/task-2434/render-board-snapshot.ts /tmp/pxshot/mine.html

# wide (1440x900) and narrow (768x900), reference then implementation
chromium --headless --disable-gpu --hide-scrollbars --user-data-dir=/tmp/pxshot/profile \
  --window-size=1440,900 --virtual-time-budget=4000 \
  --screenshot=/tmp/pxshot/ref-wide.png   "/tmp/pxref/Parallix Board.dc.html"
chromium --headless --disable-gpu --hide-scrollbars --user-data-dir=/tmp/pxshot/profile \
  --window-size=1440,900 --virtual-time-budget=3000 \
  --screenshot=/tmp/pxshot/mine-wide.png  /tmp/pxshot/mine.html
# …repeat both with --window-size=768,900 for the narrow pair
```

`missions/task-2434/render-board-snapshot.ts` is committed, so the comparison
is reproducible from this tree. Screenshots are not committed: this repository
tracks no binary image files (`git ls-files | grep -icE '\.(png|jpg|gif|webp)$'`
returns 0), and the commands above regenerate them.

### Defects the visual diff found, and fixed

1. **The collapsed done rail rendered both summary variants.** The expanded
   header carried an inline `display:flex`, which beats the stylesheet rule
   that hides it when the `<details>` is closed, so `DONE 3 ▸` printed on top
   of the collapsed vertical rail. Fixed by splitting `laneHeaderBox` out of
   `laneHeader` in `web/src/board.tsx` so the disclosure CSS owns `display`.
2. **The attention entry printed its action twice** — once as truncated text
   and once as the button label. Fixed by rendering the server's `display`
   only on the disabled control, which now spans the row.
3. **Flagged cards lost the reference's coloured left edge.** Restored from
   facts the card already carries: red when `blockingReason` is non-null,
   amber when `flags` is non-empty, otherwise the default card edge. No
   flag-kind interpretation is involved.
4. **The collapsed done rail was an unnamed region.** Writing the SC7
   landmark test exposed that `<details class="shipped">` carried no
   accessible name, so the done history was the only board region a screen
   reader could not identify. Fixed with `aria-label={`${stage.lane} stage`}`
   on the `<details>`, matching every other region.
5. **`web/src/board-data.ts` failed the test-project typecheck.** Narrowing the
   transport validation by its `ok` discriminant does not hold under the
   non-strict `tsconfig.test.json`; the code now narrows by field presence
   (`'supported' in validation`), which holds under both projects.

### Narrow-viewport result

At 768×900 the implementation reproduces the reference's behaviour exactly:
the attention rail keeps its 296px width, the lane row scrolls horizontally
via `overflow-x:auto`, the agent strip compresses its cells with ellipsis, and
no rail, lane, card or action is hidden, stacked, summarised or dropped.

### Accessibility verification

SC7 is asserted by tests rather than by inspection: `test/web-board-render.test.ts`
covers the `<main>` landmark and `aria-busy` on the loading screen, a named
region for every board area (agent strip, attention rail, each of the six
stages, source facts, operation log), exactly one `<h1>` with an `<h2>` per
region, an accessible name on every action that carries the server's `display`,
`state` and `reason`, the absence of any `tabindex` override so focus order is
document order, and the `:focus-visible` outline in `web/src/style.css`.

### Accepted deviations

Every deviation below is tied to one of: **(1)** snapshot-backed facts
replacing the artifact's generated sample data, **(2)** disabled read-only
controls replacing mutation controls, **(3)** an accessibility requirement, or
**(4)** content this mission's scope explicitly excludes.

| # | Deviation | Reason |
|---|---|---|
| 1 | Top bar's aggregate `wip 9` omitted | (1) `wipCounts` is a per-lane series over all six lanes, including backlog and done; there is no aggregate WIP fact and summing it would invent a lane rule. Per-lane counts render in the lane headers. |
| 2 | `27 (52) missions/wk` throughput omitted | (4) throughput is out of scope |
| 3 | `▤ FLOW` button and its cumulative-flow / median-cycle-time / bottleneck panel omitted | (4) flow charts, cycle-time medians and bottleneck analysis are out of scope |
| 4 | The top-right control slot now renders `snapshot.availableActions`, disabled | (1)(2) |
| 5 | Agent family names use one palette entry instead of per-family tints | (1) the artifact's tints come from a map hardcoded to four sample family names; `family` is an arbitrary string with no colour fact |
| 6 | Agent cells add `blocked · <duration>` and `sessions unknown` | (1) the contract distinguishes indefinite blocks and unobserved liveness, which the sample never expressed |
| 7 | The strip's trailing slot carries `unattributedRunningSessions` | (1) |
| 8 | Attention badges use one colour and print `reason.kind` | (1) the artifact's labels and colours came from a generated reason map |
| 9 | The `$ cmd` line and `run ▸` button collapse into one disabled button labelled with the server's `display` | (1)(2) the display string *is* the command; showing it twice while inventing a `run ▸` label would duplicate one fact and fabricate another |
| 10 | Attention entries gain a `sources:` line when `dependsOnSources` is non-empty | (1) |
| 11 | The rail footer's `ranked by: …` sentence is replaced by `snapshot.sourceFacts` | (1) that sentence asserts a server ranking rule the browser must not restate, and the source facts had no other slot |
| 12 | The intake column stacks `backlog` above `refined`, inverting the artifact | (1) stages render in received order; the slot geometry (44% top, `flex:1` bottom) is unchanged |
| 13 | Lane headers drop `med 1.5d` and the `▲` overrun marker | (4)(1) cycle-time medians are out of scope and have no transport fact |
| 14 | Lane headers show `count`, not `n/limit` | (1) there is no WIP-limit fact |
| 15 | The card class badge (`ux`, `bug`, `perf`) is replaced by `activity.work` kind and certainty | (1) |
| 16 | The card's left edge follows `blockingReason` then `flags` presence, not a flag→reason colour map | (1) |
| 17 | Card action labels are the server's `display` strings, not `ckpt` / `review ▸` / `approve` | (1)(2) |
| 18 | `PR #47` link and the `forgejo` tag are omitted | (1) the wire carries no pull-request fact |
| 19 | The review line prints `R<n> · <phase> · <disposition>` from the contract | (1) |
| 20 | Empty-lane copy is neutral (`no missions in this stage`) instead of coaching text (`nothing running — launch from refined`) | (1)(2) the coaching text names a mutation this client cannot perform |
| 21 | `+9 integrated earlier this quarter` omitted | (1) invented count |
| 22 | The shipped `✓` renders only when `card.closed` | (1) |
| 23 | Log lines print the transport `timestamp` verbatim plus `phase`, `message` and optional `agent`; the artifact's `HH:MM:SS` reformat is not applied | (1) |
| 24 | The blinking command caret at the end of the log is dropped | (2) a read-only client has no command line, and a caret implies one |
| 25 | The done disclosure is a native `<details>`/`<summary>` rather than a `<button>` with a click handler, and the collapsed rail's drop-target `title` is dropped | (2)(3) the disclosure needs no handler or state and is keyboard-operable natively; the title advertised a drag-to-integrate mutation |
| 26 | A `:focus-visible` outline is added | (3) |
| 27 | Landmarks and headings (`<main>`, `<section aria-label>`, `<h1>`/`<h2>`, `<article>`) replace the artifact's `<div>`s | (3) margins are reset and headings are `display:inline`, so the rendering is unchanged |
| 28 | The Google Fonts link is dropped; `font-family` keeps `'JetBrains Mono'` first with a monospace fallback | ADR 0054 forbids CDN and external fonts in the self-contained bundle; pixel-identical wherever JetBrains Mono is installed locally |
| 29 | Long titles in the intake and shipped rows wrap instead of truncating with an ellipsis | (3) SC4 — truncated text has no other way to be read on a board with no detail expansion |
| 30 | Loading, request-failure, malformed and incompatible-version screens have no artifact counterpart | required by SC6; the artifact never fetches |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — a valid populated snapshot renders identity, all six stages in received order, counts, cards, attention items, agent availability, source facts, and action display/state/reason | `test/web-board-render.test.ts`: "a populated snapshot renders repository identity and all six received stages in received order", "every received card renders in its stage, including the collapsible done history", "attention items render the server rank, reason kind, detail and action display", "card facts render from the server without substitution", "source facts render with their status, and a value-less fact prints no value" | Pass |
| SC2 — empty, unavailable, unknown and nullable values present the contract state and never substitute zero, pass, idle or sample data | `test/web-board-render.test.ts`: "an empty snapshot states each region is empty and never shows a zero metric as a fact", "an unknown gate renders as unknown, never as a pass", "an absent implementer renders as absent, never as an idle or named agent", "omitted, null and observed-zero running sessions each render as themselves", "an indefinite agent block never renders as a numeric duration" | Pass |
| SC3 — wide and narrow screenshot visual diff against `Parallix Board.dc.html`, with every accepted deviation recorded | `npx tsx missions/task-2434/render-board-snapshot.ts /tmp/pxshot/mine.html` plus the headless Chromium commands above regenerate both pairs from this tree; five defects found and fixed, 30 deviations recorded in the table above; the reference-preserving outcome is regression-locked by `test/web-board-render.test.ts` "narrow viewports scroll the board horizontally instead of dropping lanes" | Pass |
| SC4 — every rail, lane, card and action stays reachable at both sizes, following the reference overflow | `test/web-board-render.test.ts`: "narrow viewports scroll the board horizontally instead of dropping lanes" asserts `overflow-x:auto`, `min-width:225px` and the absence of `display:none`; confirmed against the 768×900 reference screenshot | Pass |
| SC5 — no click, key press or drag can invoke a mutation or change board data; done-history collapse is the only local interaction | `test/web-board-render.test.ts`: "every rendered action is a disabled native control carrying the server display and state", "the rendered board carries no drag, drop or draggable affordance", "production browser code performs exactly one fetch and no mutating request"; the disclosure is a native `<details>` with no handler in `web/src/board.tsx` | Pass |
| SC6 — loading, request failure, malformed snapshot and incompatible version each have a distinct explicit UI and show no stale snapshot | `test/web-client-snapshot.test.ts` (8 tests, including "an unsupported transport version becomes an explicit incompatible state, not a malformed one"); `web/src/shell.tsx` renders one screen per state and holds no cache | Pass |
| SC7 — main landmark, named regions and headings, deterministic focus order, accessible control names, visible focus | `npx tsx --test test/web-board-render.test.ts`: "the shell renders a main landmark and marks itself busy while the snapshot loads", "every board region is a named landmark and every lane carries a heading", "every action control has an accessible name carrying the server display and state", "the done-history disclosure is a native, keyboard-operable control rather than a scripted toggle", "the browser stylesheet defines a visible focus indicator" | Pass |
| SC8 — focused tests with transport-shaped fixtures plus assertions that browser code has no mock data, domain-rule mapping, Node import, persistence or mutation path | `npx tsx --test test/web-board-render.test.ts` (25 tests) and `npx tsx --test test/web-client-snapshot.test.ts` (8 tests); fixtures come from `test/fixtures/board-projection.ts` through `toWebBoardSnapshot` | Pass |
| SC9 — the mission gate passes | `./scripts/verify-local.sh all` exits 0 (2278 tests, 0 failures) | Pass |
| AGENTS.md static-analysis gate for a code-modifying mission | `./scripts/verify-local.sh static-analysis` exits 0 — ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean | Pass |
| DoD #2 — the browser bundle carries no Node built-in or concrete adapter import | `npm run build:web`; "production browser code imports no Node built-in, concrete adapter, or server module" | Pass |
| Stop rules — no prohibited architecture layer, no concrete adapter import, no write behaviour was needed | `test/web-board-render.test.ts`: "the client adds no router, browser state framework, server-rendering layer, or design system" asserts the client's only external imports are `react` and `react-dom/client`; "production browser code imports no Node built-in, concrete adapter, or server module"; ADR 0054 and ADR 0055 remain the governing decisions and needed no amendment | Pass |

Next action: hand off for review — the read-only board is complete and both
gates are green; a reviewer should re-run the two Chromium capture commands
above against the committed tree and confirm the 30-row deviation table before
approving, since screenshots are deliberately not committed.
