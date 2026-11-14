import test from 'node:test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadWebAssets } from '../../../src/adapters/web/asset-store.js';
import {
  createWebHost,
  type WebAssets,
  type WebHost,
  type WebHostInfo,
  type WebHostOptions,
} from '../../../src/interfaces/web/host.js';

export let assets: WebAssets;
let assetDir: string;

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

test.before(() => {
  assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-web-host-'));
  const assetsDir = path.join(assetDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const html = '<!doctype html><html><head><title>shell</title>'
    + '<script type="module" src="/assets/app.js"></script></head>'
    + '<body><div id="root"></div></body></html>';
  const js = 'console.log("web shell");\n';
  const secret = 'secret-not-in-manifest';
  fs.writeFileSync(path.join(assetDir, 'index.html'), html);
  fs.writeFileSync(path.join(assetDir, 'assets', 'app.js'), js);
  fs.writeFileSync(path.join(assetDir, 'secret.txt'), secret);
  fs.writeFileSync(path.join(assetDir, 'manifest.json'), JSON.stringify({
    version: 1,
    files: {
      'index.html': { size: html.length, sha256: sha256(html), contentType: 'text/html; charset=utf-8' },
      'assets/app.js': { size: js.length, sha256: sha256(js), contentType: 'text/javascript' },
    },
  }, null, 2));
  assets = loadWebAssets(assetDir);
});

test.after(() => {
  fs.rmSync(assetDir, { recursive: true, force: true });
});

export async function withHost(
  options: Omit<WebHostOptions, 'assets'> = {},
  fn: (info: WebHostInfo, host: WebHost) => Promise<void>,
): Promise<void> {
  const host = createWebHost({ assets, ...options });
  const info = await host.start();
  try {
    await fn(info, host);
  } finally {
    await host.close();
  }
}

/**
 * A manual timer seam for the shared projection subscription: tests advance
 * the rebuild loop explicitly, so nothing here waits on a real clock.
 */
export function manualTimers() {
  let pending: { value: (() => void) | null } = { value: null };
  let sets = 0;
  let clears = 0;
  return {
    options: {
      intervalMs: 1,
      setTimer: (callback: () => void) => { sets += 1; pending.value = callback; return sets; },
      clearTimer: () => { clears += 1; pending.value = null; },
    },
    /** Fire the scheduled rebuild and drain the microtasks it queues. */
    async tick(): Promise<void> {
      const callback = pending.value;
      pending.value = null;
      callback?.();
      for (let i = 0; i < 8; i += 1) { await new Promise(resolve => setImmediate(resolve)); }
    },
    get scheduled(): boolean { return pending.value !== null; },
    get setCount(): number { return sets; },
    get clearCount(): number { return clears; },
  };
}
