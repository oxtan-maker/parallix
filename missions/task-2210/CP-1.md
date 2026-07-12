# CP 1 — Help and parser map

Mapped the top-level `px --help` renderer and the existing workflow parsers before making changes. `printUsage` currently lists `draft` and `active` without their implementer-selection flags, while the command handlers already parse `--agent <family>` and `--implementer <family>` respectively. The option values are agent-family names; when omitted, each handler preserves its current configuration-based selection (`selectAgent`), so no static default is advertised.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `px --help` exposes a discoverable path to implementer selection for draft and active | `index.ts:222`, `index.ts:232`, `index.ts:233` map the top-level help renderer and its draft/active entries | MAPPED |
| Draft and active help uses the parser-supported spelling and value syntax | `lib/commands/draft.ts:131`, `lib/commands/draft.ts:151`, `lib/commands/active.ts:42`, `lib/commands/active.ts:62` | MAPPED |
| Automated help-contract coverage identifies the three relevant surfaces | `test/index.test.js`, `test/draft-command.test.js`, `test/active.test.js` | PLANNED |
| Implementer-selection behavior remains unchanged outside help and documentation | `lib/commands/draft.ts:278`, `lib/commands/active.ts:186` | BASELINE RECORDED |
| Final verification will be recorded with the required command | `./scripts/verify-local.sh all` | PLANNED |

Next action: update `printUsage` and its focused assertions to surface the existing draft and active option syntax, then align the command reference wording.
