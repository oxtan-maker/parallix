# Mission: Expose complete mission card facts to the web board (task-2447)

## Goal
Extend the versioned web transport so the board-snapshot card DTO carries the shared `MissionCard`'s server-owned facts the browser is missing today — the pull-request reference, review approval, and review history — keep the existing checkpoint facts (latest checkpoint name/description/next action, gate) and current review round/phase/disposition, validate the extended payloads fail-closed, and render the received checkpoint indicator, PR link, and review round meter in a presentational web card component that never invents values.

## Why Now
The Ink TUI reads the shared `MissionCard` directly and already renders the PR reference, review approved/pending state, and round detail from it. The web transport (`src/interfaces/web/transport.ts`) forwards only the latest checkpoint text and current review round/phase/disposition, so the browser cannot truthfully render the checkpoint indicator, PR link, or review round meter and the two UIs disagree despite the same board projection. The web-board UI missions (TASK-2434 shell, TASK-2435 visuals, TASK-2436 actions) can only render what the wire carries; extending the contract is their prerequisite.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is; no dependency ordering needed (transport + presentational component only)
- Main drivers: wire DTO extension with fail-closed validation, transport version bump, red→green repro test, and a DOM-free React render test

## Scope
- Reproduction test first (bug label): author `test/task-2447-repro.test.ts` that builds a fully populated `MissionCard` (via `makeFullCard` from `test/fixtures/board-projection.ts`, plus a multi-round `reviewHistory`), projects it through `toWebBoardSnapshot`, JSON round-trips the snapshot, and asserts the wire card carries `pullRequest`, `reviewApproved`, and `reviewHistory` equal to the source facts. This test must fail (red) on the mission's parent commit before any production change.
- Extend `WebMissionCard` in `src/interfaces/web/transport.ts` with exactly three server-owned facts, projected one-to-one from `MissionCard`:
  - `pullRequest`: nullable wire DTO mirroring `PullRequestReference` — `{ kind: 'pull-request', provider, id, url: string | null, sourceBranch, targetBranch }`, or `null` when the card has no pull-request reference (a local-branch review subject stays `null`).
  - `reviewApproved`: boolean, equal to the source.
  - `reviewHistory`: array of wire round summaries mirroring `ReviewRoundSummary` — `{ number, reviewer, implementer, phase, disposition: string | null, comment: string | null, findingSummaries: string[], pushbacks: string[], fixes: string[] }`.
- Extend `toWebMissionCard` to project the three fields; keep all existing fields (including `checkpoint`, `checkpointDescription`, `nextActionText`, `gate`, `reviewRound`, `reviewPhase`, `reviewDisposition`) unchanged.
- Extend `checkMissionCard` in the validator: the three keys become required on the card; `pullRequest` is either `null` or an object with exactly the six keys above (`url` nullable string); each `reviewHistory` entry is an object with exactly the nine keys above. Malformed payloads (unexpected keys, wrong types, non-finite `number`, wrong `kind` tag) must fail closed as `invalid-payload` with the field path in `problems`.
- Bump `WEB_TRANSPORT_VERSION` from 1 to 2 (the card shape change is breaking for strict v1 validators; no v1 browser client exists — the board shell is still phase 1). `SUPPORTED_WEB_TRANSPORT_VERSIONS` becomes `[2]`; payloads on any other version keep the explicit `incompatible-client` state. All existing consumers (`src/interfaces/web/host.ts`, `src/interfaces/web/stream.ts`) reference the constant dynamically and need no logic change.
- Add a presentational card component to the web bundle (new file under `web/src/`, e.g. `web/src/mission-card.tsx`) that renders, from a validated wire card DTO passed as props: the checkpoint indicator (latest checkpoint label with `.md` stripped plus gate state text), the PR link (an anchor with `href` set only from a non-null received `pullRequest.url`; PR id as plain text when the reference exists but `url` is null; explicit unavailable text when the reference is null), and the review round meter (current round number and phase from the received fields). Absent facts render explicit unavailable text; nothing is computed from lane, flags, or lifecycle inference.
- Add focused unit tests: transport round-trip assertions for present and absent PR reference and for a multi-round `reviewHistory` (in `test/web-transport.test.ts`), validator rejection cases for each new field, and React render tests (via `react-dom/server` `renderToString`, node:test — no jsdom) that render the validated wire DTO for a full-facts card and an absent-facts card and assert the exact indicator text, link href, and meter text.
- Backlog task label: record `user_value` classification on the backlog task (bug label already present; it drives the red→green requirement below).

