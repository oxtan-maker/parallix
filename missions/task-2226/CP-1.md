# CP-1 — Package and prerequisite inventory

## Summary

Inventoried the current package boundary and ran `npm pack --dry-run --json`.
The current artifact is the sibling-`.js` layout: `package.json` points `main`
and `bin` at the repository root, includes `lib/`, and excludes only
`lib/**/*.ts`. The dry run consequently contains root `index.js`/`px.js` and
`lib/**/*.js`, rather than the required `dist/` output and maps.

ADR 0044 §8 defines the T3 target: include `dist/**/*.js`,
`dist/**/*.js.map`, `prompts/`, `templates/`, `config/`, `data/`, `docs/`,
`examples/`, and `tools/setup-forgejo-docker.sh`, plus package metadata,
README, LICENSE, and CHANGELOG; exclude declarations, TypeScript sources,
`test/`, development configuration, and operator/repository state
(`.forgejo-local/`, sessions, `agents.local.json`, `graphify-out/`,
`missions/`, and `backlog/`). The representative read-only smoke commands are
`px status` and `px stats` against a temporary target repository.

The prerequisite asset-resolution hardening is not present: no `packageRoot()`
implementation exists, and active runtime modules still calculate assets with
fixed `__dirname` depths. Changing only the package layout would make a
`dist/lib/...` runtime seek package-root assets under `dist/`. This is T2 work
explicitly required before T3, so implementation is paused pending integration
of TASK-2225 (or an explicit scope decision that authorizes its prerequisite
changes here).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Package target and encapsulation are inventoried | `package.json:7`, `package.json:9`, `package.json:34`; ADR 0044 | BLOCKED — target is specified but T2 is absent |
| Build and source-map target are inventoried | `tsconfig.json:6`, `tsconfig.json:11`; ADR 0044 | BLOCKED — source-map setting remains to be applied after prerequisite |
| Publication include/exclude contract is concrete | ADR 0044; `npm pack --dry-run --json` | PASS |
| Tarball read-only smoke commands are identified | ADR 0044; `test/task-1424-post-integrate-publish-reinstall.test.js` | PASS |
| Dist runtime can resolve package-root assets | `lib/commands/draft.ts:17`, `lib/agents/agent-config.ts:17`, `lib/core/state-map.ts:6` | BLOCKED — no `packageRoot()` helper is present |
| Named package-test successors are inventoried | `test/task-1424-post-integrate-publish-reinstall.test.js`; `test/package-persistent-data.test.js` | PASS |
| T4/T5 compatibility boundary is preserved | `package.json:52`; ADR 0044 | PASS — no runtime-layout or freshness changes made |

Next action: integrate TASK-2225's package-root asset-resolution hardening, then resume CP-2 with the dist metadata and tarball-content assertions.
