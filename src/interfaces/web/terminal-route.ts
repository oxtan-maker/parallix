/** GET-only route that projects a selected board card to terminal output. */
import type { FastifyInstance } from 'fastify';
import type { BoardProjection } from '../../application/projections/board.js';

export const WEB_TERMINAL_PATH = '/api/terminal/:missionId';

export type WebTerminalOutput =
  | { readonly kind: 'live'; readonly output: string }
  | { readonly kind: 'captured'; readonly output: string; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string };

/** Composition-owned read port; this web adapter has no terminal dependency. */
export interface WebTerminalReader { read(_missionId: string): WebTerminalOutput; }

export function registerTerminalRoute(app: FastifyInstance, options: {
  buildProjection?: () => Promise<BoardProjection>;
  terminalReader?: WebTerminalReader;
}): void {
  app.get(WEB_TERMINAL_PATH, async (request, reply) => {
    const build = options.buildProjection;
    const missionId = (request.params as { missionId?: string }).missionId;
    if (build === undefined || missionId === undefined) {
      return reply.code(503).send({ kind: 'unavailable', message: 'Mission terminal is unavailable.' } satisfies WebTerminalOutput);
    }
    try {
      const projection = await build();
      const exists = projection.stages.some(stage => stage.cards.some(card => card.id === missionId));
      if (!exists) { return reply.code(404).send({ kind: 'unavailable', message: 'Mission is not on the board.' } satisfies WebTerminalOutput); }
      const terminal = options.terminalReader?.read(missionId)
        ?? { kind: 'unavailable', message: 'Mission terminal is unavailable.' } as const;
      return reply.code(terminal.kind === 'unavailable' ? 404 : 200).type('application/json; charset=utf-8').send(terminal);
    } catch {
      return reply.code(503).send({ kind: 'unavailable', message: 'Mission terminal is unavailable.' } satisfies WebTerminalOutput);
    }
  });
}
