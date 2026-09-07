# CP 1 — Audit: config-load and agent-selection flow

## Work done

Audited the config-load + agent-selection flow to pin the first-run hook
location, the availability seam, the config path, and the family list.

**Config resolution.** `readAgentConfig(CONFIG_PATH)` in
`src/adapters/agents/agent-config.ts` resolves `config/agents.json`. When the
working-tree copy is absent it falls back to the bundled default via
`runtimeAssetStore.readText(CONFIG_PATH)` (the `parseAgentConfigFile`
`configPath === CONFIG_PATH` branch). The working-tree copy is authoritative;
the bundled copy under the package root (`build/config/agents.json`, ADR 0044)
is the fallback. This is the exact "working-tree vs bundled" distinction the
mission needs: a fresh checkout with no `config/agents.json` reads the full
bundled list.

**Availability seam (already exists, no new spawn in tests).**
`workflowLauncherStatus(agent, worktree)` in
`src/adapters/agents/launcher-selection.ts` is the single availability probe.
It shells out (`command -v` + `--help` health probe) but exposes two injection
seams used by existing tests:
- `setCommandPathProbe(fn)` — replaces `commandInPath`
- `setLauncherHealthProbe(fn)` — replaces the `--help` probe

Both default to `null` → real spawn. Tests set them to a fake and clear them
after (see `test/agents-limit-hit.test.ts`, `test/task-2335-reviewer-family-repro.test.ts`).
No new seam to invent; the Stop rule "cannot inject without spawning real CLIs
in tests" is already satisfied.

**Family list.** `WORKFLOW_AGENT_NAMES = ['codex','claude','vibe','custom','qwen']`
(frozen in `launcher-selection.ts`). `custom` resolves to its runner via
`resolveCustomRunner(worktree)` (ADR 0050, defaults to `opencode`); availability
for `custom` is judged against that runner inside `workflowLauncherStatus`.

**Config path.** `<rootDir>/config/agents.json` where `rootDir` is the target
working tree (`process.cwd()` for the CLI; injectable for tests). Writing here
matches `parseAgentConfigFile`'s working-tree read path, so a subsequent
`readAgentConfig` picks up the written file as authoritative.

**First-run hook location (chosen).** Workflow commands enter through
`src/composition/create-cli.ts` (`draft` / `active` / `review`), each of which
opens `createProductionApplicationServices(rootDir)`. The once-at-first-write
guard runs there, gated strictly on "no working-tree `config/agents.json`
exists" (idempotent). Detection never runs per-selection or per-render: it is
a single early call guarded by the filesystem check; `selectAgent` keeps using
`workflowLauncherStatus` unchanged.

**Filtered config shape.** Read the shipped default (full list) via
`readAgentConfig(CONFIG_PATH, { mergeLocal: false })`, replace each
`steps.{draft,active,review}.eligible` with only the families whose
`workflowLauncherStatus.supported === true`, and preserve `_comment`,
`_weights_comment`, `selection`/`weights`, and `overrides`. Output validates
against `config/workflow.config.schema.json` (no `_comment`/`_weights_comment`
breaks `readAgentConfig`; those keys are opaque to `eligibleAgentsForStep`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| First-run hook location pinned | `src/composition/create-cli.ts` opens services per `rootDir` | PASS |
| Availability seam injectable without real CLI | `setLauncherHealthProbe` / `setCommandPathProbe` in `src/adapters/agents/launcher-selection.ts`, used by `test/agents-limit-hit.test.ts` | PASS |
| Config path and working-tree/bundled distinction | `src/adapters/agents/agent-config.ts` `parseAgentConfigFile`, ADR `docs/adr/0044-workflow-distribution-model.md` | PASS |
| Family list + custom runner resolution | `WORKFLOW_AGENT_NAMES` + `resolveCustomRunner`, ADR `docs/adr/0050-custom-agent-runner-configurability.md` | PASS |

## Next action
Author the failing reproduction test `test/first-run-config-autodetect.test.ts` (CP 2).
