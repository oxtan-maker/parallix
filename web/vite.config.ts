import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The browser shell is a separate, self-contained artifact: Vite builds it
// from web/ into build/web/ (never into px.mjs, never counted against the
// 5 MB canonical-bundle stop rule). No plugin-react: the production build
// needs esbuild JSX transform only, no HMR. The host serves the output from
// a manifest allowlist, so the build must stay dependency-free of CDNs and
// external fonts/scripts (ADR 0054).
const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: webRoot,
  base: '/',
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: path.resolve(webRoot, '..', 'build', 'web'),
    emptyOutDir: true,
    target: 'es2022',
    // No source maps in the shipped artifact: the shell is tiny, and maps
    // would add files the serving manifest would have to allowlist.
    sourcemap: false,
  },
  server: {
    // Development only: the production host is Fastify inside px (ADR 0054).
    host: '127.0.0.1',
  },
});
