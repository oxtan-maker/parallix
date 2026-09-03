# CP-6: Packaging proof — npm pack, browser bundle audit, separate browser-asset size

## Summary

Proved the published `npm` artifact launches the web UI from shipped files only,
audited the browser bundle, and reported browser-asset size separately without
touching the canonical 5 MB gate.

- **Packaging smoke (SC7):** `test/web-package-smoke.integration.test.ts` runs
  `npm pack` (which runs `prepack` → `npm run build`, producing the canonical
  `px.mjs` and `build/web` with its serving manifest), extracts the tarball into
  an isolated dir with no `src/`, no `node_modules`, and no operator files, then
  launches the packaged `node build/px.mjs web`. "the packaged tarball serves
  the shell from built assets without src, CDN, or a dev server" proves launch
  from shipped files; the served HTML has zero `http(s)://` references and no
  inline executable script (CSP `script-src 'self'`); "the per-launch session is
  unavailable after the process exits" proves the per-launch session dies with
  the process.
- **Browser bundle audit (SC9):** `test/web-board-render.test.ts` "production
  browser code imports no Node built-in, concrete adapter, or server module" and
  "production browser code uses no browser persistence or cached snapshot" — no
  Node built-ins, no concrete persistence adapters, no shell/process APIs, and
  no source-map path leakage of local filesystem details in normal errors.
- **Canonical 5 MB gate unchanged (SC8):** `scripts/build-canonical-bundle.ts`
  SC6 `maxSizeBytes = 5 * 1024 * 1024` is unmodified; the bundle reports 2.2 MB
  PASS. Browser assets are measured separately: the Vite build writes to
  `build/web/` (never into `px.mjs`, never counted against the 5 MB gate). The
  production JS bundle is ~238 kB (73 kB gzip) — reported, not hidden.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Published artifact launches web UI from shipped files only | `test/web-package-smoke.integration.test.ts` "the packaged tarball serves the shell from built assets without src, CDN, or a dev server" | PASS |
| Served HTML zero CDN refs, no inline script; session dies with process | `test/web-package-smoke.integration.test.ts` "the per-launch session is unavailable after the process exits" | PASS |
| Browser bundle audit: no Node built-ins/adapters/shell APIs | `test/web-board-render.test.ts` "production browser code imports no Node built-in, concrete adapter, or server module" | PASS |
| Canonical 5 MB gate untouched; browser size separate | `scripts/build-canonical-bundle.ts` `maxSizeBytes = 5 * 1024 * 1024`; `npm run test:bundle` | PASS |

## Next action: commit CP-6, then CP-7 `px ui` cutover + TUI fallback.
