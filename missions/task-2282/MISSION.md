# Mission: Ink TUI wave 1 — `px ui` shell and import-boundary guardrails (task-2282)

## Design Authority

**Authoritative design artifact:** `/tmp/Parallix Kanban Board Controller.zip` (Parallix Board.dc.html)

This is the interactive HTML prototype that defines the board layout, visual structure, and data presented. All TUI waves derive their rendering from this design. The prototype shows:

- **Top bar**: `px board` title, repo path, WIP/attention counts, flow toggle
- **Agent family strip** (wave 2+): colored agent status indicators
- **Flow panel** (wave 3+): cumulative flow diagram, median cycle times, bottleneck read
- **Attention rail** (wave 1): "NEEDS YOU NEXT" — ranked items needing operator attention
- **Board columns** (wave 1): INTAKE (refined + backlog), IN-FLIGHT (active, review, integrate), SHIPPED (collapsible, wave 4+)
- **Mission cards** (wave 1): slug, title, agent, checkpoint, gate, flags, review info, actions
- **Command log** (wave 1): recent operations with timestamps

Wave 1 renders this layout as a **static read-only text dump** (Ink's non-TTY behavior). No keyboard navigation, selection, or actions beyond `q`/Ctrl+C exit.

## Goal

Promote React and Ink from the TASK-2277 spike into production dependencies, deliver a static `px ui` shell that renders the board layout from the design artifact (attention rail, columns with mission cards, operation log), and install import-boundary tests that enforce the ADR 0051 rule: application and domain modules must not import UI frameworks.

## Why Now

ADR 0044 names Ink as the terminal UI framework. ADR 0042 (TASK-2310) clarifies the single-stack direction: Ink is the eventual rendering framework for all terminal output, motivated by the agent-hallucination cost of maintaining two competing terminal paths.

TASK-2277 proved Ink is feasible in a disposable spike (`proofs/task-2277-local-runtime/`), but the production `package.json` has no React, no Ink, no JSX build, and no TSX lint/type config. Nothing in `src/interfaces/` renders. TASK-2302 lands the concrete read adapters and wires `BoardProjectionBuilder` in the composition root, so a real `BoardProjection` is obtainable. This wave promotes React/Ink to production, consumes `BoardProjection` read-only in the layout defined by the design artifact, and establishes the import-boundary enforcement before waves 2-7 (TASK-2304 through TASK-2309) add interactive TUI features.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-as after TASK-2281 and TASK-2302 reach `done`
- Main drivers: new production dependencies (react, ink, @types/react) with JSX/TSX build config; new `src/interfaces/tui` directory with shell component rendering the design layout; `px ui` wiring through composition root; import-boundary guardrails; bundle-size rebaseline; eslint config update for `.tsx`

## Scope

- Promote `react`, `ink`, and `@types/react` from the TASK-2277 spike into production `package.json` (matching spike versions: react 19.2.3, ink 6.8.0, @types/react 19.2.14).
- Add JSX/TSX build configuration: update `tsconfig.json` with `jsx: "react-jsx"`, and update `eslint.config.mjs` to lint `.tsx` files with the TypeScript parser and JSX support.
- Create `src/interfaces/tui/` with a static shell component that renders the board layout from the design artifact:
  - **Attention rail**: ranked items from `BoardProjection.attentionQueue` with reason and card slug
  - **Board columns**: INTAKE (refined + backlog), IN-FLIGHT (active, review, integrate), SHIPPED — each showing `BoardProjection.stages` cards
  - **Mission cards**: slug, title, agent, checkpoint, gate status, flags, review info from `MissionCard`
  - **Operation log**: recent entries from `BoardProjection.operationLog`
  - **Staleness indication**: integrated into the top bar or column headers via `BoardProjection.sourceFacts`
- Wire `px ui` command entry through the composition root in `src/entry/px.ts` (or the platform runtime dispatcher), obtaining one `BoardProjection` from TASK-2302's concrete adapters.
- `px ui` exits cleanly on `q` keypress and on Ctrl+C, restoring the terminal, with non-zero exit only on real failure.
- Import-boundary guardrail test: fails if any `src/application/` or `src/domain/` module imports `react`, `ink`, or a terminal-rendering module other than as a type-only port definition (enforces ADR 0051 inward-dependency rule).
- Headless-isolation test: asserts the module graph of the headless entry contains no `react` or `ink` module; existing CLI output and exit codes remain unchanged.
- Re-baseline the canonical ESM bundle (`build/px.mjs`) with Ink included; record the new bundle-size baseline.
- Component tests assert rendered semantics (values, not pixel snapshots) using a mocked `BoardProjection` port; no test launches an agent, contacts Forgejo, or runs a real workflow command.
- Rollback proof: removing the `px ui` entry and `src/interfaces/tui/` directory leaves headless commands, bundle, and gates green.

## Out of Scope

- Agent family strip with live status polling (wave 2, TASK-2304).
- Flow panel with CFD chart, median cycle times, bottleneck read (wave 3, TASK-2305).
- Keyboard navigation, card selection, mission detail view (wave 4, TASK-2306).
- Action buttons and command dispatch from the board (wave 5, TASK-2307).
- Drag-and-drop lane transitions (wave 6, TASK-2308).
- Shipped column collapse/expand and historical rollup (wave 7, TASK-2309).
- PTY smoke coverage beyond launch+exit.
- Any change to no-command invocation (`px` with no command keeps current behavior).
- SQLite, database cutover, or web UI.
- Changes to `src/application/` or `src/domain/` module content (only new import-boundary tests reference them).
- ESM SEA or native executable targets (TASK-2286).

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple") without an attached metric and vague quantifiers ("multiple, several, some").

- SC1: `package.json` lists `react`, `ink`, and `@types/react` as dependencies; `tsconfig.json` includes `jsx: "react-jsx"`; `eslint.config.mjs` has a `.tsx` lint rule; `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` pass with zero errors on the changed tree.
- SC2: Running `npm run dev -- ui` renders the board layout matching the design artifact: attention rail with ranked items, board columns (INTAKE/IN-FLIGHT/SHIPPED) with mission cards showing slug/title/agent/checkpoint/gate, and operation log at the bottom — all from a single `BoardProjection` obtained via the composition root.
- SC3: `px ui` exits with code 0 on `q` keypress and on Ctrl+C, restoring terminal cursor and formatting; exit code is non-zero only on real failure.
- SC4: A test under `test/` asserts the headless entry module graph contains no `react` or `ink` module; existing headless command tests pass with unchanged output and exit codes.
- SC5: An import-boundary test fails if any file under `src/application/` or `src/domain/` imports `react`, `ink`, or a terminal-rendering module except as a type-only port definition.
- SC6: The canonical ESM bundle builds (`npm run build` produces `build/px.mjs` with Ink included); the bundle-size gate records the new baseline value.
- SC7: Component tests under `test/` assert rendered semantics using a mocked `BoardProjection` port; no test launches an agent, contacts Forgejo, or runs a real workflow command.
- SC8: Removing the `px ui` entry and `src/interfaces/tui/` directory leaves headless commands, bundle build, and verification gates green — proven by test or documented revert evidence.

## Risks and Assumptions

- Ink 6.8.0 and React 19.2.3 are the proven versions from TASK-2277; if a newer major version has shipped, the spike versions are retained to match the feasibility proof.
- The esbuild `createRequire` banner (already present in `scripts/build-canonical-bundle.js`) is required for Ink's CommonJS code to access Node built-ins.
- TASK-2302 must be `done` before this mission activates, otherwise `BoardProjectionBuilder` and concrete read adapters are unavailable and the shell cannot render real data.
- The existing `tsconfig.json` already includes `src/**/*.tsx` in its `include` array; the primary tsconfig change is adding `jsx: "react-jsx"`.
- Adding React/Ink to the bundle increases bundle size significantly (TASK-2277 spike produced ~2.4 MB); the bundle-size gate must be rebaselined rather than enforced against the pre-Ink value.
- The `px ui` command is read-only and does not exercise any mutation ports; lifecycle correctness is verified by existing headless tests, not by this mission.
- The `BoardProjection` data model (`src/application/projections/board.ts`) already provides `attentionQueue`, `stages`, `operationLog`, and `sourceFacts` — all fields the design layout requires. No changes to the projection model are needed in this wave.

## Checkpoints

- CP 1: Add React/Ink production dependencies and JSX/TSX build configuration. Update `package.json` with `react`, `ink`, and `@types/react`. Update `tsconfig.json` with `jsx: "react-jsx"`. Update `eslint.config.mjs` with a `.tsx` lint rule using the TypeScript parser and JSX support. Verify `./scripts/verify-local.sh all` passes.
- CP 2: Create `src/interfaces/tui/` with the shell component rendering the design layout and wire `px ui` entry. Implement `BoardShell` rendering attention rail, board columns with mission cards, and operation log from `BoardProjection`. Wire `px ui` through the composition root. Verify launch and clean exit with `q` and Ctrl+C.
- CP 3: Add import-boundary guardrails, re-baseline bundle, and capture rollback proof. Write the import-boundary test enforcing ADR 0051 (no react/ink in `src/application/` or `src/domain/` except type-only ports) and the headless-isolation test (no react/ink in headless entry module graph). Build the canonical ESM bundle with Ink included and record the new bundle-size baseline. Prove rollback by verifying headless commands, bundle, and gates remain green when `px ui` entry and `src/interfaces/tui/` are absent.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/interfaces/tui/shell.tsx:42` (must point to an existing file and line)
  2. **Test names** — e.g., `"headless entry module graph contains no react or ink"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/tui-import-boundary.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm run build` ``, `` `npm run dev -- ui` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| React/Ink in production dependencies | `package.json`, `react@19.2.3` listed under dependencies | PASS |
| JSX build config added | `tsconfig.json`, `"jsx": "react-jsx"` | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates

- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `src/application/` and `src/domain/` — do not modify existing module content; only new test files reference these paths for import-boundary enforcement.
- `src/entry/px.ts` — wire `px ui` entry without changing existing headless dispatch logic.
- `lib/` — do not modify; this mission operates in `src/` and `test/`.
- `backlog/` task and mission files outside this mission — do not modify.

## Stop Rules

- If TASK-2302 is not `done` (BoardProjectionBuilder and concrete read adapters unavailable), pause this mission and wait for TASK-2302.
- If adding React/Ink breaks the canonical ESM bundle build (`npm run build`) in a way that is not resolved by the esbuild `createRequire` banner proven in TASK-2277, stop and escalate before adding more TUI features.
- If the import-boundary test cannot be implemented without modifying `src/application/` or `src/domain/` source files, stop and revisit the scope — the mission must not change application/domain content.
- If the bundle-size increase exceeds 5 MB (beyond TASK-2277 spike's ~2.4 MB), stop and investigate tree-shaking or conditional import strategies before proceeding.
