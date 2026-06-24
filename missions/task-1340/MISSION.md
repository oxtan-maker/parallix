# Mission: make parallix publishable (task-1340)

## Goal

Prepare parallix for npm registry publication by creating a hardened package layout, establishing a one-command install path (`npm install -g @magnusekdahl/parallix`), documenting the publish process and security posture in an ADR, and verifying the package contents exclude operator-local state, secrets, and development-only files. The operator publishes manually; this mission makes the package ready to publish. Packages published to the public npm registry are automatically signed with ECDSA registry signatures — no publisher action required. Consumers can verify signatures with `npm audit signatures`.

## Why Now

The repo was pushed to public GitHub on 2026-06-22 (task-1322). The current install requires two manual steps — `npm pack` followed by `npm install -g ./magnus-parallix-*.tgz` — which the SEO mission revealed as unnecessarily complicated for new users. ADR 0044 locked the distribution stance as "local npm tarball, globally installed px CLI" but deferred concrete publish preparation. With the repo now public, anyone can see the package and the operator wants a credible, secure, single-command install path before inviting external use.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: public repo exposure, simplified install path, security hardening for public audience

## Scope

- Verify npm scope availability for `@magnusekdahl/parallix`: check if `@magnusekdahl` scope exists on npm registry; if taken or unavailable, identify and agree on an alternative scope name (e.g., `@parallix/parallix`, `@px-cli/parallix`, or operator-provided scope)
- Audit `package.json` fields relevant to public publication: `name`, `version`, `description`, `main`, `exports`, `engines`, `files`, `bin`, `license`, `repository`, `keywords`, `bugs`, `homepage`
- Review and tighten the `.npmignore` / `files` allowlist so the published package excludes test files, development caches, graphify output, session data, and operator-local config
- Create or update an ADR documenting the publish process, security considerations for a public npm package, and the publish checklist (what to verify before pushing to the registry)
- Document the one-command install path (`npm install -g @magnusekdahl/parallix` or alternative scope) including post-install verification (`px --version`) and optional `px shell-init` setup
- Verify the package builds cleanly with `npm pack --dry-run` and inspect the tarball contents
- Update `README.md` install section to reflect the published install path (once ready) while preserving the local tarball path for backward compatibility

## Out of Scope

- Actually publishing to the npm registry (operator does this manually)
- Setting up CI/release automation or npm token management
- Publishing to other registries (Homebrew, Docker, PyPI)
- Enterprise distribution mechanisms beyond the npm package contents
- Changes to the `px` CLI commands, subcommand list, or workflow logic
- Graphify skill installation changes (documented separately in docs/operator-setup.md)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. **npm scope resolved:** The scoped package name (`@magnusekdahl/parallix` or agreed alternative) is confirmed available on npm registry or an alternative scope is documented with rationale. This is reflected consistently in `package.json`, README, and ADR.

2. **Package contents audit passes:** `npm pack --dry-run` output contains zero entries matching any of: `test/`, `graphify-out/`, `.forgejo-local/`, `.session/`, `.sessions/`, `workflow/.cache/`, `workflow/.sessions/`, `workflow/config/agents.local.json`, `agents.local.json`, `*.local.json`, `coverage/`. All 10 exclusion patterns are verified against the dry-run listing.

2. **ADR exists and is referenced:** A new ADR (0046) or updated existing ADR documenting the publish process, security posture, and pre-publish checklist exists in `docs/adr/`, is listed in `docs/adr/index.md`, and has Status: Proposed or Accepted. The ADR covers: registry publish steps, npm token security, package content review procedure, and rollback considerations.

3. **Install path documented:** The README.md or a dedicated publish-install guide documents the single-command install `npm install -g @magnusekdahl/parallix` with post-install verification (`px --version`) and the optional `eval "$(px shell-init bash)"` step. The documentation is present in the repo at mission completion.

4. **package.json publication fields complete:** `package.json` has all of the following fields set with non-empty, non-placeholder values: `name`, `version`, `description`, `license`, `engines`. The `files` array excludes no tool-owned directories needed for runtime operation (config/, lib/, prompts/, templates/, tools/, data/, index.js, px.js, LICENSE, README.md, CHANGELOG.md, examples/).

5. **Tarball builds without errors:** Running `npm pack` in the repo root produces a `.tgz` file without warnings or errors, and the resulting tarball extracts cleanly into a temporary directory with all `files`-listed paths present.

## Risks and Assumptions

- **Risk:** The `@magnusekdahl` npm scope may be unavailable or taken. Mitigation: CP 0 verifies scope availability early; if unavailable, propose alternatives (e.g., `@parallix/parallix`) and obtain operator approval before proceeding.
- **Risk:** Tightening the `files` allowlist could inadvertently exclude a runtime-required path. Mitigation: cross-reference each `files` entry against the import graph in `px.js` and `index.js` before locking.
- **Risk:** The `@magnusekdahl/parallix` scoped name could conflict with a future npm policy change or registry issue. Mitigation: scoped names are npm's recommended approach for personal/org packages; low practical risk.
- **Assumption:** The operator retains npm registry access and will handle the actual `npm publish` command manually after this mission completes.
- **Assumption:** Node.js >=20 engine requirement in `package.json` is acceptable for the target audience.
- **Risk:** Adding security guidance to the ADR could be perceived as over-engineering for a simple npm publish. Mitigation: focus on concrete checklist items (content audit, token security) rather than abstract security theory.
- **Assumption:** The existing `npm pack` behavior with the `files` array is the correct mechanism for controlling published content (no need to switch to `.npmignore`-only mode).

## Checkpoints

- CP 0: npm scope availability verified — `@magnusekdahl` scope checked on npm registry; if unavailable, an alternative scope name identified and agreed upon
- CP 1: Package.json audit complete — all publication fields reviewed, gaps documented
- CP 2: Files allowlist tightened — `.npmignore` and `files` array verified against exclusion patterns
- CP 3: ADR drafted — publish process, security considerations, and pre-publish checklist written
- CP 4: Install path documented — README or guide updated with one-command install instructions
- CP 5: Tarball verified — `npm pack` succeeds, dry-run inspected, extract test passes

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] npm pack --dry-run | grep -cvE '^$' (non-zero count confirms files listed)
- [ ] Tarball extract test: `npm pack && mkdir -p /tmp/parallix-test && tar xzf magnus-parallix-*.tgz -C /tmp/parallix-test/package/ && test -f /tmp/parallix-test/package/px.js && test -f /tmp/parallix-test/package/lib/core/fmt.js`

## Restricted Areas

- Do not modify any `lib/` command handler logic, agent adapters, or workflow coordination code
- Do not change the `px` subcommand list, flag names, or help text
- Do not modify `workflow.config.json` or any operator-local configuration files
- Do not add npm dependencies (the package has zero runtime dependencies by design)
- Do not create or modify `.npmrc`, `~/.npmrc`, or any npm token files

## Stop Rules

- If tightening the `files` list causes any `lib/` module import to fail in the packed tarball, revert that change and document the conflict as a follow-up task
- If the ADR scope expands beyond publish preparation (e.g., CI automation, enterprise distribution), stop and defer those topics to separate tasks
- If any test in `test/*.test.js` fails after changes, investigate and fix before completing the mission
- If the operator indicates the publish timeline has shifted significantly, pause and reassess priority
