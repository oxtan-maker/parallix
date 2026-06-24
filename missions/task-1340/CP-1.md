# CP-1: package.json audit complete

## Work Done

Audited all publication-relevant fields in `package.json` against npm best practices and mission success criteria.

### Fields verified (present and non-empty):

| Field | Value | Line | Status |
|-------|-------|------|--------|
| `name` | `@magnusekdahl/parallix` | package.json:2 | ✓ |
| `version` | `1.0.0` | package.json:3 | ✓ |
| `description` | AI mission workflow toolkit... | package.json:4 | ✓ |
| `license` | `AGPL-3.0-or-later` | package.json:5 | ✓ |
| `engines.node` | `>=20` | package.json:8 | ✓ |
| `private` | `false` | package.json:6 | ✓ |
| `bin` | `{ "px": "px.js" }` | package.json:9 | ✓ |
| `files` | 13-entry allowlist | package.json:34-48 | ✓ |

### Fields added (were missing):

| Field | Value | Rationale |
|-------|-------|-----------|
| `main` | `index.js` | Standard entry point for Node packages; supports `require('@magnusekdahl/parallix')` |
| `repository` | `git+https://github.com/magnusekdahl/parallix.git` | npm registry convention; links to source |
| `keywords` | 7-item array | npm search discoverability |
| `bugs` | `https://github.com/magnusekdahl/parallix/issues` | Standard npm metadata |
| `homepage` | `https://github.com/magnusekdahl/parallix#readme` | Standard npm metadata |

### Field changed:

| Field | Old | New | Rationale |
|-------|-----|-----|-----------|
| `publishConfig.access` | `restricted` | `public` | AGPL tool should have publicly visible registry metadata; `restricted` hides package info from unauthenticated users |

### `files` array review:

The 13 entries cover all runtime-required paths:
- `index.js` — main entry point (imported by px.js)
- `px.js` — CLI entry point (bin target)
- `LICENSE`, `README.md`, `CHANGELOG.md` — package metadata
- `config/` — tool defaults (state-map.json, agents.json)
- `data/` — tool-owned data (stats.csv)
- `docs/` — ADRs, documentation (excluded from test/.npmignore by `.npmignore:test/`)
- `examples/` — example workflows
- `lib/` — all command handlers, agent adapters, core modules (44+ modules)
- `prompts/` — agent instruction templates
- `templates/` — mission/task template files
- `tools/setup-forgejo-docker.sh` — setup utility

No tool-owned directory needed for runtime is excluded.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `name` non-empty | package.json:2 → `@magnusekdahl/parallix` |
| `version` non-empty | package.json:3 → `1.0.0` |
| `description` non-empty | package.json:4 → 80 chars |
| `license` non-empty | package.json:5 → `AGPL-3.0-or-later` |
| `engines` non-empty | package.json:8 → `{ "node": ">=20" }` |
| `files` excludes no runtime dirs | package.json:34-48 — all lib/, config/, prompts/, templates/, data/ included |
| `main` present | package.json:7 → `index.js` |
| `repository` present | package.json:12-14 |
| `keywords` present | package.json:15-22 |
| `bugs` present | package.json:23-24 |
| `homepage` present | package.json:25 |
| `publishConfig.access` public | package.json:10-12 → `public` |

## Next action

Proceed to CP-2: tighten `.npmignore` and verify `files` allowlist against exclusion patterns.
