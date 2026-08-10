---
id: TASK-2354
title: Purge stale lib/ references and strip evidence paths from use-cases.md
status: active
assignee: [custom]
created_date: '2026-08-10 10:00'
updated_date: '2026-08-10 10:00'
labels:
  - docs
  - cleanup
  - ai_sdlc
dependencies: []
references:
  - docs/use-cases.md
  - docs/authority-reference.md
  - docs/real-agent-smoke.md
  - docs/doc-standards.md
  - docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md
  - docs/npm-package-major-migration.md
priority: medium
---

## Description

Post-ESM-cutover (task-2328), documentation still references the old `lib/` source
tree and `dist/` output directory. Source lives in `src/` (layered: `adapters/`,
`domain/`, `application/`, `interfaces/`, `composition/`, `entry/`), bundle is
`build/px.mjs`. No `lib/` or `dist/` directories exist.

`docs/use-cases.md` is worst offender: ~15 inline `lib/` code paths with line
numbers. Use-case documents should describe capabilities and outcomes, not anchor
claims to source-file coordinates. Those evidence paths are agent hallucinations
from the task-1336 rewrite — nobody reads line-number citations in a use-case doc,
and they rot immediately on refactor. Strip them all.

### Scope

**docs/use-cases.md** — remove ALL `lib/` and `index.js` code references. Keep
use-case descriptions, confidence levels, measured values, caveats, and red-team
analysis. Drop every `(E)` evidence citation pointing to `lib/` paths. The doc
should read as a capability inventory, not a code tour.

**docs/authority-reference.md** (lines 137, 143) — update `lib/tools/backlog.js`
and `lib/commands/draft.js` to current `src/` paths.

**docs/real-agent-smoke.md** (lines 6, 103, 145, 181) — update `lib/agents/`
and `lib/core/` paths to `src/adapters/agents/` and `src/adapters/`.

**docs/doc-standards.md** (line 81) — `lib/README.md` no longer exists. Replace
with `src/README.md` or remove if `src/` has no README.

**docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md** —
`lib/` and `dist/` references throughout. Update paths to `src/` / `build/px.mjs`
inline. No addenda — ADRs are forward-looking. Git preserves the old text.

**docs/npm-package-major-migration.md** — `dist/` refs are in the "before" column
of the comparison table. Contextually correct (documenting what was removed). No
change needed.

### Constraints

- Consult `docs/doc-standards.md` before editing any `.md` file
- `docs/use-cases.md` must NOT introduce `src/` paths as replacement evidence.
  Strip evidence paths entirely, don't swap `lib/` for `src/`.
- ADRs are forward-looking. Update stale paths inline. No addenda — git is for
  historical artifacts.
- Run `graphify update .` after changes.

### Gates

- `./scripts/verify-local.sh docs` — link hygiene and required docs check
