# Mission: Let every agent family persist its credentials and state under the bubblewrap sandbox (task-2443)

## Goal
Make every launcher family's credentials and state persist inside the bubblewrap sandbox at **every** workflow step, not only `review`: derive each family's minimum writable host paths from `src/adapters/config/state-homes.ts` (the single source launchers already use), grant them from `resolveSandboxProfile` for non-review steps, seed `qwen`'s `oauth_creds.json` the way `settings.json` is already seeded, and make an auth/expired-credential launch failure visible to the operator (family named, refresh instruction given) instead of a silent reroute to the next agent family.

## Why Now
Agent launches have been failing daily since 2026-08-21 (15 mission transcripts under `~/.claude/projects/` carry `API Error: 401 OAuth access token has expired` plus `EROFS: read-only file system, mkdir '<home>/.claude/session-env/...'`), matching the sandbox landing (2026-08-13/14) and its tightening (2026-08-21). Claude's access token expires every ~8 hours while its refresh token lives ~2 weeks, but the sandbox mounts the host read-only (`--ro-bind / /`) and only the `review` branch grants launcher state homes — so a refresh can never be persisted and every later launch fails until a human refreshes outside the sandbox. The failure is classified non-blocking by `NON_BLOCKING_LAUNCH_ERROR_PATTERNS`, so the workflow silently reroutes; when `claude` falls back to `codex`, `codex`'s symlinked `auth.json` hits the same read-only mount and both families are dead at once. Every mission on this machine is currently dependent on manual out-of-band token refresh.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate as-is; the per-family argv tests (AC#8–#10) are the main line driver — if the final diff exceeds 235 NEL, move the CP-4 diagnostic into a follow-up task rather than shrinking the fix
- Main drivers: 4 source files touched (`src/adapters/config/state-homes.ts`, `src/adapters/process/bubblewrap.ts`, `src/adapters/agents/qwen.ts`, `src/adapters/agents/agents.ts`) plus 2 test files; one logical fix through the existing `resolveSandboxProfile` seam, with the qwen seed and the operator-facing diagnostic as two small independent additions

## Scope
- New single-source state paths in `src/adapters/config/state-homes.ts`: the claude credentials file (`~/.claude/.credentials.json`), the claude session-env dir (`~/.claude/session-env`), and the codex host auth file (`~/.codex/auth.json`, honoring the `CODEX_HOME` override the codex launcher already resolves via `originatingCodexStateRoot`).
- `resolveSandboxProfile` in `src/adapters/process/bubblewrap.ts` grants the family's launcher state homes for **every** step: the non-review branch unions the family state homes with the existing worktree + Git-metadata + `/tmp` set, and the `review` and non-review branches share one per-family state-home resolver so the two sets cannot drift (AC#1, #7).
- `ensureQwenHome` in `src/adapters/agents/qwen.ts` seeds `oauth_creds.json` from the operator's `~/.qwen/oauth_creds.json` into the worktree-local `QWEN_HOME` alongside `settings.json`, tolerating an absent source file exactly as the settings path already does (AC#5).
- `src/adapters/agents/agents.ts`: when a launch fails on an authentication or expired-credential error, the operator-facing log names the family and states that its credentials need refreshing, before the existing reroute proceeds (AC#11).
- Unit tests: the red reproduction test plus per-family bwrap-argv assertions for a non-review launch of `claude`, `codex`, `opencode`, `pi`; a no-cross-family / no-host-home-write-for-`vibe`-`qwen` assertion; and the qwen credential-seed present/absent test (AC#8–#10).

## Out of Scope
- Disabling or bypassing bubblewrap; the base read-only mount (`--ro-bind / /`) and the `PARALLIX_NO_BUBBLEWRAP` escape hatch stay.
- Any writable bind for `$HOME`, or for `~/.claude`, `~/.codex`, `~/.qwen`, `~/.config`, `~/.local`, or `~/.cache` as a whole.
- Changing agent-selection, fallback, or blocklist policy beyond the additive diagnostic log line (auth errors stay classified exactly as today).
- `vibe` launcher behavior (already correct: it copies static config into the worktree home).
- The worktree-local `.workflow/` home layout of codex/qwen/vibe, and codex's `config.toml` symlink handling.
- Pushing the mission branch to `origin` (local-only development rule).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: For each of `claude`, `codex`, `opencode`, `pi`, the argv produced by `buildBubblewrapArgs(resolveSandboxProfile(<non-review step>, worktree, null, <family>))` contains a writable `--bind` entry for **each** path in that family's state set and still contains `--ro-bind / /` (AC#1, #8).
- SC2: The state sets are exactly: `claude` = { `~/.claude/.credentials.json`, `~/.claude/session-env`, `claudeProjectDir(worktree)` }; `codex` = { the host `auth.json` that `replaceWithLink` targets, honoring `CODEX_HOME` }; `opencode` = `opencodeStateHomes()`; `pi` = `piStateHomes()`; `custom` resolves to its configured runner's set (AC#2–#4).
- SC3: Every host path appearing in any step's writable set is an export of `src/adapters/config/state-homes.ts`, and the `review` branch and the non-review branch derive their family state homes from the same per-family source (AC#7).
- SC4: No family's writable set contains `$HOME`, a whole family directory (`~/.claude`, `~/.codex`, `~/.qwen`), or any other family's state path; `vibe` and `qwen` gain no host-home writable bind at any step (AC#6, #9).
- SC5: `ensureQwenHome` copies `~/.qwen/oauth_creds.json` into the worktree-local `QWEN_HOME` when the source exists, and when the source is absent the generated `settings.json` content and home layout are byte-identical to current behavior (AC#5, #10).
- SC6: When a launch failure message matches an authentication or expired-credential error, the operator-facing log contains the family name and a credentials-need-refreshing statement; the reroute itself and the `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` classification outcome are unchanged, and non-auth launch failures produce no such line (AC#11).
- SC7: `test/task-2443-repro.test.ts` fails (red) at the mission parent commit on the per-family writable-bind assertions and passes (green) after the fix; the qwen seed test covers both present and absent source (AC#8–#10, DOD#4).
- SC8: `./scripts/verify-local.sh all` exits 0 on the final tree (AC#12, DOD#7).

## Risks and Assumptions
- Leaf-file binds (`~/.claude/.credentials.json`, `~/.codex/auth.json`) fail in bwrap when the source file is absent (fresh install, first run). The implementation must tolerate absent leaves (bind only files that exist, or an explicitly handled absence) and a test must cover the absent-file case. If file-leaf binds prove unreliable on the installed bwrap, stop per Stop Rules rather than widening to a parent directory.
- A writable credentials file means a confined agent process can read and modify its **own** family's credentials. This is the same threat class as today's review-step state-home writes (the agent already runs the launcher CLI with network access); accepted, but the set must never include another family's paths.
- If the *refresh* token has expired (~2 weeks), no sandbox change helps; the SC6 diagnostic is the operator's only signal until manual re-authentication.
- `opencodeStateHomes()` honors `XDG_DATA_HOME`/`XDG_CONFIG_HOME`/`XDG_CACHE_HOME`; argv tests must pin or explicitly unset those env vars so assertions are deterministic.
- The codex host auth path must honor `CODEX_HOME` the way `originatingCodexStateRoot` already does; move (or equivalently export) that resolution into `state-homes.ts` as the single source instead of duplicating it in the sandbox.
- The SC6 diagnostic must be additive: reclassifying auth errors as blocking, or writing blocklist entries for them, would change fallback policy and is out of scope.

## Checkpoints
- CP 1: **Red reproduction test (bug-first, no fix code).** Author `test/task-2443-repro.test.ts`. For each of `claude`, `codex`, `opencode`, `pi`: build the non-review profile through the exported seam (`resolveSandboxProfile('active', worktree, null, family)` + `buildBubblewrapArgs(profile, cwd)`) using a real temp git worktree fixture and pinned env, and assert the argv contains a writable `--bind` for each required family path (per SC2) and still contains `--ro-bind / /`. Add the narrowness assertions (no cross-family bind; `vibe` and `qwen` gain no host-home writable bind) — these may already be green. The per-family writable-bind cases **must fail at the mission parent commit**. Record the pre-fix bwrap argv for all four families (full `--bind`/`--ro-bind` list) in CP-1.md so CP 5 can record the after side (DOD#5).
- CP 2: **Core fix.** Add the missing state paths to `src/adapters/config/state-homes.ts` (claude credentials file, claude session-env dir, codex host auth path honoring `CODEX_HOME`). Refactor the per-family state-home switch in `src/adapters/process/bubblewrap.ts` into one shared resolver used by both the `review` and non-review branches, and union the family state homes into the non-review writable set. Handle absent leaf files without widening the bind. The CP-1 repro cases turn green; no assertion is weakened.
- CP 3: **Qwen credential seed.** In `ensureQwenHome` (`src/adapters/agents/qwen.ts`), copy `oauth_creds.json` from the operator's `~/.qwen` into the worktree-local `QWEN_HOME` when present; absent source leaves the existing minimal-settings path unchanged. Unit test covers present source (copied, valid content) and absent source (byte-identical settings behavior).
- CP 4: **Operator-facing auth diagnostic.** In `src/adapters/agents/agents.ts`, when a launch error matches an authentication/expired-credential pattern, emit an operator-facing log line naming the family and stating its credentials need refreshing, before the existing reroute. Reroute and blocklist behavior unchanged. Unit test asserts the line for an auth error and its absence for a non-auth error.
- CP 5: **Final verification and evidence.** Run `./scripts/verify-local.sh all`; record the post-fix bwrap argv for a non-review launch of each of `claude`, `codex`, `opencode`, `pi` and diff it against CP-1's pre-fix capture (DOD#5); list exactly which host paths became writable per family and confirm no whole-home or cross-family bind (DOD#6); complete the final Goal Check table.

Reproduction-Test: test/task-2443-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

Mission-specific evidence instructions (add to every CP-N.md):
- Every Goal Check row must cite at least one accepted reference: the exact test file `test/task-2443-repro.test.ts` with the specific test names inside it, the recognized command (e.g., `npm test -- test/task-2443-repro.test.ts`, `./scripts/verify-local.sh all`), or an affected source path such as `src/adapters/config/state-homes.ts`. A file:line citation (e.g., `src/adapters/process/bubblewrap.ts:244`) is acceptable parenthetically but is not the primary evidence.
- **Weak-agent failure mode:** raw `stat`/`ls`/`bwrap --help` output or generic prose ("the sandbox now allows writes") is **not sufficient evidence on its own**. Any shell output pasted into a checkpoint must be paired on the same row with one of the accepted references above (test name, test file path, or repo command).
- CP-1.md and CP-5.md must each record the **complete pre-fix and post-fix bwrap argv** for a non-review launch of `claude`, `codex`, `opencode`, and `pi` (DOD#5), and CP-5.md must list exactly which host paths became writable per family and explicitly state that no whole-home or cross-family bind was introduced (DOD#6).
- The final Goal Check table must have one row per success criterion (SC1–SC8) in `MISSION.md`.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/adapters/process/bubblewrap.ts`: the base read-only mount (`--ro-bind / /`), `isBubblewrapDisabled` / `PARALLIX_NO_BUBBLEWRAP`, and the Git-metadata mounting logic are not to be removed or weakened; only the family state-home granting changes.
- No writable bind for `$HOME` or for `~/.claude`, `~/.codex`, `~/.qwen`, `~/.config`, `~/.local`, `~/.cache` as a whole, at any step, for any family.
- `src/adapters/agents/agents.ts`: agent selection, fallback, and blocklist policy are restricted to an additive log line; `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` classification outcomes must not change.
- `src/adapters/agents/vibe.ts`: no behavior change.
- Worktree-local `.workflow/` home layout for codex/qwen/vibe and codex `config.toml` symlink handling: unchanged.
- The mission branch must not be pushed to `origin` (local-only development rule; `review` remote only).

## Stop Rules
- Stop if persisting a refresh requires a bind wider than the family's own state leaf/directory (whole `$HOME`, whole `~/.claude`/`~/.codex`/`~/.qwen`): report the conflict with argv evidence; do not widen.
- Stop if the installed bwrap rejects or misbehaves on file-leaf binds and no narrow alternative exists: record the argv evidence and raise a follow-up task rather than widening the bind.
- Stop if any unit test would need real network, real Forgejo, or a real claude OAuth login: mock the boundary instead (unit tests never touch real credentials or remotes).
- Stop if the SC6 diagnostic would require changing fallback or blocklist policy: that is out of scope — file a follow-up task.
- Stop if `./scripts/verify-local.sh all` fails in a file this mission did not modify: report it; do not amend unrelated code to force the gate green.
