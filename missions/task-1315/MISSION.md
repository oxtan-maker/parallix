# Mission: Install the Graphify Skill into Every Agent CLI (task-1315)

## Goal
Every Graphify-supported agent family parallix launches (`codex`, `claude`, `qwen`/opencode) has the Graphify knowledge-graph skill available in its config dir, so the agent consults the graph (god nodes, communities, `graphify query`) instead of grepping raw files. The skill is installed **once** per platform via `graphify install --platform <P>` against the operator's real config dirs; Codex's isolated worktree-local HOME — which is rebuilt fresh per mission — receives the skill by copying the already-installed global skill in `ensureCodexHome`, the same way `auth.json` is seeded.

## Why Now
The graph generation/update pipeline already works: draft creates and ignores `graphify-out/`, and review/integration run `graphify update .` in parallix's own process. The genuine remaining gap is that no agent had the Graphify skill available, so none of them used the graph that parallix builds. Closing this delivers the payoff of the indexing pipeline.

## Correction to Prior Framing
Two earlier framings were wrong and are corrected here:
1. Agent launchers do **not** need to "resolve" or "receive" the Graphify CLI in their environment. Parallix invokes `graphify update .` in its own process (`review-loop.js`, `integrate.js`); agents never run Graphify. The work is making the per-agent **skill** available, not propagating the CLI.
2. The skill install is a **one-time operator setup**, not launcher code that re-runs `graphify install` on every mission. An earlier implementation wired `graphify install` into `ensureCodexHome` so it fired on every codex launch; that recurring-subprocess approach was removed. The only per-mission action is a cheap filesystem copy of the already-installed skill into Codex's ephemeral HOME (mirroring the existing `auth.json` copy), because that HOME is created from scratch each mission and cannot otherwise see the global install.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Main drivers: make the existing graph usable by agents; cover Codex's isolated worktree HOME without a per-launch install subprocess. Mistral is excluded because Graphify has no mistral/vibe platform.

## Scope
- One-time global install, run once by the operator with the `graphify` CLI (resolution order `GRAPHIFY_BIN` → `graphify` on PATH → `~/.local/bin/graphify`):
  - `claude` → `graphify install --platform claude` → `~/.claude/skills/graphify/` + `CLAUDE.md` directive (honors `CLAUDE_CONFIG_DIR`).
  - `codex` → `graphify install --platform codex` → `~/.agents/skills/graphify/`.
  - `qwen` → `graphify install --platform opencode` → `~/.config/opencode/skills/graphify/`.
  - `mistral` is excluded (Graphify ships no mistral/vibe platform) — see Out of Scope.
  - Do NOT use `--project` scope; it writes the skill (and an `.opencode/` plugin hook) into the tracked worktree.
- Codex isolated-HOME seeding: `ensureCodexHome` (`codex.js`) copies the global `~/.agents/skills/graphify/` into `<worktree>/.workflow/codex-home/.agents/skills/graphify/` via `fs.cpSync`, immediately after the `auth.json` copy. This is a plain filesystem copy of an existing install — **not** a `graphify install` invocation — is idempotent, and skips cleanly (`fs.existsSync`) when no global skill is present.
- Retain unchanged: `graphify-out/` creation/ignore in draft; `graphify update .` before review (cwd = mission worktree) and after integration (cwd = primary target repo); `.gitignore`/`.graphifyignore` and npm-package exclusions; CLI resolution order; non-blocking probe/update behavior.
- Add focused tests for the Codex copy-seed (skill lands in the worktree-local HOME; idempotent re-run; clean skip when no global skill).
- Document the one-time per-platform install commands and targets, the Codex copy-seed, the mistral limitation, and the `graphify` CLI bootstrap.

