# CP 2 — Configure and document Graphify mission-document exclusions

Added repository `.graphifyignore` patterns for mission plans and checkpoint documents, without excluding the `missions/` directory. Documented that Graphify applies these gitignore-style patterns before graph nodes are created and that `graphify update .` refreshes an existing graph. The focused fixture is green against the installed Graphify detector and extractor.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Graphify uses an input-time exclusion mechanism | `.graphifyignore:4`, `test/task-2270-graphify-exclusion.test.js:18` | PASS |
| Configuration names exact generated mission-document patterns without excluding source paths | `.graphifyignore:4`, `.graphifyignore:5` | PASS |
| Focused coverage proves the excluded document is absent and the retained source relationship remains | `test/task-2270-graphify-exclusion.test.js:47`, `test/task-2270-graphify-exclusion.test.js:55`, `"Graphify excludes configured mission documents before extraction while retaining source relationships"` | PASS |
| Focused validation and repository gate pass | `npm test -- test/task-2270-graphify-exclusion.test.js`, `./scripts/verify-local.sh all` | Focused PASS; gate pending CP 3 |
| Documentation explains the configured exclusion and its effect | `docs/operator-setup.md:18`, `docs/operator-setup.md:25` | PASS |

Next action: run `graphify update .`, inspect the resulting graph for absence of generated mission documents and retained source relationships, then run the required repository verification gate.
