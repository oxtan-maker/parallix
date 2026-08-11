# CP-3 — Compatibility cleanup and final certification

## Summary

Removed the remaining bare setup and verify forwarding modules. The six interfaces now parse CLI requests and delegate only through runners injected by the composition root; they do not import adapters directly. The production dependency guard remains a zero-exception scan. The application and interface layer READMEs state their responsibilities and link to ADR 0051. Static-analysis verification passes on the repaired tree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| All six canonical CLI interface modules export parsing, rendering, and injected-runner factories | `src/interfaces/cli/active.ts:7`, `src/interfaces/cli/active.ts:14`, `src/interfaces/cli/active.ts:21`, `src/interfaces/cli/config.ts:3`, `src/interfaces/cli/diff.ts:7`, `src/interfaces/cli/resolve-conflict.ts:13`, `src/interfaces/cli/setup.ts:13`, `src/interfaces/cli/verify.ts:13` | PASS |
| Composition resolves the six commands through `src/interfaces/cli/` and supplies concrete runners | `src/composition/create-cli.ts:12`, `src/composition/create-cli.ts:21`, `src/composition/create-cli.ts:23`, `src/composition/create-cli.ts:46`, `src/composition/create-cli.ts:49`, `src/composition/create-cli.ts:60`, `src/composition/create-cli.ts:106` | PASS |
| Production dependency guard has no exceptions | `src/adapters/architecture/boundary-guards.ts:111`, "dependency graph production scan has no violation outside the owned allowlist" | PASS |
| Application-layer responsibilities reference ADR 0051 | `src/application/README.md:5`, `docs/adr/0051-ui-neutral-application-boundary.md` | PASS |
| Interface-layer responsibilities reference ADR 0051 | `src/interfaces/README.md:5`, `docs/adr/0051-ui-neutral-application-boundary.md` | PASS |
| Full verification surface passes | `./scripts/verify-local.sh all` | PASS |
| Mandatory integration verification passes | `./scripts/verify-local.sh integrate` | PASS |
| ESLint, production typecheck, test hygiene, and test typecheck pass | `./scripts/verify-local.sh static-analysis` | PASS |
| Command ownership is canonical at the composition root | `src/composition/create-cli.ts:104`, `test/cli-interface-migration.test.ts` | PASS |

Next action: Hand the committed mission tree to TASK-2332.08 for responsibility-guard certification.
