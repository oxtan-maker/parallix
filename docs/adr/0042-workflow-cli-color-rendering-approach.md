# ADR 0042: Workflow CLI Color Rendering Approach

Status: Proposed
Date: 2026-05-23

## Context

The workflow CLI (`workflow/lib/fmt.js`) uses hand-rolled ANSI escape codes for terminal coloring. The current `useColor()` function has a bug: lines 53–58 are unreachable dead code after an unconditional return on line 52, meaning the CI, COLORTERM, and isTTY fallback checks never execute. This has caused intermittent "sometimes colors, sometimes not" behavior (task-1132).

The workflow CLI's zero-dependency philosophy (Node.js built-ins only, no npm packages) constrains the solution space: adding `chalk`, `picocolors`, or `ink` would violate this principle.

Node.js v21.7+ ships `util.styleText(format, text)`, which:
- Handles `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb`, and stream TTY detection automatically
- Supports all the color names the workflow already uses: `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `bold`, `dim`
- Maps `gray`/`grey` to `\x1b[90m` — the exact code the workflow currently calls "dim"
- Uses proper per-format close codes (e.g., `\x1b[39m` for colors, `\x1b[22m` for bold) instead of a blanket `\x1b[0m` reset, enabling correct nesting
- Supports compound formats via array: `util.styleText(['bold', 'red'], text)`

This project runs Node v24.15.0; `util.styleText` is fully stable.

The Gemini CLI (`google-gemini/gemini-cli`) was examined as a reference point. Its CLI package uses `chalk` v4 + `ink` (React for terminals) + `ink-gradient` + `ink-spinner` + `ansi-escapes` — a heavy stack suited for rich interactive UIs. The core package uses no color library at all; it delegates rendering entirely to the CLI layer. The relevant takeaway is not the specific libraries, but the pattern: **use the platform's native capabilities for color detection rather than reimplementing it**.

## Decision

Replace the hand-rolled ANSI palette and `useColor()` function in `workflow/lib/fmt.js` with Node.js built-in `util.styleText()`.

## Decision matrix

| Option | Summary | Benefits | Risks / Costs | Fit to constraints | Decision |
|--------|---------|----------|---------------|--------------------|----------|
| A: `util.styleText` | Node.js built-in color API | Zero deps; auto color detection handles NO_COLOR/FORCE_COLOR/TERM/TTY correctly; proper close codes enable nesting; maintained by Node core | Tests must update expected ANSI close codes (`\x1b[0m` → `\x1b[39m` etc.); requires Node ≥21.7 (project already on v24) | Perfect — maintains zero-dep philosophy | **Accept** |
| B: `chalk` v4 | Most popular Node color lib | Battle-tested, rich API, CJS compatible | Adds npm dependency + `supports-color` transitive dep; violates zero-dep constraint | Poor — introduces external dependency | Reject |
| C: `picocolors` | Ultra-light color lib (~3KB) | Tiny, fast, CJS, auto detection | Still an npm dependency; basic API | Poor — still a dependency | Reject |
| D: Fix hand-rolled | Patch `useColor()` dead code | Minimal change, keeps existing API | Reinvents color detection that Node.js already provides; fragile; more code to maintain | Acceptable but inferior | Reject |
| E: Ink (Gemini CLI style) | React for terminals | Powerful interactive components; chosen interactive TUI stack per ADR 0051; eventual single-stack direction for all terminal output to eliminate two-path maintenance | Massive dep tree (react, ink, chalk); CJS incompatible; overkill for batch/headless status output | Wrong tool for batch CLI color; correct for the interactive TUI (ADR 0051). Converging on Ink for all terminal output reduces agent hallucination from maintaining two rendering frameworks | Reject for batch CLI color; use `util.styleText` here. Ink is the chosen TUI stack and eventual direction for all terminal output (ADR 0051) |

## Consequences

### Positive consequences

- **Color detection is correct by default.** `util.styleText` handles NO_COLOR, FORCE_COLOR, TERM=dumb, and stream TTY detection without any custom logic. The entire `useColor()` function and `_colorCache` can be removed.
- **Proper ANSI nesting.** Per-format close codes (`\x1b[39m` for color, `\x1b[22m` for bold) replace blanket `\x1b[0m` resets, so `bold(green(text))` works correctly.
- **Zero new dependencies.** Stays within the workflow's Node-built-ins-only constraint.
- **Reduced maintenance surface.** The `colors` object (raw escape codes), `useColor()`, `_colorCache`, and `resetColorCache()` are replaced by a single stdlib call.
- **Compound styling.** `util.styleText(['bold', 'cyan'], text)` replaces manual escape concatenation.

### Negative consequences

- **Test assertions change.** Tests that assert specific ANSI sequences (e.g., `\x1b[32m[PASS]\x1b[0m`) must update to the new close codes (`\x1b[32m[PASS]\x1b[39m`). The `stripAnsi` regex also needs to cover close codes like `\x1b[22m`, `\x1b[39m` (it already does — the existing regex `\x1B\[[0-9;]*m` matches these).
- **Minimum Node version floor rises to 21.7.** Not a practical concern (project is on v24), but worth documenting.
- **Semantic rename: `dim()` → `gray()`.** The current `dim()` function uses `\x1b[90m` (bright black / gray), not the ANSI dim modifier (`\x1b[2m`). With `util.styleText`, the correct format name is `'gray'`. Callers of `fmt.dim()` should be audited — if they mean "gray text", the function should be renamed; if they mean "actually dim", it should use `'dim'`.

## Alternatives considered

### chalk v4 (CJS)

Positive:
- Proven in production across thousands of projects
- Clean chainable API (`chalk.bold.red(text)`)
- Solid color detection via `supports-color`

Negative:
- Adds an npm dependency to a zero-dependency package
- `supports-color` as a transitive dep introduces another moving part
- Unnecessary now that Node.js provides the same capability built-in

### picocolors

Positive:
- ~3KB, extremely fast
- CJS compatible, drop-in simple API

Negative:
- Still an external dependency
- Basic API (no nesting, no compound styles)
- Less well-maintained than Node core

### Keep hand-rolled, fix the dead-code bug

Positive:
- Smallest diff
- No behavior change in close codes

Negative:
- Re-implements color detection that Node.js already handles correctly
- The `_colorCache` pattern is fragile (requires `resetColorCache()` in tests)
- More surface area to maintain and get wrong again

### Ink (React for terminals)

Ink is the chosen interactive terminal UI stack for Parallix per ADR 0051
(`px` / `px ui` entry points). This ADR does not reject Ink as a terminal framework; it
scopes batch color rendering (the concern of this ADR) from the interactive TUI.

The forward direction is **one rendering framework for all terminal output**. The
motivation is not richer visuals — it is that two terminal rendering frameworks create
two paths agents forget to maintain. When errors, progress, or output can flow through
either raw `console.log`/ANSI or Ink, agents updating one component will miss the other
path most of the time. This snowballing effect is the main driver for converging on Ink
for all terminal commands, including current headless console output. The single-stack
direction eliminates the hallucination surface that two competing frameworks introduce.

In the current scope, batch/headless CLI output — status lines, tables, exit-coded
`--json` commands that must never initialize React, Ink, or cursor control — is served by
`util.styleText`. The rich interactive TUI is served by Ink. Choosing `util.styleText` for
batch color rendering does not contradict adopting Ink for the interactive layer or the
eventual single-stack direction.

Positive:
- Extremely powerful for interactive UIs (spinners, layouts, live updates)
- Component model scales to complex interfaces
- The chosen stack for the interactive Parallix TUI (ADR 0051)
- Single rendering framework eliminates the agent-hallucination surface of maintaining
  two competing terminal paths

Negative (as a batch CLI color solution specifically):
- Massive dependency tree (react, ink, chalk, and dozens of transitive deps) for what
  batch output needs
- ESM-only in recent versions; CJS fork exists but is unofficial
- Architectural overkill for batch status output and tables, which must stay headless and
  must not initialize React/Ink
- Would require rewriting the entire fmt.js layer as React components

## Links

- [ADR 0051](0051-ui-neutral-application-boundary.md) — Ink is the chosen interactive terminal UI stack and eventual direction for all terminal output; this ADR's `util.styleText` decision applies to batch/headless CLI color rendering. The single-stack direction (Ink for all terminal output) reduces agent hallucination from maintaining two rendering frameworks
- [Node.js `util.styleText` docs](https://nodejs.org/api/util.html#utilstyletextformat-text-options)
- [NO_COLOR standard](https://no-color.org/)
- [Gemini CLI package.json](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/package.json)
- [task-1132: workflow coloring in terminal is unstable](../missions/2026/task-1132/MISSION.md)

## Reconciliation addendum (2026-07-27, task-2288)

The original decision to replace hand-rolled ANSI coloring with `util.styleText()` for batch/headless CLI output and Ink for the interactive TUI remains in effect. The CLI entry point is now the canonical ESM bundle `build/px.mjs` (ADR 0044), which inlines the fmt layer. The transitional CommonJS `dist/` tree has been retired (task-2288); the batch color rendering decision applies to the bundled `build/px.mjs` runtime. The single-stack direction — converging all terminal output to Ink — is unchanged.
