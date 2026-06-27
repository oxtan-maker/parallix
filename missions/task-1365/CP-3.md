# CP-3: .npmignore Verified

## Summary

Verified that root `.npmignore` does not contain a `.ts` exclusion entry. The current `.npmignore` excludes:
- `*.local.json`
- `test/`
- `coverage/`
- `graphify-out/`
- `.forgejo-local/`
- `.session/`
- `.sessions/`
- `workflow/.cache/`
- `workflow/.sessions/`

No `.ts` entry exists. `npm pack --dry-run` confirms the package contents include all directories listed in `package.json` `files` array. When `.ts` source files are added in subsequent missions, they will ship alongside compiled `.js` files since there is no `.ts` exclusion in `.npmignore`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `.npmignore` does not contain `.ts` entry | `grep -n '^\.ts' .npmignore` returns exit code 1 (.npmignore:1-9) | PASS |
| `npm pack --dry-run` includes `lib/`, `config/`, `docs/`, `data/`, `prompts/`, `templates/` | `npm pack --dry-run` output: tarball contains `config/agents.json`, `data/.gitkeep`, `docs/adr/0031-ai-agent-instruction-boundary-and-command-floor.md`, `lib/` implied by `files: ["lib/"]` in `package.json:44` | PASS |
| `.ts` files would ship alongside `.js` | No `.ts` glob in `.npmignore:1-9`; `package.json:44` `files` includes `lib/` which will contain emitted `.js` from future `.ts` sources | PASS |

## Next action
Proceed to CP-4: Run `npm test` to verify all existing tests pass with zero failures.