## Out of Scope
- Building the read-only React board shell (lanes, attention rail, agent strip, boot/loading/error states, snapshot fetching) — owned by TASK-2434; the component in this mission receives the wire card as props and is not wired to `fetch` yet.
- Mutations, guarded browser actions, drag/keyboard flow — TASK-2433 and TASK-2436.
- Any change to the shared `MissionCard`/`BoardProjection` read models, review domain rules (`src/domain/review.ts`), attention ranking, `agentIsWorking`, or the TUI (`src/interfaces/tui/`).
- New card facts beyond the three listed (no `approvalOwed`, no full per-checkpoint history, no `liveSession` changes); if the board design needs those, it is a separate projection mission.
- SSE/stream envelope changes, host route changes, or a generic schema framework.
- Client-side derivation of limits, links, or checkpoint state in React (explicitly forbidden by the task).
- Copying controller/state code from the design prototype (`/tmp/Parallix Kanban Board Controller.zip`, `.dc.html` files); the prototype is visual reference only.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: In `test/web-transport.test.ts`, a round-trip test asserts that a card whose source has a pull-request reference produces a wire `pullRequest` deep-equal to `{ kind: 'pull-request', provider, id, url, sourceBranch, targetBranch }` and that a card without one produces `pullRequest === null`; the existing checkpoint fields (`checkpoint`, `checkpointDescription`, `nextActionText`, `gate`) and current round fields survive the round trip unchanged.
- SC2: A round-trip test asserts `reviewApproved` is a boolean equal to the source and `reviewHistory` is an array whose length and every per-round field (`number`, `reviewer`, `implementer`, `phase`, `disposition`, `comment`, `findingSummaries`, `pushbacks`, `fixes`) equal the source `ReviewRoundSummary` values, including a round with `disposition` null and non-empty `findingSummaries`/`pushbacks`/`fixes`.
- SC3: `validateWebBoardSnapshot` accepts the extended valid payload and returns `ok: false, code: 'invalid-payload'` with a field-path problem for each of at least three malformed variants: a `pullRequest` object with an unexpected key or `kind` other than `'pull-request'`, a `reviewHistory` entry whose `number` is not a finite number, and a `reviewApproved` value that is not a boolean.
- SC4: `WEB_TRANSPORT_VERSION` equals 2; a snapshot payload with `transportVersion` 1 or any other unsupported value is rejected as `incompatible-client` (not `invalid-payload`) by all three validators, and the web-host snapshot route serves the version-2 snapshot (existing `test/web-host.integration.test.ts` and `test/web-stream.test.ts` pass unmodified except dynamic-constant usage).
- SC5: A render test renders the web card component via `react-dom/server` `renderToString` from a validated, JSON round-tripped wire card and asserts: the checkpoint indicator shows the received checkpoint label (`.md` stripped) and gate state; the PR line is an anchor whose `href` equals the received `pullRequest.url` when non-null, plain PR-id text when the reference has `url: null`, and explicit unavailable text when `pullRequest` is null; the review round meter shows the received current round and phase.
- SC6: A second render test renders the same component for a card with the three new facts absent/null and asserts the output contains explicit unavailable text for the PR line and meter and contains no anchor element and no fabricated round number; the component source contains no flag-parsing regex and reads only card DTO fields (verifiable by inspecting the new `web/src/` file).
- SC7: The reproduction test `test/task-2447-repro.test.ts` fails when run against the mission's parent commit (red) and passes on the final tree (green), with the red state recorded in the CP 1 document.
- SC8: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions
- Assumes the three fields (`pullRequest`, `reviewApproved`, `reviewHistory`) are the complete set of card facts the web board needs; the shared card exposes only the latest checkpoint, and "checkpoint history" in the task description maps to those latest-checkpoint facts the wire already carries. If the board design later needs every past checkpoint, that is a projection change, not a transport change (see Stop Rules).
- Assumes no external consumer of the v1 wire shape exists; the only browser client is the in-repo phase-1 shell, so bumping to v2 and dropping v1 from the supported list loses no capability. If a v1 consumer surfaces, stop and revisit.
- Assumes `react-dom/server` `renderToString` is sufficient for DOM-free web render tests; no new devDependency (jsdom/happy-dom) is introduced.
- The PR `url` is nullable by design; a link built from anything other than the received `url` would be an invented value and violates ADR 0051/0055 server-owned-facts rules.
- The design prototype is the visual reference for what "indicator", "link", and "meter" mean; its generated code must not be copied into `web/src/`.

