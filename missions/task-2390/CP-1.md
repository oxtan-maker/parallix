# CP 1 — Diagnose: config/agents.json ignored in installed parallix

## Summary

Traced the per-step eligibility read path end to end. Confirmed the exact
statement that silently ignores working-tree edits in an installed/published
build.

**Read path.** `eligibleAgentsForStep` / `selectAgent` in
`src/adapters/agents/launcher-selection.ts` (L130, L195) call
`readAgentConfig(options.configPath || CONFIG_PATH, options)`. With the default
path this is `readAgentConfig('config/agents.json', ...)`.

**The offending statement.** `parseAgentConfigFile` in
`src/adapters/agents/agent-config.ts` (L49–L57):

```ts
const content = configPath === CONFIG_PATH
  ? runtimeAssetStore.readText(CONFIG_PATH)   // <-- always the bundle
  : fs.readFileSync(configPath, 'utf8');
```

When `configPath === CONFIG_PATH` (the default), it reads via
`runtimeAssetStore.readText('config/agents.json')`. That store is a
`FilesystemAssetStore` rooted at `packageRoot(MODULE_DIR)`
(`src/adapters/assets/runtime-assets.ts` L12). `packageRoot`
(`src/adapters/filesystem/package-root.ts` L17) walks up to the nearest
`package.json` named `@magnusekdahl/parallix` and **deliberately never
consults `process.cwd()`** (see its module doc).

**Root cause.** In an installed/published build `packageRoot` resolves to the
installed package location (e.g. `node_modules/@magnusekdahl/parallix` or the
SEA bundle), which is **not** the operator's working tree. So the running
workflow always reads the *bundled* `config/agents.json`, and any edit the
operator makes to the working-tree `config/agents.json` is ignored. Eligibility
therefore looks hardcoded — exactly the production report.

**Why it is invisible in the dev checkout.** In the repo checkout
`packageRoot(MODULE_DIR)` walks up from `src/adapters/agents/` to the repo root
(where `package.json` lives) = the working tree. So `runtimeAssetStore` and the
working tree point at the same file, and edits are visible locally. The bug
only manifests when `packageRoot` ≠ working tree, i.e. a published/installed
build.

**Local override (`agents.local.json`) does not help.** `readAgentConfig`
(`agent-config.ts` L93–L97) merges `localConfig.blocklist` only — it never
merges `localConfig.steps`. So a local override cannot change per-step
eligibility, only blocklist. Confirmed: `steps` merge is out of the primary
fix path; the working-tree `agents.json` is the authoritative source per the
file's own `_comment`.

**Minimal fix plan (CP 2).** In `parseAgentConfigFile`, when
`configPath === CONFIG_PATH`, prefer the working-tree file at
`path.resolve(process.cwd(), CONFIG_PATH)` when it exists, and fall back to
`runtimeAssetStore.readText(CONFIG_PATH)` otherwise. This makes the
working-tree `config/agents.json` authoritative in installed builds while
keeping the ADR 0044 bundled copy as the fallback (no change to the
bundled-asset boundary). Existing tests pass an explicit absolute `configPath`
(otherwise branch), so they are unaffected.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Config-read path traced end to end | `src/adapters/agents/launcher-selection.ts` L130/L195 → `agent-config.ts` `readAgentConfig`/`parseAgentConfigFile` | PASS |
| Offending statement pinned | `src/adapters/agents/agent-config.ts` L52 (`runtimeAssetStore.readText(CONFIG_PATH)`) | PASS |
| Bundle/`packageRoot` boundary understood | `src/adapters/assets/runtime-assets.ts` L12; `src/adapters/filesystem/package-root.ts` (never consults cwd) | PASS |
| ADR 0044 constraint captured | `docs/adr/0044-workflow-distribution-model.md` (bundled assets from package root) | PASS |
| `agents.local.json` merge scope confirmed | `src/adapters/agents/agent-config.ts` L93–L97 (blocklist only, no `steps`) | PASS |
| Existing test surfaces the contract | `test/agents.test.ts` `eligibleAgentsForStep returns config list for a known step`; `test/runtime-matrix.test.ts` `buildAutonomousReviewMatrix derives agents from injected step eligibility` | PASS |

## Next action
Implement the working-tree-preferred read in `parseAgentConfigFile` (CP 2) and add a regression test that writes a distinct eligible list into a working-tree `config/agents.json` and asserts `eligibleAgentsForStep`/`selectAgent` honor it.
