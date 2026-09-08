# CP-1: Deterministic terminal demo source

Created a disposable, credential-free terminal rehearsal and its checked-in asciicast source. The cast starts in a new directory and shows mission drafting, contract inspection before activation, autonomous-review output, diff inspection, and an explicit integration command. The README remains unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Replace the initial first-value command block with one accessible replay image link | `README.md`; `docs/assets/first-value-demo.gif` | Pending CP-2 |
| Record the disposable-directory lifecycle, including both inspections and `px integrate` | `docs/assets/first-value-demo.cast`; `scripts/record-first-value-demo.sh`; `px draft`, `px active`, and `px integrate` events in the cast | Complete |
| Commit a GitHub-rendered replay alongside its source cast | `docs/assets/first-value-demo.cast`; `scripts/render-first-value-demo.mjs` | Pending CP-2 |
| Hold inspection screens and accelerate implementation waiting in replay timing | `docs/assets/first-value-demo.cast`; `scripts/render-first-value-demo.mjs` | Complete |
| State operator inspection and integration control accurately beside the replay | `README.md` | Pending CP-2 |
| Pass the repository verification gate | `./scripts/verify-local.sh all` | Pending CP-3 |

Next action: Commit the rendered GIF with the source cast, then replace only README.md's initial first-value block and adjacent explanation.
