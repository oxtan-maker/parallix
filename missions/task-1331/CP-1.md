# CP-1: Inventory and decide

## Summary

Inventoried the files that define parallix's public distribution story and classified every
current `visualBoard` reference as current-product branding (must change) versus historical /
evidence / internal path (preserve). Locked the near-term distribution model before editing
broad copy.

### Distribution model decision (locked)

**Local npm tarball, globally installed `px` CLI — no registry publish.** This is the model
the README "Canonical packaging and install" section (`README.md:235-271`) already describes
and that the repo already ships the machinery for:

- `px.js` runner + `bin.px` entry in `package.json:7-9`.
- `files` allowlist in `package.json:10-24`.
- Node `--test` suite as the only configured gate (`package.json:26`, `workflow.config.json`
  → `adapters.verification.command`).

Concrete public story to align all surfaces to:
- **Acquire/install:** `npm pack ./parallix` → `npm install -g ./parallix-*.tgz` (or
  `--prefix "$HOME/.local"` without sudo).
- **Invoke:** `px <command>` (global runner); `px shell-init` for `cd`-on-transition.
- **Source-compatible local dev:** `node parallix <command>` / `node index.js` runs directly
  from source, unchanged.
- **Not yet supported:** registry (npm) publish, standalone binary, Homebrew, Docker, CI
  release automation.
- **Package name:** scoped `@magnusekdahl/parallix` per ADR 0044 `px`-namespace-risk resolution
  (`docs/adr/0044-workflow-distribution-model.md:72-77`), so the unscoped `px`/`parallix` npm
  names are not relied upon.

This stays inside scope (document + align the supported near-term path) and does not trip any
Stop Rule — no external registry ownership, scope ownership, or enterprise policy input is
required to document a local-tarball install.

### `visualBoard` reference classification

**Change (current-product branding):**
- `README.md:3` — "visualBoard AI mission lifecycle" framing of the current product.
- `templates/vibe/skills/*/SKILL.md` (7 skills: act-on-review, area-review, draft, execute,
  integrate, portfolio, review) — each `description:` line and "thin entrypoint for the
  visualBoard … workflow" line describes the *current* product.

**Preserve (explicitly historical / evidence / internal path — out of scope per mission):**
- `README.md:95` — "this table reflects visualBoard's areas" is explicitly historical
  (called out in MISSION Risks line 92).
- `docs/adr/0041-*.md` and `docs/adr/index.md:19` — historical ADR evidence and an external
  path citation (`/home/magnus/code/visualBoard-task-1302/...`).
- `lib/commands/coverage-gate.js:74` — `'visualBoard-task-'` is an internal test-temp-dir
  prefix in a path-class fixture list, not public-facing output.
- `test/*.test.js` — `/tmp/visualBoard*` and `visualBoard-task-*` are internal temporary test
  paths/fixtures (MISSION Out-of-Scope line 56-57).
- `backlog/archive/**`, `backlog/completed/**`, other `backlog/tasks/*`, `missions/task-1318`,
  `missions/task-1322` — archived/historical artifacts (Restricted Areas).

No test asserts on `package.json` `private`/`description`/`name` fields or on SKILL.md template
copy (`grep` over `test/` found only the `bin/px` install-path check in
`test/package-persistent-data.test.js:68`), so CP-2/CP-3 edits to those surfaces are not
expected to require test changes.

## Goal Check

| Mission item | Status | Evidence |
|---|---|---|
| Identify files defining public distribution story | Done | `package.json:1-32`, `README.md:235-271`, `docs/adr/0044-workflow-distribution-model.md:3` (`Status: Proposed`) |
| Confirm package.json contradictions | Done | `package.json:6` (`"private": true`), `package.json:4` (`"…unpublished"`) |
| Classify current-product vs historical `visualBoard` refs | Done | change: `README.md:3`, `templates/vibe/skills/*/SKILL.md:3,9`; preserve: `README.md:95`, `docs/adr/index.md:19`, `lib/commands/coverage-gate.js:74`, `test/*` temp paths |
| Lock near-term distribution model before broad edits | Done | Local tarball `px` model documented above; matches `package.json:7-24` shipped machinery |
| ADR 0044 linkage confirmed for CP-2 | Done | `docs/adr/index.md:15` links 0044 |

## Next action

In CP-2, edit `package.json` (set `private:false`, scoped `name:"@magnusekdahl/parallix"`, rewrite
`description` to drop "unpublished", add `publishConfig`/`engines` as consistency metadata),
rewrite the `README.md:3` opener and add/clarify one explicit public-distribution section
answering install/invoke/source-dev/not-yet-supported, and move
`docs/adr/0044-workflow-distribution-model.md` off `Status: Proposed` to record the selected
local-tarball stance with current evidence.
