import type { BoardProgressSink } from './controller/board-command.js';
import type { BoardCommandDispatcher } from './controller/board-command.js';
import type { BoardProjectionBuilder } from './projections/board-readers.js';
import type { MissionProjectionQuery } from './projections/mission-query.js';

/** Application-owned capabilities supplied by production composition to the TUI. */
export interface TuiCapabilities {
  readonly boardProjection: BoardProjectionBuilder;
  readonly missionDetails: MissionProjectionQuery;
  /** Returns the single shared dispatcher; progress arg accepted for API compat. */
  readonly commandControllerFactory: (_progress: BoardProgressSink) => BoardCommandDispatcher;
  /** The single shared controller instance (CLI and TUI both use this). */
  readonly commandController: BoardCommandDispatcher;
}
