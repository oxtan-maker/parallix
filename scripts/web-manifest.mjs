// Writes build/web/manifest.json from the files already present in the web
// output directory. This is the single source of truth for the manifest so
// that both the canonical bundle build (scripts/build-canonical-bundle.ts) and
// the standalone `npm run build:web` leave build/ internally consistent: the
// manifest lists exactly the assets the build produced. Without this, a bare
// build:web (which runs with vite emptyOutDir) leaves build/web/manifest.json
// absent while build/manifest.sha256 still lists it, which fails the
// task-2285 checksum-manifest contract test.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Keep this in sync with WEB_CONTENT_TYPES in build-canonical-bundle.ts. The
// manifest records a content type per asset so the host can serve it correctly.
export const WEB_CONTENT_TYPES = [
  [/\.html?$/, 'text/html; charset=utf-8'],
  [/\.m?js$/, 'text/javascript'],
  [/\.css$/, 'text/css'],
  [/\.map$/, 'application/json'],
  [/\.svg$/, 'image/svg+xml'],
  [/\.png$/, 'image/png'],
  [/\.ico$/, 'image/x-icon'],
  [/\.woff2$/, 'font/woff2'],
];

function webContentType(file) {
  for (const [pattern, type] of WEB_CONTENT_TYPES) {
    if (pattern.test(file)) return type;
  }
  return 'application/octet-stream';
}

function collectWebFiles(dir, relative = '') {
  return fs.readdirSync(path.join(dir, relative), { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? path.posix.join(relative, entry.name) : entry.name;
    return entry.isDirectory() ? collectWebFiles(dir, child) : [child];
  });
}

// build/web/manifest.json must not list itself: writing it changes its own
// bytes, so its recorded digest would never match the on-disk file.
function assetFiles(webDir) {
  const files = {};
  for (const relativeFile of collectWebFiles(webDir).sort()) {
    if (relativeFile === 'manifest.json') continue;
    const contents = fs.readFileSync(path.join(webDir, relativeFile));
    files[relativeFile] = {
      size: contents.length,
      sha256: crypto.createHash('sha256').update(contents).digest('hex'),
      contentType: webContentType(relativeFile),
    };
  }
  return files;
}

export function writeWebManifest(webDir) {
  const webFiles = assetFiles(webDir);
  fs.writeFileSync(path.join(webDir, 'manifest.json'), `${JSON.stringify({ version: 1, files: webFiles }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const webDir = process.argv[2] || path.resolve('build/web');
  writeWebManifest(webDir);
}
