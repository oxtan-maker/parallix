/**
 * web.ts — the `px web` command: start the loopback-only local web host.
 *
 * The host runs in this process (ADR 0054). The command only binds, prints
 * the actual loopback URL, and shuts the host down on SIGINT/SIGTERM. It
 * never touches the repository, which is why it is a read-only command.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { createWebHost, type WebAssets } from '../web/host.js';
import type { LoopbackLiteral } from '../web/security.js';

export interface WebCliOptions {
  host?: LoopbackLiteral;
  port?: number;
  /** Integrity-verified packaged browser assets, resolved by composition. */
  assets?: WebAssets;
}

export function parseWebCliRequest(args: string[]): WebCliOptions {
  const options: WebCliOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--host') {
      const value = args[i + 1];
      if (value === undefined) { throw new Error('--host requires a value (127.0.0.1 or ::1)'); }
      options.host = value as LoopbackLiteral;
      i += 1;
    } else if (arg === '--port') {
      const value = args[i + 1];
      if (value === undefined) { throw new Error('--port requires a value'); }
      options.port = Number(value);
      i += 1;
    } else {
      throw new Error(`Unknown web option: ${arg} (supported: --host, --port)`);
    }
  }
  return options;
}

export async function runWebCommand(args: string[] = [], cli: WebCliOptions = {}): Promise<void> {
  const log = fmt.log.plain;
  if (!cli.assets) {
    throw new Error('web command requires loaded web assets (wired by composition)');
  }
  const options = parseWebCliRequest(args);
  const host = createWebHost({ ...options, assets: cli.assets });
  let info;
  try {
    info = await host.start();
  } catch (err) {
    await host.close();
    throw err;
  }
  log(`[web] loopback-only host listening on ${info.origin}/ (Ctrl+C to stop)`);
  await new Promise<void>(resolve => {
    const stop = (): void => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await host.close();
  log('[web] host stopped');
}
