# Checkpoint 2 — Review-profile path resolution and Bubblewrap bindings

## Work done

Made `resolveSandboxProfile` grant each supported reviewer launcher its own
state home as a writable bind while keeping the mission worktree read-only.

- `src/adapters/config/state-homes.ts` (new) owns the launcher state-home paths.
  The launchers (`src/adapters/agents/codex.ts`, `qwen.ts`, `vibe.ts`) and the
  sandbox profile both resolve through it, so the guard's writable set cannot
  drift away from where a launcher actually writes. It lives under `config/`
  because `boundary-guards.ts`' `adapterPackageDependencies` lets
  `process` import `config` but not `agents`.
- `src/adapters/process/bubblewrap.ts`: `resolveSandboxProfile` accepts `family`
  and, for the `review` step, appends that family's resolved state homes to
  `writable` alongside the artifact directory. `resolveReviewLauncherStateHomes`
  maps:
  - `codex` → `<worktree>/.workflow/codex-home`
  - `qwen` → `<worktree>/.workflow/qwen-home`
  - `vibe` → `<worktree>/.workflow/vibe-home`
  - `claude` → `<HOME>/.claude/projects/<mangled-worktree-path>`, the name Claude
    itself derives from the working directory (`/home/u/code/p` →
    `-home-u-code-p`) — not the mission slug, which names no real directory
  - `custom` → the state homes of its configured runner, resolved through
    `resolveCustomRunner`: opencode (`XDG_DATA_HOME`, `XDG_CONFIG_HOME`,
    `XDG_CACHE_HOME` `/opencode`) or pi (`~/.pi`). Both runners are host-home
    based: neither `src/adapters/agents/opencode.ts` nor `pi.ts` overrides `HOME`
    or a state-dir variable.
- `src/adapters/agents/agents.ts` passes `chosen` (family) into
  `resolveSandboxProfile`. The `slug` argument is gone: no launcher names its
  state home after the mission slug.

The read-only worktree boundary is unchanged: `worktreeWritable` stays `false`
and the worktree is still `--ro-bind`, with the nested `.workflow/*-home`
rebinds applied after it.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Review profile resolves a writable bind for each launcher state home | `test/bubblewrap-guard.test.ts` → `review profile grants each worktree-local launcher state home as a writable bind`, `review profile grants claude the transcript directory named after the mangled worktree path`, `review profile grants the custom family its configured runner state homes` | PASS |
| Reviewed worktree stays read-only; reviewed source not bound writable | `test/bubblewrap-guard.test.ts` → `review profile keeps the reviewed worktree read-only and binds no reviewed source` | PASS |
| No EROFS before prompt: profile resolves homes and args bind them writable | `test/bubblewrap-guard.test.ts` → `review profile buildBubblewrapArgs binds the claude transcript directory writable without widening the worktree`; `npm test -- test/bubblewrap-guard.test.ts` (17 pass / 0 fail) | PASS |
| Sandbox policy cannot drift from the launchers' own paths | `src/adapters/config/state-homes.ts` is the single definition imported by both `src/adapters/process/bubblewrap.ts` and the codex/qwen/vibe launchers; `npm test -- test/dependency-graph.test.ts` passes | PASS |

## Next action

Run CP 3: exercise the affected launcher and guard unit suites, run
`./scripts/verify-local.sh static-analysis` and the full `all` gate, and write
the final checkpoint with the complete Goal Check evidence.
