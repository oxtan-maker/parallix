# CP-4: npm Publishing Access Hardened

## Summary

The hardening is ready to apply but must wait for CP-3. Under the mission stop
rule, "disallow tokens" is enabled only after a live OIDC publish shows that no
token-dependent route remains.

What the hardening would affect, verified at this checkpoint:

- The account holds no npm access tokens: `npm token list --json` → `[]`, so
  there are no tokens to revoke.
- Nothing in the repository publishes with an npm token. There is no
  `npm publish`, `NODE_AUTH_TOKEN`, or `_authToken` in the scripts, source,
  config, or workflows. The post-integrate refresh installs a local `npm pack`
  tarball globally and never contacts the registry with a credential.
- "Require two-factor authentication and disallow tokens" still permits both
  trusted-publisher (OIDC) publishes and interactive publishes with 2FA. It
  blocks only token-based publishing. Installing the public package needs no
  authentication and is unaffected.

The ADR 0046 update (trusted `ci-required.yml` publishing, token publishing
disabled) is deferred until CP-3 demonstrates it, so the ADR never records an
unverified state.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| No token route still required | `npm token list --json` → `[]`; no npm publish credential referenced in the repository; ADR 0046 | PASS |
| Obsolete tokens revoked | `npm token list --json` → `[]` (none exist) | PASS |
| Publishing Access = "Require 2FA and disallow tokens" | npm package Settings > Publishing Access, applied after CP-3 per mission stop rule | BLOCKED (CP-3) |
| ADR 0046 updated | `docs/adr/0046-npm-publish-process-and-security.md` already describes Trusted Publishing (TASK-2509); the token-publishing-disabled state is recorded after the first trusted publish | BLOCKED (CP-3) |

## Next action
After the first CD publish shows provenance, the operator sets Publishing Access
to "Require two-factor authentication and disallow tokens" on npmjs.com, and ADR
0046 is updated to record OIDC-only publication from `ci-required.yml`.