## Checkpoints
- CP 1 (red reproduction, bug label): Author `test/task-2447-repro.test.ts` before any production change. It builds a fully populated card with `makeFullCard` from `test/fixtures/board-projection.ts` (which already supplies `pullRequest` and `reviewApproved`) plus an explicit two-round `reviewHistory`, projects it with `toWebBoardSnapshot`, round-trips the snapshot through `JSON.stringify`/`JSON.parse`, and asserts the wire card's `pullRequest`, `reviewApproved`, and `reviewHistory` equal the source facts. Run it on the parent commit and record the failing output (red) in `CP-1.md`. No production file is modified in this checkpoint.
- CP 2 (transport extension): Extend the `WebMissionCard` DTO, `toWebMissionCard`, and `checkMissionCard` validation in `src/interfaces/web/transport.ts` with the three fields; bump `WEB_TRANSPORT_VERSION` to 2 with `SUPPORTED_WEB_TRANSPORT_VERSIONS = [2]`; extend `test/web-transport.test.ts` with the SC1–SC4 round-trip and rejection tests. The CP 1 reproduction test must now pass (green) and its green run is recorded in `CP-2.md`.
- CP 3 (web render + gate): Add the presentational card component under `web/src/` and the `renderToString` render tests for full-facts and absent-facts cards (SC5, SC6). Run `./scripts/verify-local.sh all`, confirm the repro test is green on the final tree, and complete the Goal Check evidence table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- A 3-column pipe-delimited markdown table with the exact header `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion, led by the durable evidence forms Parallix verifies today: exact test names (matching a `test()` name in the repo), ADR references (existing files under `docs/adr/`), test file paths, and recognized repo commands/paths such as backticked `npm test -- test/web-transport.test.ts`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- For the red→green criterion (SC7), CP 1 records the exact red command output excerpt and CP 2/CP 3 record the exact green run of `npm test -- test/task-2447-repro.test.ts`.
- Weak-agent failure mode to avoid: raw `stat`/`ls` output or generic prose ("tests pass") alone is NOT enough evidence. Any shell output must be paired with one of the accepted references above (an exact test name, test file path, ADR reference, or recognized repo command).
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Wire card carries PR reference and review facts | `test/web-transport.test.ts`, `"snapshot card DTO carries pullRequest, reviewApproved, and reviewHistory through a JSON round trip"` | PASS |
| Reproduction test green on final tree | `test/task-2447-repro.test.ts`, `npm test -- test/task-2447-repro.test.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- No changes to shared projection policy or read models: `attentionRank`, `agentIsWorking`, `availableBoardCommands`, `projectMissionCard`, `projectReviewHistory` behavior, and everything under `src/domain/`.
- No changes to the TUI (`src/interfaces/tui/`) or CLI rendering.
- No new npm runtime dependencies; no new devDependencies unless `react-dom/server` proves insufficient (see Stop Rules) — react, react-dom, and vite are already installed.
- No mutation endpoints, no SSE envelope changes, no host route logic changes.
- No copying of code or controller/state logic from the `.dc.html` design prototype into `web/src/` or `src/`.
- No client-side lifecycle inference, flag parsing, or link fabrication in React.

## Stop Rules
- Stop and split if the needed card fact is not already on the shared `MissionCard` (e.g., full per-checkpoint history): that is a projection mission, and this mission's transport must not invent data.
- Stop if any pre-existing consumer of the v1 wire shape is found (test fixture with a hard-coded v1 literal or external client); revisit the version-bump strategy before dropping v1 from the supported list.
- Stop if the web render tests require a DOM environment (jsdom/happy-dom); confirm with the operator before adding a dependency — `renderToString` is the expected path.
- Stop if bumping the transport version breaks `test/web-host.integration.test.ts` or `test/web-stream.test.ts` beyond the dynamic `WEB_TRANSPORT_VERSION` constant; the version bump must be mechanical, not a behavior change.

Reproduction-Test: test/task-2447-repro.test.ts
