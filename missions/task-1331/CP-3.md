# CP-3: Clean current-product `visualBoard` references and run the gate

## Summary

Converted the remaining current-product `visualBoard` branding in the active skill templates
to `parallix`, left justified-historical references untouched, fixed the one test that had to
change because the package name became scoped, and ran the `npm test` gate to green.

- **Templates** (`templates/vibe/skills/*/SKILL.md`, all 7 skills: act-on-review, area-review,
  draft, execute, integrate, portfolio, review): replaced every current-product `visualBoard`
  mention with `parallix` in both the `description:` frontmatter line and the "thin entrypoint
  for the … workflow" body line. `grep -rIn visualBoard templates/` now returns nothing.
- **Preserved historical/evidence references** (per MISSION Risks/Restricted Areas): the
  historical area-table note at `README.md:95` ("this table reflects visualBoard's areas"), the
  ADR 0041 task-1063 extraction evidence, the external path citation at `docs/adr/index.md:19`,
  the internal test-temp-dir prefix `lib/commands/coverage-gate.js:74`, and the `/tmp/visualBoard*`
  internal test fixtures — all left intact.
- **Test update** (`test/package-persistent-data.test.js:47-48`): the scoped package name
  `@magnusekdahl/parallix` (set in CP-2) means `npm install -g` now installs under
  `node_modules/@magnusekdahl/parallix`. Updated the resolved install root accordingly. No coverage
  was removed — the same reinstall/stats/blocklist assertions still run, and the `bin/px`
  invocation path (line 68-71) is unchanged because npm bin-linking is scope-independent.

## Gate

`npm test` → **1595 pass, 0 fail, 22 skipped, 1617 total** (duration ~12s). Re-ran the full
suite after the template and test edits; zero failures.

## Goal Check

| Success criterion | Status | Evidence |
|---|---|---|
| SC1: README has one explicit distribution section answering install/invoke/source-dev/not-supported; no `visualBoard` workflow framing | Pass | `README.md:235` (`## Public distribution`), `:241` (acquisition/install path), `:269` (invoke `px`), `:275` (source-compatible `node parallix`), `:281` (what is not yet supported); opener de-branded at `README.md:3` |
| SC2: package.json fields consistent with README install story | Pass | `package.json:2` (`@magnusekdahl/parallix`), `:4` (description: px CLI, local npm tarball), `:6` (`"private": false`), `:10` (`publishConfig`), `bin.px` retained |
| SC3: distribution ADR off ambiguous pre-public state, one authoritative decision | Pass | `docs/adr/0044-workflow-distribution-model.md:3` (`Status: Accepted`), `:5` (Last updated 2026-06-22), `:7` (locked stance + deferred items); `docs/adr/index.md:15` (Accepted note) |
| SC4: current branding surfaces (README + `templates/vibe/skills/`) no longer use `visualBoard` for the current product; remaining mentions justified | Pass | `grep -rIn visualBoard templates/` → none; `README.md:3` fixed; remaining repo mentions are historical/evidence/internal-path (`README.md:95`, `docs/adr/0041*`, `docs/adr/index.md:19`, `lib/commands/coverage-gate.js:74`, `test/*` temp paths) |
| SC5: affected tests updated without removing existing `px`/packaging/doc coverage | Pass | `test/package-persistent-data.test.js:47-48` install-root path updated for scoped name; reinstall + stats/blocklist + `bin/px` assertions retained (`test:52-90`); `node --test test/package-persistent-data.test.js` → 1 pass |
| SC6: `npm test` completes with zero failures | Pass | `npm test` → `tests 1617 / pass 1595 / fail 0 / skipped 22` |
| Gate: npm test | Pass | full-suite run above, 0 failures |

## Next action

Mission complete. Commit the CP-3 template/test/doc changes on `mission/task-1331`, then hand
off to review — all three checkpoints are documented, the four touched public surfaces
(README, package.json, ADR 0044, skill templates) are mutually consistent, and the `npm test`
gate is green.
