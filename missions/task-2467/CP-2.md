# CP-2: README replay

Rendered the committed cast as a compact GIF, then replaced only the README first-value block and its adjacent explanation with an accessible linked image. The replay pauses on the mission contract and diff, while the implementation interval uses short delays.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Replace the initial first-value command block with one accessible replay image link | `README.md`; `docs/assets/first-value-demo.gif` | Complete |
| Record the disposable-directory lifecycle, including both inspections and `px integrate` | `docs/assets/first-value-demo.cast`; `scripts/record-first-value-demo.sh`; `px draft`, `px active`, and `px integrate` events in the cast | Complete |
| Commit a GitHub-rendered replay alongside its source cast | `docs/assets/first-value-demo.cast`; `docs/assets/first-value-demo.gif`; `node scripts/render-first-value-demo.mjs` | Complete |
| Hold inspection screens and accelerate implementation waiting in replay timing | `docs/assets/first-value-demo.cast`; `node scripts/render-first-value-demo.mjs` | Complete |
| State operator inspection and integration control accurately beside the replay | `README.md` | Complete |
| Pass the repository verification gate | `./scripts/verify-local.sh all` | Pending CP-3 |

Next action: Verify the committed README reference and replay paths on the final tree, then run `./scripts/verify-local.sh all`.
