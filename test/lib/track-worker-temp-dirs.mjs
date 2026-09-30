import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

let installed = false;

export function trackWorkerTempDirs(register) {
  if (installed) { return; }
  installed = true;
  const create = fs.mkdtempSync;
  fs.mkdtempSync = function trackedMkdtempSync(...args) {
    const dir = create.apply(this, args);
    if (typeof dir === 'string') { register(dir); }
    return dir;
  };
  syncBuiltinESMExports();
}
