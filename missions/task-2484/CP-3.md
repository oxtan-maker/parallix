# Checkpoint 3 — Verifier contract documentation + repository gate

## Goal
Document the verifier's manifest-metadata contract, run the required repository gate, and record final Goal Check evidence.

## Work Done

### Documentation of the verifier contract
Updated `docs/doc-standards.md` (section 14, "Documentation hygiene") to state what `scripts/verify-docs.mjs` validates: the live-doc volatile-evidence/link contract **and** the new npm manifest metadata contract — `package.json` `repository.url`, `homepage`, and `bugs.url` are compared against `git remote get-url origin` and fail on disagreement, normalizing only representational differences, offline (no network). The update contains no volatile source-path or test-inventory evidence, so it passes the verifier it describes.

### Manifest fields now match `origin`
```
$ git remote get-url origin
https://github.com/oxtan-maker/parallix.git
```
`package.json` → `repository.url` = `git+https://github.com/oxtan-maker/parallix.git`, `homepage` = `https://github.com/oxtan-maker/parallix#readme`, `bugs.url` = `https://github.com/oxtan-maker/parallix/issues`.

### Regression test (red → green)
- Red on parent (CP 1): `node --import tsx --test test/task-2484-npm-metadata-urls-repro.test.ts` → `0 !== 1`.
- Green after fix: test `npm metadata that disagrees with origin is rejected by the verifier` and `npm metadata that agrees with origin passes the verifier` → pass 2.

### Offline proof
`node scripts/verify-docs.mjs` → `PASS: authored documentation contains no volatile implementation evidence and relative links resolve`, exit 0 against the final matching manifest and `origin`. No HTTP request; the check resolves origin from `git remote get-url origin` (or `PARALLIX_ORIGIN_REMOTE_URL`).

### Repository gate
```
$ ./scripts/verify-local.sh all
...
ℹ tests 2502
ℹ pass 2502
ℹ fail 0
ALL-GATE exit=0
```

### Test classification
`test/task-2484-npm-metadata-urls-repro.test.ts` spawns the verifier as a real child process, so it crosses a process boundary and is registered in the integration layer (`test/default-test-suite.test.ts` expected integration list). `test/default-test-suite.test.ts` and `test/documentation-verification.test.ts` still pass.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Canonical URL recorded before `package.json` edit | `git remote get-url origin` → `https://github.com/oxtan-maker/parallix.git` (CP 2) | PASS |
| `repository.url`/`homepage`/`bugs.url` agree with `origin` | `node scripts/verify-docs.mjs` → PASS, exit 0 | PASS |
| Verifier exits non-zero on disagreement | `test/task-2484-npm-metadata-urls-repro.test.ts`, test `npm metadata that disagrees with origin is rejected by the verifier` | PASS |
| Metadata check is offline and passes on final matching tree | `node scripts/verify-docs.mjs` exit 0; `originRemoteUrl` uses `git remote get-url origin` / `PARALLIX_ORIGIN_REMOTE_URL` | PASS |
| Regression test red on parent, green after fix | `test/task-2484-npm-metadata-urls-repro.test.ts` (CP 1 red `0 !== 1`; CP 2 green pass 2) | PASS |
| Docs describe verifier manifest-metadata validation | `docs/doc-standards.md` §14 | PASS |
| `./scripts/verify-local.sh all` exits zero | `./scripts/verify-local.sh all` → tests 2502, pass 2502, fail 0 | PASS |

## Next action
All three checkpoints complete and the single mission gate (`./scripts/verify-local.sh all`) passes. Commit CP-3.md and hand off; no further work remains.
