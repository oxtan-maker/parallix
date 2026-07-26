// Build-time stub for `react-devtools-core`.
//
// Ink imports this package from `ink/build/devtools.js`, which it loads only
// when the DEV environment variable is set. px is a single-file bundle and
// never ships a devtools bridge, so the real package is aliased to these
// no-ops rather than being bundled (it pulls in `ws` and a websocket client)
// or left external (esbuild would hoist it to a top-level import that fails
// to resolve at startup).
const devtools = {
  initialize() {},
  connectToDevTools() {},
};

export default devtools;
