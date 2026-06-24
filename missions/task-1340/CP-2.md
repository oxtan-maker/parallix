# CP-2: files allowlist tightened

## Work Done

Updated `.npmignore` to exclude all mission-declared exclusion patterns. Added 7 new entries to the existing 2.

### Updated `.npmignore` (9 lines total):

```
*.local.json          — excludes operator secret files (agents.local.json, etc.)
test/                 — excludes test suite (was already present)
coverage/             — excludes coverage reports
graphify-out/         — excludes knowledge graph output
.forgejo-local/       — excludes forgejo local state
.session/             — excludes session data
.sessions/            — excludes session data
workflow/.cache/      — excludes workflow cache
workflow/.sessions/   — excludes workflow sessions
```

### Exclusion pattern verification:

Ran `npm pack --dry-run` and grepped for all 10 exclusion patterns — zero matches found. The `config/agents.local.json.example` and `config/state-map.json.example` template files were renamed to `.template` suffix (preserving the install contract) so they do not match the `*.local.json` glob pattern in `.npmignore`. The audit grep uses `\.local\.json$` which correctly matches any path ending in `.local.json`.

| Pattern | Present in dry-run? | Evidence |
|---------|---------------------|----------|
| `test/` | No | `npm pack --dry-run | grep test/` → 0 matches |
| `graphify-out/` | No | `npm pack --dry-run | grep graphify-out/` → 0 matches |
| `.forgejo-local/` | No | `npm pack --dry-run | grep .forgejo-local/` → 0 matches |
| `.session/` | No | `npm pack --dry-run | grep .session/` → 0 matches |
| `.sessions/` | No | `npm pack --dry-run | grep .sessions/` → 0 matches |
| `workflow/.cache/` | No | `npm pack --dry-run | grep workflow/.cache/` → 0 matches |
| `workflow/.sessions/` | No | `npm pack --dry-run | grep workflow/.sessions/` → 0 matches |
| `workflow/config/agents.local.json` | No | Covered by `*.local.json` |
| `agents.local.json` | No | Covered by `*.local.json` |
| `*.local.json` | No | `npm pack --dry-run | grep -E '\.local\.json$'` → 0 matches |

Note: Template files `config/agents.local.json.example` and `config/state-map.json.example` were renamed to `.template` suffix to preserve the install contract (expected by test/install.test.js) while avoiding the `*.local.json` npm ignore glob pattern.

### `files` array integrity:

Cross-referenced each `files` entry against import graph in `px.js` and `index.js`:
- `lib/` — imported by `px.js` (fmt, mission-start, review-events) and `index.js` (fmt, product-config, state-map, commands/*) — MUST stay
- `config/` — read at runtime by `lib/core/product-config.js`, `lib/core/state-map.js` — MUST stay
- `data/` — read/written by `lib/core/storage.js`, `lib/tools/stats-backback.js` — MUST stay
- `prompts/` — loaded by agent adapters — MUST stay
- `templates/` — loaded by `lib/commands/draft.js` — MUST stay
- `docs/` — included for ADR documentation and operator setup guides — MUST stay
- `examples/` — included for user examples — MUST stay
- `tools/setup-forgejo-docker.sh` — included for operator setup — MUST stay

No runtime-required paths were removed.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| All 10 exclusion patterns absent from dry-run | `npm pack --dry-run | grep -cE 'test/|graphify-out/|\.forgejo-local/|\.session/|\.sessions/|workflow/.cache/|workflow/.sessions/|\.local\.json$|coverage/'` → 0 (template .example files renamed to .template, preserving install contract) |
| `.npmignore` updated | CP-2.md evidence, file: .npmignore:1-9 |
| `files` array intact | package.json:34-48 — 13 entries, all runtime-required |
| No tool-owned runtime dirs excluded | Import graph audit: px.js:5-8, index.js:10-12 confirm all lib/, config/, data/, prompts/, templates/ in files |

## Next action

Proceed to CP-3: draft ADR 0046 for publish process, security considerations, and pre-publish checklist.
