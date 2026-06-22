# Changelog

All notable changes to parallix (`parallix/`) are recorded here. This project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning policy

parallix distinguishes three release states:

- **Local release candidate** — a `X.Y.Z` version built with `npm pack`. The
  manifest stays `private: true`; no registry entry exists. Until the first
  public release, the version scheme uses SemVer `X.Y.Z` with PATCH bumps for
  each integration cycle (e.g., `1.0.0` → `1.0.1` → `1.0.2`). Before each
  `px integrate`, the PATCH version is incremented; after a successful integrate,
  the operator reinstalls `px` globally from the new tarball with
  `npm install -g` to ensure the freshest binary. This is the current state.
- **Approved public release** — an `X.Y.Z` version published to a public
  registry. A public release is performed **only** after explicit human
  approval is recorded in a mission checkpoint, including the exact version,
  registry, and publish command. Until then `private: true` remains set and no
  publish runs.
- **Unpublished internal change** — work that lands in the repository (bug
  fixes, refactors, test changes) without producing a new release candidate or
  public release. Such changes are noted under "Unreleased" and folded into the
  next release-candidate entry.

Version bumps follow SemVer: MAJOR for incompatible runner/config contract
changes, MINOR for backward-compatible proven capabilities, PATCH for fixes.
Until the first public release, PATCH bumps increment with each integration
cycle (pre-integrate bump + post-integrate reinstall).

## [Unreleased]

### Changed

- **Relicensed from MIT to AGPL-3.0-or-later.** Replaced `LICENSE-MIT` with the
  full AGPL-3.0 text in `LICENSE`, updated the `package.json` `license` field and
  `files` array, and added a License section to `README.md`. The AGPL covers
  parallix and any modified or network-hosted fork; running `px` as a tool does
  not impose AGPL terms on the user's own project.

- **Renamed the source directory `workflow/` → `parallix/`, removed the
  `workflow/index.js` compatibility shim, and propagated the parallix/`px`
  naming convention** across source, documentation, prompts, templates, examples,
  `AGENTS.md`, `scripts/AGENTS.md`, agent prompt files, and operational docs
  (task-1242 + task-1299, ADR 0044). The `package.json` `name` is now
  `parallix` (was `visualboard-workflow`). `node parallix <command>` is
  the direct local entrypoint — `workflow/index.js` no longer exists. The `px`
  binary name, the `WORKFLOW_*` env-var namespace, the `.workflow/` runtime-data
  directory, and the `workflow.config.json` filename are unchanged.
- PATCH — bump version before integrate, reinstall after success. This policy
  ensures operators always run the `px` version that produced a change,
  preventing stale binaries from executing `px integrate` against outdated
  runtime fixes (e.g., `px shell-init` directory-switching from rc.3, Forgejo
  review opt-in from rc.2). The version scheme is SemVer `X.Y.Z` with PATCH
  bumps for each integration cycle until the first public release.

### Added

`px` directory-switching reaches the caller's shell. The previous `bin.px` ran
as a child process and could only print `[INFO] Next: cd …`, so a plain
`px draft` / `px integrate` never moved the operator's terminal — the same
limitation that made the separate sourced `w.sh` wrapper necessary.

- `px shell-init [bash|zsh]` — prints a `px` shell function for the operator's
  shell rc (`eval "$(px shell-init bash)"`). The function delegates to the
  installed binary via `command px` and performs the `cd` on
  `[INFO] Next: cd …` / `[INFO] Working directory: …` transitions, so a plain
  `px <command>` both runs the command and switches the terminal.

### Removed
- `workflow/w.sh` (and the repo-level `scripts/w.sh`). Superseded by the `px`
  shell function: a function always runs in the caller's shell, so it no longer
  needs `w.sh`'s sourced-vs-executed detection. `node parallix <command>` is
  unchanged and remains the no-install dispatcher (it does not change the
  caller's directory).

## [1.0.0-rc.3] — 2026-06-05

PATCH — Fixes `graphify update` scanning entire worktree (including `.workflow/sessions/`, agent caches, session logs, and tool state) by creating a `.graphifyignore` file during draft setup that excludes `.workflow/` from extraction. Also updates rc.2 changelog entry formatting.

### Fixed
- `ensureGraphifyIgnore` — new function in `draft.js` that creates and commits `.graphifyignore` during worktree setup, excluding `.workflow/` from graphify AST extraction
- graphify no longer wastes time/LLM cost extracting session logs, plugin caches, and agent state from `.workflow/` directories in mission worktrees

## [1.0.0-rc.2] — 2026-06-05

PATCH — Forgejo review is now opt-in by default. `isForgejoReviewEnabled()` returns `false` when `adapters.review.provider` is unset, removing Forgejo from the critical path when no review provider is configured. Fixes handoff Step 2 failing with "No Forgejo token found" on repos without review configuration (task-1236).

### Changed
- `isForgejoReviewEnabled` — null/missing provider now returns `false` instead of `true`
- `DEFAULT_CONFIG.review` comment updated to reflect opt-in semantics

### Fixed
- Handoff Step 2 no longer attempts Forgejo PR creation when review is not explicitly configured

## [1.0.0-rc.1] — 2026-06-05

First release candidate. Packaging and documentation prepared from the Phase 1–4
extraction evidence (TASK-1231 … TASK-1234) and ADR 0044. Not published.

### Added
- Release-facing guide appended to `README.md` covering the provisional `px`
  runner, cwd-based repo operation, proven workflow command delegation, the
  code-owned config contract, the six agent adapters and their bare-name
  `PATH` resolution, the safety model, and deferred future work.
- `CHANGELOG.md` with this versioning policy.
- `examples/` with caller-supplied temporary-target smokes for `verify-env` and
  enterprise tarball transfer.
- `README.md`: the canonical packaging and install guidance — `npm pack` →
  transfer the tarball → `npm install -g`, giving a single global `px` that
  replaces any prior install (no accumulation) and works offline.
- `package.json` release-candidate metadata: `license`, sharpened `description`,
  `bin.px`, and `CHANGELOG.md`, `docs/`, and `examples/` added to the packed
  `files` allowlist.

### Changed
- Default verification gate is now **no validation** when
  `adapters.verification.command` is not configured (previously `npm test`,
  which crashed with `npm ENOENT` in any non-npm target repo). parallix targets
  arbitrary repositories, so a repository opts into a real gate by declaring the
  command in `workflow.config.json`. `px --version`-style provenance and the
  `--no-gate` opt-out are unchanged.

### Unchanged (compatibility preserved)
- `node parallix <command>` behavior (sourced auto-`cd`, executed
  handoff, deleted-start-dir recovery, exit-code preservation).
- Agent adapter resolution, eligibility, and bare-command `PATH` semantics.
- `private: true`; no `exports`, install hooks, `publishConfig`, or registry
  metadata were added.

### Deferred (not in this release candidate)
- Public registry publication, release tags, and signing.
- Final `px` command taxonomy (`px init`, `px doctor`, presets, dry-run
  inventory, help redesign). The `bin.px` global-install entry point itself is
  proven and used by the enterprise transfer path.
- Final public package name, ownership, and repository URL.
- Artifact signing/provenance/SBOM and full enterprise approval; standalone
  binary and container artifacts. The bounded local tarball transfer via
  `npm install -g` is supported (see `README.md`).
