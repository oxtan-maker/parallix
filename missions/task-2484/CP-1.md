# Checkpoint 1 — Reproduction test for npm metadata URL disagreement

## Goal
Create `test/task-2484-npm-metadata-urls-repro.test.ts` before any production fix. The test runs the documentation verifier against a synthetic fixture whose `repository.url`, `homepage`, or `bugs.url` disagrees with the simulated `origin` URL and asserts rejection. This assertion is **red** on the mission parent commit and **green** after the verifier change.

## Work Done
- Added `test/task-2484-npm-metadata-urls-repro.test.ts`. It builds a temp fixture (authored docs + copied `scripts/verify-docs.mjs` + a `package.json`), points the verifier at a synthetic origin via `PARALLIX_ORIGIN_REMOTE_URL`, and asserts:
  - a manifest whose three fields point at the dead `magnusekdahl/parallix` location is **rejected** (exit 1, `disagrees with origin remote`);
  - a manifest agreeing with origin **passes** (exit 0).
- The seam is the `PARALLIX_ORIGIN_REMOTE_URL` environment override so the check stays offline (no HTTP, no GitHub/npm).
- Ran the regression test on the mission parent commit (`d20fcea5d`): **RED** — the verifier ignores the manifest, so the mismatch fixture exits 0 and the rejection assertion fails.

### Red evidence (parent commit, verifier unchanged)
```
$ node --import tsx --test test/task-2484-npm-metadata-urls-repro.test.ts
✖ npm metadata that disagrees with origin is rejected by the verifier
  AssertionError: expected verifier to reject mismatched metadata, stderr:
  0 !== 1
```
The test file `test/task-2484-npm-metadata-urls-repro.test.ts` is the exact regression-test name required; it is red here and turns green after CP 2's verifier change.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists before production fix | `test/task-2484-npm-metadata-urls-repro.test.ts` | PASS |
| Test asserts rejection of mismatched metadata | exact regression-test name `npm metadata that disagrees with origin is rejected by the verifier` | PASS |
| Test is red on the mission parent commit | `node --import tsx --test test/task-2484-npm-metadata-urls-repro.test.ts` → `0 !== 1` FAIL | PASS |
| Checkpoint gate `./scripts/verify-local.sh all` | deferred to CP 3 (final tree) | PENDING |

## Next action
CP 2: record the operator's canonical-URL decision, correct all three `package.json` fields to `origin`, and implement the offline origin-agreement check in `scripts/verify-docs.mjs`, then confirm the regression test turns green.
