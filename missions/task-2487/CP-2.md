# CP-2: Amend ADR 0046 in place

## Work done

Edited `docs/adr/0046-npm-publish-process-and-security.md` only. No new document,
runbook, ADR, dated addendum, or supersedes clause was created.

**Context section.** Replaced the stale claim that `@magnusekdahl/parallix` returns
404 and the scoped name is unclaimed with the current state: the scope was unclaimed
at the time of task-1340 CP-0, and the package is now published under that name.

**Alternatives considered → Scoped package name alternatives.** The same stale
"confirmed available and unclaimed" phrasing was corrected to state that the scope
already carries the published package.

**Operational procedures (derived from this decision).** The four-step list was
expanded in place to nine steps, keeping pre-publish verification, token security, and
the content audit as they were and inserting:

- *Version drift between integrations* — `scripts/refresh-global-px.sh` runs as the
  post-integrate hook (`adapters.integrate.postIntegrateCommand` in
  `workflow.config.json`) after every successful non-dry-run `px integrate`, bumps the
  patch version, commits, rebuilds, packs, and installs globally, and does not publish
  to npm; the version on disk therefore moves without operator action.
- *Quiescing before a publish sequence* — concurrent mission integrations are drained
  or parked before a publish sequence begins.
- *Manual publish sequence* — now reads the on-disk version immediately before each
  publish instead of carrying one over from an earlier step, and ends with post-publish
  verification before the git tag.
- *Distinct version per publish in a multi-step sequence* — npm rejects a publish at an
  existing version, so a multi-publish sequence needs distinct versions by construction.
- *Post-publish verification against the live registry* — README demo-image rendering
  (the tarball ships `README.md` but the `files` allowlist excludes `docs/assets/`, so
  the relative image path must resolve against a reachable repository) and first-screen
  image loading on a throttled connection. Both are stated as unobservable from a local
  checkout or `npm pack --dry-run`.
- *Download-count baseline before a repositioning publish* — the npm download count is
  recorded before the first publish carrying the repositioning pitch, tied to the
  installation-based kill criterion in `docs/designs/reposition-as-trust-layer.md`.

**Links.** Added `scripts/refresh-global-px.sh` and
`docs/designs/reposition-as-trust-layer.md` as cited artifacts.

Scope note carried from CP-1: backlog acceptance criterion #9 (actually recording the
download count) is a registry operation the mission places out of scope; `ADR 0046` now
records the requirement, and the measurement belongs to the later publish operation.

## Verification

`./scripts/verify-local.sh all` exits 0 on this tree: `tests 2502`, `pass 2502`,
`fail 0`, `skipped 0`. (The `[FAIL]` strings in the log are simulated recovery-dossier
fixtures emitted by passing tests such as `"a declared checkpoint gap bounces and
continues once the agent writes the checkpoints"`, not gate failures.)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR 0046 states the post-integrate hook bumps the patch version, rebuilds, packs, installs globally, and does not publish to npm | `ADR 0046`, "Operational procedures" step "Version drift between integrations"; matches `scripts/refresh-global-px.sh` | PASS |
| ADR 0046 requires draining or parking concurrent integrations before a publish sequence | `ADR 0046`, "Operational procedures" step "Quiescing before a publish sequence" | PASS |
| ADR 0046 requires reading the version immediately before each publish; multi-step publication uses distinct versions | `ADR 0046`, "Operational procedures" steps "Manual publish sequence" and "Distinct version per publish in a multi-step sequence" | PASS |
| ADR 0046 defines live-registry checks for README demo-image rendering and first-screen image loading, and explains README.md ships while docs/assets/ does not | `ADR 0046`, "Operational procedures" step "Post-publish verification against the live registry"; `package.json` `files` allowlist | PASS |
| ADR 0046 requires recording the npm download count before the first repositioning publish, tied to the kill criterion | `ADR 0046`, "Operational procedures" step "Download-count baseline before a repositioning publish"; `docs/designs/reposition-as-trust-layer.md` | PASS |
| ADR 0046 no longer claims 404 / unclaimed | `ADR 0046` Context and "Alternatives considered → Scoped package name alternatives"; `grep -n "404\|unclaimed" docs/adr/0046-npm-publish-process-and-security.md` reports no surviving claim | PASS |
| Amendments integrated into existing sections; no addendum, supersedes clause, runbook, or new ADR | `ADR 0046` is the only file changed in this checkpoint; `git show --stat HEAD` lists it plus this checkpoint document | PASS |
| `./scripts/verify-local.sh all` completes successfully | `./scripts/verify-local.sh all` exit 0, `pass 2502` / `fail 0` | PASS |

Next action: re-run `./scripts/verify-local.sh all` against the committed tree and record the final Goal Check in CP-3.
