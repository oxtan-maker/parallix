# CP-2: Apply public-facing distribution updates

## Summary

Aligned the three public distribution surfaces to the locked local-tarball / global `px`
model from CP-1, so the install/run story is internally consistent.

- **`package.json`**: removed the contradictions. `"private": true` → `false`; `name`
  `"parallix"` → scoped `"@magnusekdahl/parallix"`; `description` no longer says "unpublished" and
  now states the local-tarball + `px` model; added consistency metadata `engines.node`
  (`>=20`) and `publishConfig.access` (`restricted`, matching the scoped name). `bin.px` and
  the `files` allowlist are unchanged and remain consistent with the README.
- **`README.md`**: rewrote the line-3 opener from "visualBoard AI mission lifecycle" to
  "parallix AI mission lifecycle". Turned the packaging section into one explicit public
  distribution section ("## Public distribution (canonical packaging and install)") that
  answers all four required questions: supported acquisition/install path (scoped
  `@magnusekdahl/parallix` local tarball + global install), how the operator invokes `px`, what
  stays source-compatible for local dev (`node parallix <command>`), and what is **not yet
  supported** (registry publish, Homebrew, Docker, standalone binary, CI/release automation).
- **`docs/adr/0044-workflow-distribution-model.md`**: moved `Status: Proposed` → `Accepted`,
  added a `Last updated: 2026-06-22` line and a top "2026-06-22 Update" section recording the
  locked near-term stance with current evidence, while preserving all original
  Context/Decision/matrix/alternatives reasoning. Updated the `docs/adr/index.md` entry to
  reflect the Accepted stance.

The README "Public distribution" section, the `package.json` packaging fields, and ADR 0044's
accepted stance now all describe the same model (scoped local tarball, global `px`, source-run
baseline, registry/binary deferred).

## Goal Check

| Success criterion | Status | Evidence |
|---|---|---|
| SC1: one explicit README distribution section answering install/invoke/source-dev/not-supported; no `visualBoard` workflow framing | Done | `README.md:235-241` (section + install path), `README.md:273-277` (invoke `px`), `README.md:279-284` (source-compatible `node parallix`), `README.md:286-291` (not yet supported); opener fixed at `README.md:3` |
| SC2: package.json fields mutually consistent with README install story | Done | `package.json:2` (`@magnusekdahl/parallix`), `package.json:4` (description: local tarball + px), `package.json:6` (`"private": false`), `package.json:13-15` (`publishConfig.access: restricted`), `package.json:16-18` (`bin.px`) |
| SC3: distribution ADR no longer ambiguous/pre-public | Done | `docs/adr/0044-workflow-distribution-model.md:3` (`Status: Accepted`), `:5` (Last updated), `:7-33` (locked stance + deferred items), `docs/adr/index.md:15` (Accepted note) |
| Historical `visualBoard` evidence preserved | Done | `README.md:95` historical area-table note left intact; ADR 0041 / `docs/adr/index.md:19` untouched |

## Next action

In CP-3, convert the current-product `visualBoard` wording in the 7 skill templates under
`templates/vibe/skills/*/SKILL.md` (each `description:` line and the "thin entrypoint for the
visualBoard … workflow" line) to `parallix`, leave the justified-historical references in
place, then run the `npm test` gate and record pass/fail with the suite output.