## Out of Scope
- Re-implementing or changing graph extraction, indexing, `graphify update`, visualization, or report formats.
- Any launcher code that runs `graphify install` on a per-mission/per-launch basis (explicitly removed).
- Committing `graphify-out/`, `graph.json`, `GRAPH_REPORT.md`, generated HTML, or `--project`-scoped `.opencode/` artifacts to the source tree or npm package.
- Installing the Graphify skill for `mistral`/vibe: Graphify ships no mistral/vibe platform.
- Changing agent eligibility, selection weights, or launcher command shapes in `config/agents.json`.
- Making Graphify install or update a blocking lifecycle gate.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. Running `graphify install --platform {claude,codex,opencode}` once produces `~/.claude/skills/graphify/SKILL.md`, `~/.agents/skills/graphify/SKILL.md`, and `~/.config/opencode/skills/graphify/SKILL.md` respectively (verified live; see CP-2).
2. A test proves `ensureCodexHome` copies the global `~/.agents/skills/graphify/` into Codex's worktree-local HOME (`<worktree>/.workflow/codex-home/.agents/skills/graphify/SKILL.md`), not the operator's real home.
3. A test proves the copy-seed is idempotent (a second `ensureCodexHome` leaves the same target) and that it skips cleanly — writing config but no skill — when no global skill is installed.
4. No launcher code invokes `graphify install`; the only per-mission action for the skill is a filesystem copy (`fs.cpSync`) in `ensureCodexHome`.
5. The bootstrap does not attempt a `mistral`/vibe install and does not error on the mistral family.
6. The retained pipeline is unchanged and still covered: `graphify update .` runs before review (cwd = mission worktree) and after integration (cwd = primary target repo); `graphify-out/` is matched by `.gitignore` and `.graphifyignore`; `npm pack --dry-run --json` reports no file beneath `graphify-out/`; no `.opencode/` artifact is committed.
7. Operator documentation lists each platform's one-time install command and target dir, the Codex copy-seed, the mistral limitation, and the `graphify` CLI bootstrap.
8. `npm test` completes with zero failures.

## Risks and Assumptions
- Assumption: `graphify install --platform <P>` is the stable install contract; targets match the inspected platform config (claude → `.claude/skills`, codex → `.agents/skills`, opencode → `.config/opencode/skills`).
- Assumption: claude/opencode launchers inherit `process.env`, so a one-time global skill install reaches them; only codex needs the per-worktree copy-seed because it runs with `HOME=codexHomeRoot`.
- Assumption: `os.homedir()` honors `$HOME` on POSIX, so the copy-seed source resolves to the operator's real home at launch time.
- Note: Graphify exposes no mistral/vibe platform; mistral is excluded this mission.
- Risk: `graphify install --platform opencode` writes a project-local `.opencode/` hook into the current directory in addition to the global skill; that artifact must not be committed into parallix.

## Checkpoints
- CP 1: Audit and contract — confirm each family's launcher, config dir, and Graphify platform; record that graph generation already works and what is retained unchanged.
- CP 2: One-time install + codex copy-seed — run the one-time global `graphify install` per platform; implement the idempotent `fs.cpSync` skill copy-seed in `ensureCodexHome` (not a per-launch `graphify install`); add the copy-seed tests; remove any `--project` artifacts; document and run full `npm test`.

## Gates
- [ ] Codex copy-seed test (skill lands in worktree-local HOME) passes.
- [ ] Idempotent re-seed test and clean-skip test pass.
- [ ] No `graphify install` invocation in `lib/agents/`.
- [ ] `npm pack --dry-run --json` contains no `graphify-out/` entries and no `.opencode/` artifact.
- [ ] `git check-ignore graphify-out/graph.json` succeeds.
- [ ] npm test

## Restricted Areas
- Do not edit backlog `assignee`; parallix owns agent assignment.
- Do not add generated files beneath `graphify-out/`, or `--project`-scoped `.opencode/` artifacts, to Git, package `files`, fixtures, or mission artifacts.
- Do not alter `config/agents.json` eligibility or launcher identities.
- Do not change Forgejo review policy, branch lifecycle, stats storage, or task-state transitions.
- Do not modify the graph-generation/update code paths except where the skill seeding genuinely requires it.

## Stop Rules
- Stop before reintroducing a per-launch/per-mission `graphify install` subprocess; the skill install is a one-time operator step and the codex HOME is seeded by a filesystem copy.
- Stop before making Graphify install or update a blocking lifecycle gate.
- Stop if serving any agent requires shipping `graphify-out/` or Graphify source in the npm package; preserve the package boundary.
- Stop before curling or executing an unpinned remote installer for the `graphify` CLI; use the pinned pip package.
