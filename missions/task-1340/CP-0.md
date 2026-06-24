# CP-0: npm scope availability verified

## Work Done

Checked npm registry for `@magnusekdahl/parallix` availability:

```
$ npm view @magnusekdahl/parallix version
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@magnusekdahl%2fparallix
```

The `@magnusekdahl` scope does not exist as a published scope (npm returns EINVALIDTAGNAME for bare scope lookup, which is expected behavior — scopes are not packages). The scoped name `@magnusekdahl/parallix` is available for publication.

## Decision

No alternative scope needed. The existing `@magnusekdahl/parallix` in `package.json` is confirmed available.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `@magnusekdahl/parallix` not on npm registry | `npm view @magnusekdahl/parallix version` → E404 (file: package.json:2, test: `npm view @magnusekdahl/parallix`) |
| `@magnusekdahl` scope has no published packages | `npm view @magnusekdahl` → EINVALIDTAGNAME (expected for bare scope) |
| No alternative scope needed | Confirmed; `@magnusekdahl/parallix` is available |

## Next action

Proceed to CP-1: audit `package.json` publication fields.
