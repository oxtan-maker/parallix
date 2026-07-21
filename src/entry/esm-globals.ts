import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Transitional compatibility for legacy modules that still use Node's CJS
// location globals. The canonical bundle defines equivalent values in its
// banner; source execution preloads them before application modules evaluate.
const filename = fileURLToPath(import.meta.url);
Object.assign(globalThis, {
  __filename: filename,
  __dirname: path.dirname(filename),
});
