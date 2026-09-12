# CP-3: Verification and final Goal Check

## Work done

Tightened the corrected Context sentence in `ADR 0046` so no historical
"unclaimed"/404 phrasing survives at all — `grep -n "404\|unclaimed"
docs/adr/0046-npm-publish-process-and-security.md` now returns no match — and fixed a
"steps 4's" → "step 4's" wording slip in the new multi-step publication procedure.
Then ran the mission gate on the final tree.

`./scripts/verify-local.sh all` exits 0: `tests 2502`, `pass 2502`, `fail 0`,
`skipped 0`, `todo 0`. No `.only` and no bare `.skip` were introduced; this mission
changed one markdown document and its checkpoint files, adding no test code.

The `[FAIL]` strings visible in the verification log are simulated recovery-dossier
fixture output produced by passing tests (for example `"a declared checkpoint gap
bounces and continues once the agent writes the checkpoints"`), not gate failures.

## Deliberate scope boundary

Backlog acceptance criterion #9 asks that the current npm download count be recorded
before the first repositioning publish. That is a registry measurement the mission
places out of scope ("Out of Scope: … querying or recording a live npm download count
as part of this mission"). `ADR 0046` now carries the requirement and the reason for
it; the actual count belongs to the later publication operation, which is the only
point at which a "before the first repositioning publish" value is meaningful.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR 0046 states the post-integrate hook `scripts/refresh-global-px.sh` bumps the patch version after every successful `px integrate`, rebuilds, packs, installs globally, and does not publish to npm | `ADR 0046`, "Operational procedures (derived from this decision)" step 2 "Version drift between integrations"; wording reconciled against `scripts/refresh-global-px.sh` (`npm version patch --no-git-tag-version`, `npm run build`, `npm pack`, `npm install -g`, no `npm publish`) | PASS |
| ADR 0046 requires concurrent mission integrations to be drained or parked before a publish sequence | `ADR 0046`, "Operational procedures" step 3 "Quiescing before a publish sequence" | PASS |
| ADR 0046 requires reading the on-disk version immediately before each publish and states that a multi-step publication uses distinct versions because npm rejects an already-published version | `ADR 0046`, "Operational procedures" steps 4 "Manual publish sequence" and 5 "Distinct version per publish in a multi-step sequence" | PASS |
| ADR 0046 defines live npm registry-page checks for README demo-image rendering and first-screen image loading, and explains the tarball includes `README.md` but excludes `docs/assets/` | `ADR 0046`, "Operational procedures" step 6 "Post-publish verification against the live registry"; matches the `files` allowlist in `package.json` (`NOTICES`, `build/`, `!build/sea`, `LICENSE`, `README.md`) and the absolute `raw.githubusercontent.com` image URL landed by task-2484 (`fb2842235`) | PASS |
| ADR 0046 requires recording the npm download count before the first repositioning publish and connects it to the installation-based kill criterion | `ADR 0046`, "Operational procedures" step 7 "Download-count baseline before a repositioning publish"; cites `docs/designs/reposition-as-trust-layer.md` | PASS |
| ADR 0046 no longer claims that `@magnusekdahl/parallix` returns 404 or that the scoped name is unclaimed | `ADR 0046` Context and "Alternatives considered → Scoped package name alternatives" rewritten; `grep -n "404\|unclaimed" docs/adr/0046-npm-publish-process-and-security.md` returns no match | PASS |
| Amendments integrated into ADR 0046's existing sections; no dated addendum, supersedes clause, parallel release runbook, or new ADR created | `ADR 0046` is the only document changed by this mission (`git log --stat mission/task-2487 ^main -- docs/`); edits land inside Context, Operational procedures, Alternatives considered, and Links | PASS |
| `./scripts/verify-local.sh all` completes successfully on the drafted change | `./scripts/verify-local.sh all` exit 0, `tests 2502` / `pass 2502` / `fail 0` / `skipped 0` | PASS |

Next action: hand off task-2487 to review; no further ADR sections require amendment and the `./scripts/verify-local.sh all` gate is green on the committed tree.

## Reconciliation with task-2484 (landed on main after CP-3)

Task-2484 landed on `main` as `fb2842235` while this mission was in review. It
rewrote the README demo image from a relative `docs/assets/first-value-demo.gif`
path to an absolute
`https://raw.githubusercontent.com/oxtan-maker/parallix/main/docs/assets/first-value-demo.gif`
URL (and corrected the `repository`, `bugs`, and `homepage` URLs in
`package.json` to the `oxtan-maker` owner).

The ADR 0046 post-publish bullet was written against the pre-fix state and said
rendering "depends on npm resolving that path against a reachable repository".
That is no longer the mechanism. The bullet now states the current one: the
`files` allowlist still excludes `docs/assets/`, so the README uses an absolute
raw.githubusercontent.com URL, and the live-registry check exists because that
URL is resolved against the public repository — a repository rename, a branch
rename, or a moved asset breaks the published README silently while the local
checkout still renders.

The check itself is unchanged in scope: it remains a post-publish observation on
the npmjs.com package page that cannot be made from a local checkout or from
`npm pack --dry-run`.
