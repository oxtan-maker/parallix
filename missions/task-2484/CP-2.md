# Checkpoint 2 — Operator canonical-URL decision + manifest fix + offline verifier

## Goal
Obtain and record the operator's canonical-URL decision, correct all three `package.json` fields to that location, and implement the offline origin-agreement validation in `scripts/verify-docs.mjs`.

## Work Done

### Operator canonical-URL decision (recorded before the `package.json` edit)
The canonical public repository for `@magnusekdahl/parallix` is the `origin` remote of this checkout:

```
$ git remote get-url origin
https://github.com/oxtan-maker/parallix.git
```

Evidence in the backlog task (`backlog/tasks/task-2484 ... .md`): the current manifest pointed all three links at `github.com/magnusekdahl/parallix` (HTTP 404 for anonymous visitors), while `origin` = `github.com/oxtan-maker/parallix` resolves HTTP 200 (verified 2026-09-11). The confirmed canonical URL **matches `origin`**, so under the mission scope ("If it matches origin, correct all three manifest fields") all three fields were corrected to `origin`. No stop rule applies: `origin` is authoritative for this checkout, the confirmed URL equals `origin`, and no external hosting change is required.

### `package.json` corrections
- `repository.url`: `git+https://github.com/magnusekdahl/parallix.git` → `git+https://github.com/oxtan-maker/parallix.git`
- `homepage`: `https://github.com/magnusekdahl/parallix#readme` → `https://github.com/oxtan-maker/parallix#readme`
- `bugs.url`: `https://github.com/magnusekdahl/parallix/issues` → `https://github.com/oxtan-maker/parallix/issues`

These corrected values flow into `scripts/release-metadata.ts` (which reads `repository`/`homepage` from the manifest), fixing the propagated release metadata without touching release behavior.

### Offline origin-agreement validation in `scripts/verify-docs.mjs`
Added two helpers and a manifest check (runs before the authored-docs loop):
- `canonicalLocation(value)` collapses transport/`git+`/trailing-`.git`/`#readme`/`/issues` representational differences to `host/owner/repo`, so the same location compares equal across the three differently-shaped fields.
- `originRemoteUrl(repoRoot)` reads `PARALLIX_ORIGIN_REMOTE_URL` (test seam) or falls back to `git remote get-url origin` — **no HTTP request**.
- Reads `package.json` from the repo root; for each present field in `repository.url`, `homepage`, `bugs.url`, reports a failure when `canonicalLocation(field) !== canonicalLocation(origin)`.

### Regression test turns green
```
$ node --import tsx --test test/task-2484-npm-metadata-urls-repro.test.ts
✔ npm metadata that disagrees with origin is rejected by the verifier
✔ npm metadata that agrees with origin passes the verifier
ℹ pass 2
```
Same test was red on the parent commit (see CP 1). The verifier now exits non-zero when any field disagrees with origin and exits zero when all agree.

### Offline + real-repo proof
```
$ node scripts/verify-docs.mjs
PASS: authored documentation contains no volatile implementation evidence and relative links resolve
```
`exit=0` against the final matching manifest and `origin`. Existing `test/documentation-verification.test.ts` still passes (fixture has no `package.json`, guard skips the manifest check).

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Canonical URL recorded before `package.json` edit | `git remote get-url origin` → `https://github.com/oxtan-maker/parallix.git` (this checkpoint) | PASS |
| `repository.url`/`homepage`/`bugs.url` agree with `origin` | `node scripts/verify-docs.mjs` → `PASS`, exit 0 | PASS |
| Verifier exits non-zero on disagreement | `test/task-2484-npm-metadata-urls-repro.test.ts`, test `npm metadata that disagrees with origin is rejected by the verifier` | PASS |
| Check runs without network | `originRemoteUrl` uses `git remote get-url origin` / `PARALLIX_ORIGIN_REMOTE_URL` (no HTTP) | PASS |
| Regression test green after fix | `node --import tsx --test test/task-2484-npm-metadata-urls-repro.test.ts` → pass 2 | PASS |

## Next action
CP 3: document the verifier's manifest-metadata contract in `docs/doc-standards.md`, then run `./scripts/verify-local.sh all` and record final Goal Check evidence.
