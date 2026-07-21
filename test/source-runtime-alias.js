'use strict';

// TASK-2279 keeps existing tests hermetic while their historical dist/ import
// spelling is retired. Test-only CommonJS modules live outside dist/ so a
// concurrent production rebuild cannot replace their writable exports.
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const testRuntimeRoot = path.join(root, '.test-runtime');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function sourceRuntimeAlias(request, parent, isMain, options) {
  if (request === '../dist/index') {
    return originalResolveFilename.call(this, path.join(root, 'src', 'platform', 'runtime', 'index'), parent, isMain, options);
  }
  if (typeof request === 'string' && (request.startsWith('../dist/lib/') || request.startsWith('../dist/assets/'))) {
    const relative = request.slice('../dist/'.length);
    return originalResolveFilename.call(this, path.join(testRuntimeRoot, relative), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
