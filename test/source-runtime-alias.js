'use strict';

// TASK-2279 keeps existing tests hermetic while their historical dist/ import
// spelling is retired. Test-only CommonJS modules live outside dist/ so a
// concurrent production rebuild cannot replace their writable exports.
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const testRuntimeRoot = path.join(root, '.test-runtime');
const originalResolveFilename = Module._resolveFilename;

function resolveTestRuntimeTarget(targetPath) {
  for (const candidate of [targetPath, `${targetPath}.js`, path.join(targetPath, 'index.js')]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return targetPath;
}

Module._resolveFilename = function sourceRuntimeAlias(request, parent, isMain, options) {
  if (request === '../dist/index') {
    return originalResolveFilename.call(this, path.join(root, 'src', 'platform', 'runtime', 'index'), parent, isMain, options);
  }
  if (typeof request === 'string' && (request.startsWith('../dist/lib/') || request.startsWith('../dist/assets/') || request.startsWith('../dist/application/'))) {
    const relative = request.slice('../dist/'.length);
    return originalResolveFilename.call(this, resolveTestRuntimeTarget(path.join(testRuntimeRoot, relative)), parent, isMain, options);
  }
  // Cross-tree relative imports from .test-runtime/lib/ and dist/lib/ that
  // escape the lib/ subtree (e.g., '../../../../application/contracts.js')
  // resolve outside their tree because both are shallower than the source tree.
  // Remap those to <tree-root>/<module-path> so they find the emitted files.
  if (typeof request === 'string' && request.startsWith('.') && parent && typeof parent.filename === 'string') {
    const distLibPrefix = root + path.sep + 'dist' + path.sep + 'lib' + path.sep;
    const treeRoot = parent.filename.startsWith(testRuntimeRoot + path.sep + 'lib' + path.sep)
      ? testRuntimeRoot
      : parent.filename.startsWith(distLibPrefix)
        ? path.join(root, 'dist')
        : null;
    if (treeRoot) {
      const resolved = path.resolve(path.dirname(parent.filename), request);
      // If resolution escaped the tree root, extract the module path suffix
      // (the part after the '..' traversal beyond the tree) and remap.
      if (!resolved.startsWith(treeRoot)) {
        const suffix = request.replace(/^\.\.([/\\])?/, '').replace(/^\.\.([/\\])?/, '').replace(/^\.\.([/\\])?/, '').replace(/^\.\.([/\\])?/, '');
        const remapped = resolveTestRuntimeTarget(path.join(treeRoot, suffix));
        if (fs.existsSync(remapped)) {
          return remapped;
        }
      }
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
