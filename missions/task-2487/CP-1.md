# CP-1: Inspect ADR 0046 and map the amendment criteria to existing sections

## Work done

Read `ADR 0046` (`docs/adr/0046-npm-publish-process-and-security.md`) end to end and
reconciled the mission's claims against the repository's current behavior:

- `scripts/refresh-global-px.sh` is wired as the post-integrate hook via
  `workflow.config.json` (`adapters.integrate.postIntegrateCommand`). It runs
  `npm version patch --no-git-tag-version`, commits the bump, runs `npm run build`,
  `npm pack`, and `npm install -g ./<tarball>`. It contains no `npm publish`
  invocation, so the mission's version-drift premise is confirmed against the tree.
- `package.json`'s `files` allowlist is `NOTICES`, `build/`, `!build/sea`, `LICENSE`,
  `README.md`. `docs/assets/` is absent, confirming the tarball ships `README.md`
  without the demo asset it references.
- `README.md` embeds `docs/assets/first-value-demo.gif` on the first screen; the
  file is 4.76 MB in the working tree. Neither its registry-side rendering nor its
  load time is observable from `npm pack --dry-run`.
- `docs/designs/reposition-as-trust-layer.md` states the kill criterion: "if 5 people
  read the retitled pitch and none install, the trust positioning is wrong too".
  Evaluating it requires a download count captured before the first repositioning
  publish.
- `ADR 0046`'s Context section still claims `@magnusekdahl/parallix` returns 404 and
  the scoped name is unclaimed; the Alternatives section repeats "confirmed available
  and unclaimed". `package.json` is at version 1.5.98, i.e. the package has been
  released well past the 2026-06-23 statement.

No new runbook, ADR, or addendum was created in this checkpoint; no file was modified.

## Criterion-to-section map

| Amendment | Target section in `ADR 0046` |
|---|---|
| Post-integrate hook bumps patch version, no publish | "Operational procedures (derived from this decision)", step 2 area |
| Drain or park concurrent integrations before a publish sequence | Same, publish sequence step |
| Read version immediately before each publish; distinct versions per publish | Same, publish sequence step |
| Live-registry post-publish checks (README image rendering, first-screen load) | Same, new post-publish verification step beside "Pre-publish verification" |
| Record npm download count before first repositioning publish | Same, post-publish/measurement step, linked to the design doc kill criterion |
| Correct stale 404/unclaimed claim | "Context" (last paragraph) and "Alternatives considered → Scoped package name alternatives" |

## Scope note

Backlog acceptance criterion #9 ("The current npm download count for the package is
recorded before the first repositioning publish") is an operation on the registry,
which the mission's Out of Scope section explicitly excludes ("querying or recording a
live npm download count as part of this mission"). This mission therefore records the
*requirement* in `ADR 0046`; the measurement itself belongs to the later publication
operation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR 0046 states the post-integrate hook bumps the patch version, rebuilds, packs, installs globally, and does not publish | `scripts/refresh-global-px.sh` verified (bump/build/pack/`npm install -g`, no `npm publish`); target section identified in `ADR 0046` | PENDING (CP-2) |
| ADR 0046 requires draining or parking concurrent integrations | Target section identified in `ADR 0046` operational procedures | PENDING (CP-2) |
| ADR 0046 requires reading the version immediately before each publish; distinct versions per publish | `package.json` version 1.5.98 confirms drift; target section identified in `ADR 0046` | PENDING (CP-2) |
| ADR 0046 defines live-registry checks and explains README.md ships while docs/assets/ does not | `package.json` `files` allowlist inspected; `README.md` references `docs/assets/first-value-demo.gif` | PENDING (CP-2) |
| ADR 0046 requires recording the npm download count as repositioning baseline | Kill criterion located in `docs/designs/reposition-as-trust-layer.md` | PENDING (CP-2) |
| ADR 0046 no longer claims 404 / unclaimed | Stale claims located in `ADR 0046` Context and Alternatives sections | PENDING (CP-2) |
| Amendments integrated into existing sections; no addendum, supersedes clause, runbook, or new ADR | Map above assigns every amendment to an existing `ADR 0046` section; no file created in CP-1 | PASS |
| `./scripts/verify-local.sh all` completes successfully | Gate deferred to CP-3 | PENDING (CP-3) |

Next action: amend the "Operational procedures (derived from this decision)" section of `ADR 0046` with the version-drift, sequencing, live-registry, and download-baseline content, then correct the stale 404/unclaimed claims in its Context and Alternatives sections (CP-2).
