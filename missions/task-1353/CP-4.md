# CP-4: Gate Integration

## Work Done

1. Added `gate_static_analysis()` function to `scripts/verify-local.sh` that runs three stages sequentially:
   - Stage 1: `npx --yes eslint --ext .js --max-warnings 0 lib/` — lint JS files in lib/
   - Stage 2: `npx --yes tsc --checkJs --noEmit` — type-check JS files via TypeScript
   - Stage 3: `bash scripts/test-hygiene.sh` — scan test files for .only/unannotated skips
2. Added `static-analysis` case to the case statement that invokes `gate_static_analysis()`
3. Updated usage comment to document the new subcommand
4. Gate exits non-zero on any stage failure, preventing `npm test` from executing
5. Default gate behavior (no subcommand) remains no-op (exit 0), leaving existing repos unaffected

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `gate_static_analysis()` runs ESLint | `verify-local.sh:19` — `npx --yes eslint --ext .js --max-warnings 0 lib/` |
| `gate_static_analysis()` runs tsc | `verify-local.sh:27` — `npx --yes tsc --checkJs --noEmit` |
| `gate_static_analysis()` runs hygiene | `verify-local.sh:35` — `bash scripts/test-hygiene.sh` |
| Stages run sequentially | `verify-local.sh:14-43` — all three stages in order within single function |
| Fails gate on any non-zero exit | `verify-local.sh:20-21, 28-29, 36-37` — each stage checks exit code, returns 1 on failure |
| `static-analysis` case in case statement | `verify-local.sh:66-68` — `static-analysis) gate_static_analysis() || exit 1` |
| Default behavior unchanged | Verified: `bash scripts/verify-local.sh` → exit 0 (no-op) |
| Static-analysis only via explicit selector | `verify-local.sh:66-68` — only triggered by `static-analysis` subcommand |
| npx uses --yes flag for non-interactive behavior | `verify-local.sh:19` — `npx --yes eslint`, `verify-local.sh:27` — `npx --yes tsc` |

## Next action
CP-5: Validate runtime budget — measure combined static-analysis stage under 10 seconds average over 3 runs
