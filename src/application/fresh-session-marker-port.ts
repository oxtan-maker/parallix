import type { SessionMarkerPort } from './domain-ports.js';

/**
 * The session-marker port for a deliberately fresh, ephemeral launch.
 *
 * This is ADR 0059's fresh-context semantic: do not read a resumable
 * transcript and do not replace the durable normal-session marker.
 */
export const FRESH_SESSION_MARKER_PORT: SessionMarkerPort = {
  find: async () => null,
  save: async () => {},
  delete: async () => {},
  shouldResume: async () => false,
};
