/**
 * web.ts — the `px web` command: start the loopback-only local web host.
 *
 * The host runs in this process (ADR 0054). The command only binds, prints
 * the actual loopback URL, and shuts the host down on SIGINT/SIGTERM. It
 * never touches the repository, which is why it is a read-only command.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import type { BoardProjection } from '../../application/projections/board.js';
import type {
  BoardCommandDispatcher,
  BoardProgressSink,
} from '../../application/controller/board-command.js';
import { createWebHost, type WebAssets, type WebHostInfo } from '../web/host.js';
import type { LoopbackLiteral } from '../web/security.js';

/**
 * The board source the host serves: an injected build port (the production
 * `BoardProjectionBuilder` closure from composition, never an adapter the web
 * layer constructs itself) plus a closer for the services backing it.
 */
export interface WebBoardSource {
  readonly buildProjection: () => Promise<BoardProjection>;
  /**
   * The guarded board command dispatcher the mutation route dispatches
   * through; absent or `null` when the source has no Mission authority and
   * the host stays read-only.
   */
  readonly commandDispatcher?: BoardCommandDispatcher | null;
  /** Releases the services behind the source; runs when the host shuts down. */
  readonly close: () => Promise<void>;
}

export interface WebCliOptions {
  host?: LoopbackLiteral;
  port?: number;
  /** Integrity-verified packaged browser assets, resolved by composition. */
  assets?: WebAssets;
  /**
   * Composition seam: receives the host's progress sink so command-boundary
   * progress lands on the SSE stream, and returns the board build port plus
   * the closer for the services it opened.
   */
  createBoardSource?: (_progress: BoardProgressSink) => Promise<WebBoardSource>;
  /** Stop seam; tests resolve it directly instead of signalling the process. */
  waitForStop?: () => Promise<void>;
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

export async function runWebCommand(args: string[] = [], cli: WebCliOptions = {}): Promise<WebHostInfo> {
  const log = fmt.log.plain;
  if (!cli.assets) {
    throw new Error('web command requires loaded web assets (wired by composition)');
  }
  const options = parseWebCliRequest(args);
  // The board source and the host reference each other: the source needs the
  // host's progress sink, the host needs the source's build port. Resolve the
  // source before start(); the injected closure below reads it at call time,
  // and the first build only happens after it is set.
  let source: WebBoardSource | null = null;
  const host = createWebHost({
    ...options,
    assets: cli.assets,
    buildProjection: cli.createBoardSource
      ? () => source === null
        ? Promise.reject(new Error('web board source is not ready'))
        : source.buildProjection()
      : undefined,
    commandDispatcher: cli.createBoardSource
      ? () => (source === null ? null : source.commandDispatcher ?? null)
      : undefined,
  });
  let info: WebHostInfo;
  try {
    if (cli.createBoardSource) {
      source = await cli.createBoardSource(host.progress);
    }
    try {
      info = await host.start();
    } catch (err) {
      await host.close();
      throw err;
    }
    log(`[web] loopback-only host listening on ${info.origin}/ (Ctrl+C to stop)`);
    const stopped: Promise<void> = cli.waitForStop
      ? cli.waitForStop()
      : new Promise<void>(resolve => {
        const stop = (): void => {
          process.removeListener('SIGINT', stop);
          process.removeListener('SIGTERM', stop);
          resolve();
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
    await stopped;
    await host.close();
    log('[web] host stopped');
    return info;
  } finally {
    await source?.close();
  }
}
