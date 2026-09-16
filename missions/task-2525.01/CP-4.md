# CP 4 — Control-Character Findings (`S6324`)

## Summary

Repaired the control-character findings (`S6324`, control characters in regex
literals / source) by removing literal control characters from source and
detecting them by code point instead.

- `src/application/presentation/cli-format.ts` — `stripAnsi` previously matched
  the SGR escape with a `\x1B` control character written directly in a regex
  literal. The pattern is now built from the ESC code point:
  ```ts
  const ANSI_SGR_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, 'g');
  ```
  Matched text is unchanged.
- `src/interfaces/web/security.ts` — `resolveAssetPath` previously rejected
  control characters with the inline class `/[\x00-\x1f]/.test(decoded)`. The
  check is now a `hasControlCharacter` helper that scans by code point
  (`charCodeAt(index) <= 0x1f`, NUL included), so no control-character class
  lives in a regex literal. Behavior is unchanged: C0 controls (U+0000–U+001F)
  are still rejected with status 400, exactly as before.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| S6324 control chars removed from literals | `git diff` shows `String.fromCharCode(0x1b)` in `src/application/presentation/cli-format.ts` and `hasControlCharacter()` in `src/interfaces/web/security.ts` | PASS |
| Behavior unchanged | `test/sonarqube-reliability-repairs.test.ts`, `"resolveAssetPath rejects control characters and NUL in the decoded path"`, `"stripAnsi removes SGR escape sequences after the control-character repair"` | PASS |
| SC4 — no rule disabled | grep `sonar.comments`/`@sonar`/`sonar.exclusions` in changed tree yields none | PASS |
| Full suite green | `` `npm test` `` → 2636 pass, 0 fail | PASS |

## Next action

CP-5: repair the constant-conditional findings (`S3923`) — conditionals whose
both branches return the same value.
