# CP-3 — Pack, temporary-prefix install, and CLI smoke tests

## Summary

Authored `test/task-2285-pack-install-smoke.test.ts`: it runs the real `npm pack` (so
`prepack` builds the bundle), installs the tarball into **two** disposable prefixes — the
global layout (`<prefix>/bin/px`) and the local layout (`<prefix>/node_modules/.bin/px`) —
and drives the published CLI. Every invocation uses a closed stdin and piped stdout, so all
of it is non-TTY. The suite runs with a disposable `PARALLIX_HOME` and target directory and
removes both prefixes afterwards.

The eleven assertions cover: tarball contents, absence of any `node_modules` in the install
(SC4), `--version` (with the payload root reported as `…/build`), `--help`, a headless JSON
command, embedded asset loading, explicit TUI non-TTY fallback, `node:sqlite` startup, the
local install layout, byte-identity between the installed bin and the built bundle (SC7),
and the bare-`px` behaviour recorded below.

**Two defects surfaced and were fixed.**

1. **Pack/build race (real bug, not test flake).** `npm pack` collects files *after*
   `prepack` returns, so a concurrent build that deleted `build/` in place could make a pack
   observe an empty payload and produce a tarball with no `build/px.mjs`; a concurrent
   `dist/` removal also produced `ENOTEMPTY`. The build now takes a per-checkout mkdir lock
   outside the repository and writes into private staging directories that are **swapped in
   with `rename`** at the end, after the size gate. A reader therefore sees either the
   previous complete tree or the new one, and a failed build leaves the published trees
   untouched. Verified with three concurrent `npm run build` invocations: all exit 0, no
   `ENOTEMPTY`.

2. **Two existing packaging tests asserted the retired `dist/` layout.**
   `test/task-1424-post-integrate-publish-reinstall.test.ts` and
   `test/package-persistent-data.test.ts` checked for `dist/px.js` in the install and
   `require`d modules out of the installed package. Both were retargeted to `build/px.mjs`;
   their behavioural intent (post-integrate reinstall works outside the checkout; operator
   state lives in `PARALLIX_HOME` and survives reinstall; no state is written into the
   package or target repos) is preserved, with the fixture now seeding state through the
   checkout's rollback build because the published package deliberately exposes no
   importable modules.

**SC3 divergence — bare `px` on a non-TTY.** ADR 0044 states that without a command or an
interactive TTY, `px` prints normal help. The shipped runtime instead prints `[FAIL] Missing
command` and exits 1 (`src/platform/runtime/px.ts:71`, reached from
`src/platform/runtime/px.ts:194-198`). Fixing that is a change to `src/` CLI code, which
MISSION.md Restricted Areas forbids ("Do not modify `src/` source files … this mission is
packaging-only"). The smoke test therefore pins the behaviour the package actually has and
still asserts the packaging-relevant guarantee — no UI initialisation on a non-TTY. AC #3's
wording ("explicit TUI non-TTY fallback") *is* satisfied: `px ui` exits 0 on a non-TTY.

**SQLite startup** is proven structurally and functionally: esbuild preserves
`import { DatabaseSync } from "node:sqlite";` as a hoisted top-level builtin import in
`build/px.mjs`, so it is evaluated on every invocation — a successful `px --version` from the
installed prefix is proof that `node:sqlite` loaded. No CLI surface currently opens the
database file (`status`'s SQLite path is behind `buildProjectionBuilder`, which no command
reaches yet), so the test does not claim a database was created.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: temporary-prefix install of the packed tarball succeeds | `test/task-2285-pack-install-smoke.test.ts` `before()` hook: `npm pack --pack-destination`, then `npm install --global --prefix` and `npm install --prefix`; 11/11 tests pass | PASS |
| SC3: `px --version` exits 0 | test `"task-2285 install: SC3 — px --version reports the bundle as the payload root"` | PASS |
| SC3: `px --help` exits 0 | test `"task-2285 install: SC3 — px --help prints the command surface"` | PASS |
| SC3: representative headless JSON command exits 0 and emits parseable JSON | test `"task-2285 install: SC3 — representative headless JSON command emits parseable JSON"` (`px config`, asserts `JSON.parse` and no cursor-control escapes) | PASS |
| SC3: embedded asset smoke | test `"task-2285 install: SC3 — embedded assets load from the bundle payload root"` (`px aliases` reads `config/state-map.json` via the AssetStore; every `asset-manifest.json` key exists under the installed `build/`) | PASS |
| SC3: SQLite startup | test `"task-2285 install: SC3 — node:sqlite resolves at startup from the installed bundle"` | PASS |
| SC3: explicit TUI non-TTY fallback (AC #3) | test `"task-2285 install: SC3 — explicit TUI falls back cleanly on a non-TTY stdin/stdout"` (`px ui` exits 0) | PASS |
| SC3: bare `px` on a non-TTY prints help and exits 0 | `src/platform/runtime/px.ts:71` returns 1 with `Missing command`; behaviour pinned by test `"task-2285 install: bare `px` on a non-TTY does not start the TUI (SC3 divergence recorded)"`. Fix requires editing `src/`, forbidden by MISSION.md Restricted Areas. | BLOCKED — see note above |
| SC4: no `node_modules` in the installed package | test `"task-2285 install: SC4 — no node_modules anywhere in the installed package"` (recursive walk finds none; the optional peer SDK is absent) | PASS |
| SC7: installed bin is the bundler's entry point | test `"task-2285 install: SC7 — the installed bin is byte-identical to the built bundle"`; `scripts/build-canonical-bundle.js:21` (`output`) vs `package.json:9` | PASS |
| Pack/build race fixed | `scripts/build-canonical-bundle.js:14-21` (staging dirs), `scripts/build-canonical-bundle.js:23-55` (build lock), `scripts/build-canonical-bundle.js:72-79` (`publishTree` rename swap); three concurrent `` `npm run build` `` runs all exit 0 | PASS |
| Existing packaging tests retargeted, intent preserved | `test/task-1424-post-integrate-publish-reinstall.test.ts:86-96`, `test/package-persistent-data.test.ts:81-86`; tests `"installed bundle-layout tarball runs read-only commands outside the checkout"` and `"global tarball reinstall preserves PARALLIX_HOME stats and agent blocklist"` | PASS |
| Full integration suite green | `` `npm run test:integration` `` → 1311 pass / 0 fail / 0 cancelled | PASS |
| Gate body of `./scripts/verify-local.sh all` | `` `npm test` `` — the command `gate_all()` runs (`scripts/verify-local.sh:85-87`): 1324 pass / 0 fail. Full `./scripts/verify-local.sh all` is re-run at the final checkpoint. | PASS |

Next action: CP-4 — write `docs/npm-package-major-migration.md` covering the Node floor change (23.0.0 → 22.23.1), the ESM switch, removal of `main`/`exports`, `px` TTY vs non-TTY invocation (including the recorded bare-`px` divergence), the SQLite import boundary, and the optional `@earendil-works/pi-coding-agent` peer; then document and execute the rollback to the CommonJS `dist/px.js` artifact and verify it produces a working CLI.
