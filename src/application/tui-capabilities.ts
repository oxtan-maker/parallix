import type { BoardProgressSink } from './controller/board-command.js';
import type { BoardCommandDispatcher } from './controller/board-command.js';
import type { BoardProjectionBuilder } from './projections/board-readers.js';
import type { MissionProjectionQuery } from './projections/mission-query.js';

/** Application-owned capabilities supplied by production composition to the TUI. */
export interface TuiCapabilities {
  readonly boardProjection: BoardProjectionBuilder;
  readonly missionDetails: MissionProjectionQuery;
  readonly commandControllerFactory: (_progress: BoardProgressSink) => BoardCommandDispatcher;
}
