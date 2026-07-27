# npm package: next-major compatibility and migration notes

Status: applies to the next major release of `@magnusekdahl/parallix`
Related: ADR 0044 (runtime, persistence, UI, and distribution architecture),
ADR 0046 (npm publish process and security), TASK-2285, TASK-2286 (native SEA)

The npm package now executes the canonical ESM bundle. The published tarball is
`build/` plus `package.json`, `LICENSE`, `README.md`, `CHANGELOG.md` and `NOTICES`
— 18 files. It contains no source tree, no tests, no CommonJS `dist/` output, and
no dependency closure.

Verify the shape at any time with `npm run test:package-content`.

## What changed

| | Before | After |
|---|---|---|
| `type` | `commonjs` | `module` |
| `bin.px` | `dist/px.js` | `build/px.mjs` |
| `main` | `dist/index.js` | removed |
| `exports` | `{".": "./dist/index.js", …}` | removed |
| `engines.node` | `>=23.0.0` | `>=22.23.1` |
| `dependencies` | ink, react, @types/react, pi SDK | removed |
| Published files | `dist/` + `config/`, `data/`, `docs/`, `examples/`, `prompts/`, `templates/`, `tools/` | `build/` + LICENSE, README, CHANGELOG, NOTICES |
| Runtime `node_modules` | required | none |

## Node floor: 23.0.0 → 22.23.1

The floor moved **down**, so every runtime that could run the previous release can
run this one. 22.23.1 is the minimum that satisfies the bundle's `node22.23`
esbuild target and provides `node:sqlite` as a built-in (added in Node 22.10.0).

Native single-executable builds (TASK-2286) are a separate matter: ESM SEA
(`mainFormat: "module"`) needs Node 25/26. That constraint applies to the
executable's embedded runtime, not to the npm package.

## ESM

The package is `"type": "module"` and the bin is `build/px.mjs`. The bundle is a
single self-contained ESM file: first-party code and every third-party package it
reaches are statically inlined, and only Node built-ins are imported at runtime.

Consequences for operators:

- Nothing to install alongside it. `npm install -g @magnusekdahl/parallix` writes
  the package and no dependency tree.
- The bundle is executed directly by Node's ESM loader. No transpiler, loader
  hook, or `--experimental-*` flag is involved.

## Removal of the root programmatic export

`main` and `exports` are gone. `require('@magnusekdahl/parallix')` and
`import parallix from '@magnusekdahl/parallix'` no longer resolve.

Parallix is a CLI application, not a supported JavaScript SDK (ADR 0044:
"Parallix is a CLI application, not a supported JavaScript SDK. The long-term
package has `"type": "module"`, a `bin` entry for `px`, no root programmatic
export, no `main`, and no published declarations."). No declarations (`.d.ts`) are
published either.

**If you imported Parallix programmatically**, invoke the `px` binary as a
subprocess instead. Headless commands have deterministic exit codes. If you need a
supported programmatic surface, that is a stop-and-reassess condition for ADR 0044
and needs a new ADR, not a package flag.

## Runtime assets and the payload root

`packageRoot()` resolves package-owned assets by walking up from a module's own
directory to the nearest `package.json` named `@magnusekdahl/parallix`. The build
writes that marker into `build/package.json` and stages the declared runtime
assets — `config/agents.json`, `config/state-map.json`, `prompts/*.md`,
`templates/mission-scaffold.md` — under `build/`.

`build/` is therefore the payload root: assets resolve identically from the
checkout, from an npm install, and from the SEA payload directory (TASK-2286).
`px --version` reports `package: …/build`, which is the payload root and not the
package directory. `build/asset-manifest.json` lists every runtime asset with its
SHA-256 digest.

## UI invocation: `px` on a TTY vs a non-TTY

- `px ui` renders the Ink TUI explicitly. On a non-TTY it falls back and exits 0.
- `px <command>` is headless: it never initialises React, Ink, cursor control, or
  interactive input.
- `px` with no command prints normal usage help and exits 0 (ADR 0044).
  This runs before the target-path check so it works even outside a repository.

## SQLite import boundary

`node:sqlite` is a Node built-in and is confined to `src/adapters/sqlite/`
(ADR 0044). esbuild preserves it as a builtin specifier, so `build/px.mjs`
contains a top-level `import { DatabaseSync } from "node:sqlite";` that is
evaluated on every invocation — a successful `px --version` proves it loaded.
Nothing is compiled, downloaded, or linked at install time.

The database lives at `<PARALLIX_HOME>/parallix.db` and is never created inside a
target repository, mission worktree, executable directory, or the package
directory.

## Optional agent SDK: `@earendil-works/pi-coding-agent`

The pi coding-agent SDK used to be a hard `dependency`. It is loaded through an
opaque dynamic import (`src/platform/runtime/lib/agents/pi.ts`), so esbuild cannot
inline it and it is **not** part of the bundle; shipping it as a dependency only
pulled ~140 transitive packages — and their published advisories — into every
install without putting a single byte into the payload.

It is now an **optional peer dependency**. This matches how every other agent
family already works: Parallix resolves an external agent runtime rather than
vendoring it.

**If you use the `pi` implementer family**, install the SDK yourself:

```sh
npm install -g @earendil-works/pi-coding-agent
```

Every other command, including the whole headless surface and the TUI, works
without it.

## Release metadata

`npm run build` (and therefore `prepack`) regenerates, from the esbuild metafile —
the authoritative record of what is inlined into the bundle:

- `NOTICES` — third-party notices for every bundled package, license texts
  deduplicated by content;
- `build/sbom.json` — CycloneDX 1.5 SBOM, deterministic (no timestamp, no serial
  number, sorted components);
- `build/manifest.sha256` — SHA-256 of every other file under `build/`.

The same step runs a license audit and fails the build on any dependency license
outside the approved set (`scripts/release-metadata.js`).

`prepublishOnly` runs `npm run test:package-content` (content + checksum audit)
and `npm audit --omit=dev` before any publish.

## Rollback

`scripts/build-canonical-bundle.js` keeps emitting the CommonJS `dist/` tree
alongside the bundle, so rolling back is a **package-metadata change only**. No
source change is involved: `src/` remains the sole source authority in both
shapes, and the `dist/` tree is a build product of exactly the same sources.

```sh
node scripts/rollback-commonjs-package.js --apply   # rewrite package.json
npm install                                          # restore the runtime closure
npm run build                                        # re-emit dist/
npm pack
```

Run without `--apply` to print the resulting manifest and review it first.

The rollback restores:

- `"type": "commonjs"`, `main: "dist/index.js"`, `bin.px: "dist/px.js"`, and the
  `exports` map — so `require('@magnusekdahl/parallix')` resolves again;
- `dependencies` on ink, react, @types/react and the pi SDK. The transpiled
  CommonJS tree is *not* bundled, so it resolves these from `node_modules`;
- the package-root asset directories (`config/`, `prompts/`, `templates/`,
  `data/`, `docs/`, `examples/`, `tools/setup-forgejo-docker.sh`) in `files`,
  because `packageRoot()` then resolves to the package directory rather than to
  `build/`.

`engines.node` stays at `>=22.23.1`: the CommonJS tree is emitted with the same
`node22.23` target and does not need Node 23.

The rollback artifact is exercised end to end by `test/task-2285-rollback.test.ts`,
which assembles the rolled-back package in a temporary directory, checks its
`npm pack` contents, and runs `dist/px.js` for `--version`, `--help`, a headless
JSON command, package-root asset loading, and the programmatic `main` entry.
