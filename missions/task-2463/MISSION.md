# Mission: first-time usage autodetect and write config (task-2463)

## Goal
On a fresh checkout with no working-tree config, Parallix probes the host for the
agent executables it can actually launch, then writes a `config/agents.json`
file whose per-step `eligible` lists only those available families. First-run
autodetection replaces the shipped default that names every supported agent for
every step, so `px config`, the board, and agent selection all see a
self-consistent, availability-filtered set instead of a list full of launchers
that are not installed.

## Why Now
Today a first-time user runs Parallix and every supported agent family
(`codex`, `claude`, `vibe`, `opencode`, `pi`, `qwen`, `custom`) is advertised as
eligible for every workflow step. The board and selection surface families the
user never installed, and the workflow burns real time (multi-second `--help`
health probes, then launcher-not-found failures) chasing launchers that are not
on the system. That wastes the user's first two minutes and confuses them before
they have a config to trim the list. Autodetection on first write makes the
default config match the machine, removing that friction at the exact moment it
matters.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: user onboarding friction, first-run configuration gap

## Scope
- Detect first run: no working-tree `config/agents.json` exists (the shipped
  bundled copy under the package root, per ADR 0044, is not "present" for this
  purpose).
- Probe availability for every workflow agent family using the existing
  launcher probe (`workflowLauncherStatus` / `commandInPath` plus the `--help`
  health probe in `src/adapters/agents/launcher-selection.ts`), with an
  injection seam so tests never spawn a real CLI.
- Write a working-tree `config/agents.json` whose `steps.draft`, `steps.active`,
  and `steps.review` `eligible` arrays contain only families whose launcher is
  available on the host, preserving any existing `selection`/`weights` shape and
  the `_comment`/`_weights_comment` documentation keys.
- Make `px config` generate (or refresh) this file on demand in addition to its
  current read-only print, so the autodetected config is discoverable and
  reproducible.
- Keep the write idempotent: once a working-tree `config/agents.json` exists,
  subsequent runs leave it untouched (user edits win).

## Out of Scope
- Changing which agents are supported or adding new agent families/adapters.
- Editing the bundled default `config/agents.json` to filter agents there; the
  shipped default stays the full list, filtering happens only in the written
  working-tree copy.
- Per-user interactive prompts to pick agents; detection is automatic and
  overridable by editing the written file.
- Persisting detection results in any store other than the working-tree config
  file.
- Native SEA/npm distribution changes (ADR 0044/0046 surface).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- A fresh working tree with no `config/agents.json` receives a written
  `config/agents.json` whose `steps.draft.eligible`, `steps.active.eligible`,
  and `steps.review.eligible` contain exactly the families whose launcher
  `workflowLauncherStatus` reports `supported: true` on the host, and no others
  (verified by `test/first-run-config-autodetect.test.ts`).
- When a family's CLI is absent, its name does not appear in any written
  `steps.*.eligible` array; when present and healthy, it does (same test file).
- A pre-existing working-tree `config/agents.json` is left byte-for-byte
  untouched on a second run (no overwrite of user-authored eligibility), asserted
  in `test/first-run-config-autodetect.test.ts`.
- Existing `selectAgent` selection behavior is unchanged: it still filters its
  pool by `workflowLauncherStatus` support, and the written config does not drop
  any family that selection could previously have chosen (checked via
  `test/domain-agent-selection.test.ts` and `test/agents.test.ts`).
- `px config` exits non-zero with a clear message when the working directory is
  not a repository root, and prints the effective config as before when run in
  read-only mode (checked via `test/config-command.test.ts`).
- `config/agents.json` written by the feature validates against
  `config/workflow.config.schema.json` and matches the shape consumed by
  `readAgentConfig`/`eligibleAgentsForStep` (no `_comment`/`_weights_comment`
  keys break parsing).
- No new lint errors and no typecheck regressions on changed files under
  `./scripts/verify-local.sh static-analysis`.

## Risks and Assumptions
- Detection shells out to real CLIs (`command -v` + `--help`). This is slow
  (hundreds of ms per family) and environment-dependent; it must run once at
  first write, never per render or per selection. Assumption: first-run hook is
  called at workflow-command entry, not on every probe.
- The `custom` family resolves to a runner (`opencode` or `pi`) via
  `resolveCustomRunner`; availability for `custom` must be judged against that
  runner, not a literal `custom` executable.
- Writing into the working tree risks clobbering a user's config. Assumption:
  gated strictly on "no working-tree file exists", and the write is idempotent.
- The bundled default under the package root (ADR 0044) must stay the full list;
  filtering lives only in the written copy, else published builds change behavior
  for configured users.
- Health-probe flakiness (a CLI present but slow to answer `--help`) could drop a
  valid family from the eligible list. Assumption: reuse the existing probe's
  timeout rather than inventing a new one.

## Checkpoints
- CP 1 (draft): audit current config-load and agent-selection flow; pin the exact
  first-run hook location and the availability seam; record the chosen config path
  and family list in the checkpoint doc.
- CP 2 (draft): author the failing reproduction/behavior test that locks the
  first-run write contract before the fix.
- CP 3 (execute): implement first-run detection, availability filtering, and the
  `config/agents.json` write; wire `px config` generation.
- CP 4 (integrate): run the verification gate and close every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/first-run-config-autodetect.test.ts` ``, `` `px config ` ``, `` `./scripts/verify-local.sh static-analysis` ``, or `` `node -e "..."` ``
  2. **Test names** — must match a test name in the repo (see the tests named in Success Criteria)
  3. **Test file paths** — e.g., `test/first-run-config-autodetect.test.ts`, `test/config-command.test.ts`, `test/domain-agent-selection.test.ts` (must be existing test files)
  4. **ADR references** — e.g., `ADR 0044` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Example of a weak row: a bare `ls config/` showing `agents.json` with no test name or repo command. That alone does not prove the contract; add `` `npm test -- test/first-run-config-autodetect.test.ts` `` next to it.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft audit pins first-run hook and availability seam | `test/domain-agent-selection.test.ts`, `"selectAgent still filters pool by launcher status"` | PASS |
| First-run write contract is specified | `docs/adr/0044-workflow-distribution-model.md` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify the npm/SEA distribution build (`scripts/build-sea.ts`, `scripts/sea-surfaces.ts`, `build/manifest.json`) or the package publish contract.
- Do not change the supported agent family list or add new agent adapters (`src/adapters/agents/`).
- Do not alter persistence authority or the state-map (`src/adapters/config/state-map.ts`, `docs/adr/0053-*`).

## Stop Rules
- Stop before implementing if the audit shows the working-tree vs bundled `config/agents.json` distinction is not where `steps.*.eligible` is resolved; re-scope the config path before writing code.
- Stop if first-run detection would need to run per-selection or per-render; that violates the once-at-first-write constraint and must be re-planned.
- Stop if a required availability seam cannot be injected without spawning real CLIs in tests; the test must not launch a real agent CLI.
- Stop if the write cannot be gated strictly on "no working-tree file exists"; idempotency is non-negotiable.
