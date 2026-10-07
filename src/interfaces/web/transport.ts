/**
 * transport.ts — the versioned, JSON-safe wire contract between the local
 * web host (ADR 0054) and a future browser client (ADR 0055).
 *
 * This module is the board-to-browser boundary. It projects existing
 * application read models — `BoardProjection`, mission activity, action
 * availability, and typed command outcomes — into plain-data DTOs and
 * validates parsed payloads. It is pure: no node builtins, no network, no
 * React, no filesystem. Every special value that raw `JSON.stringify` would
 * collapse (`Infinity`, `undefined`, `Error`, `Set`, `Map`, `BigInt`,
 * non-finite numbers) is either encoded explicitly or rejected fail-closed.
 *
 * The wire vocabulary distinguishes what the domain distinguishes:
 *   - an indefinite agent block is a tagged `indefinite` duration, never `null`
 *   - `runningSessions` keeps four states: omitted (no probe), `null`
 *     (liveness not observed), `0` (observed none), `n` (observed n)
 *   - mission work keeps live / unknown / stale / blocked / idle
 *   - an action is `enabled`, `ineligible` (lane/lifecycle), or
 *     `unavailable` (capability not integrated) — the server decides, the
 *     client never evaluates the capability registry or lane rules
 *   - optional means omitted, nullable means `null`; the two never collapse
 *
 * The exact HTTP response shape is owned by the transport mission; this
 * contract only defines the payload and its validated states.
 */


export { WEB_TRANSPORT_VERSION, SUPPORTED_WEB_TRANSPORT_VERSIONS, isInvalidWebCommandRequest, WebTransportError } from './transport-types.js';
export type { WebTransportVersion, WebBoardLane, WebBoardCommandKind, WebCommandActionState, WebGateState, WebWorkCertainty, WebAttentionReasonKind, WebTerminalStatus, WebErrorKind, WebEvidenceSource, WebDurationMs, WebMissionWork, WebCoordinatorEvidence, WebMissionActivity, WebCommandAction, WebPullRequestReference, WebReviewRoundSummary, WebGoalCheckRow, WebCheckpointEvidence, WebMissionCard, WebStage, WebAttentionItem, WebOperationLogEntry, WebAgentAvailability, WebSourceFact, WebBoardMetrics, WebBoardSnapshot, WebCommandError, WebCommandResult, WebProgressEvent, WebCommandRequestKind, WebHandoffArtifact, WebHandoffPayload, WebCommandRequest, WebCommandRequestValidation, WebTransportErrorCode } from './transport-types.js';
export { BOARD_COMMAND_KINDS, toWebBoardSnapshot, toWebCommandResult, toWebProgressEvent } from './transport-projection.js';
export type { WebTransportValidation } from './transport-validation-primitives.js';
export { validateWebBoardSnapshot, validateWebCommandResult, validateWebCommandRequest, validateWebProgressEvent } from './transport-validators.js';
/**
 * transport.ts — the versioned, JSON-safe wire contract between the local
 * web host (ADR 0054) and a future browser client (ADR 0055).
 *
 * This module is the board-to-browser boundary. It projects existing
 * application read models — `BoardProjection`, mission activity, action
 * availability, and typed command outcomes — into plain-data DTOs and
 * validates parsed payloads. It is pure: no node builtins, no network, no
 * React, no filesystem. Every special value that raw `JSON.stringify` would
 * collapse (`Infinity`, `undefined`, `Error`, `Set`, `Map`, `BigInt`,
 * non-finite numbers) is either encoded explicitly or rejected fail-closed.
 *
 * The wire vocabulary distinguishes what the domain distinguishes:
 *   - an indefinite agent block is a tagged `indefinite` duration, never `null`
 *   - `runningSessions` keeps four states: omitted (no probe), `null`
 *     (liveness not observed), `0` (observed none), `n` (observed n)
 *   - mission work keeps live / unknown / stale / blocked / idle
 *   - an action is `enabled`, `ineligible` (lane/lifecycle), or
 *     `unavailable` (capability not integrated) — the server decides, the
 *     client never evaluates the capability registry or lane rules
 *   - optional means omitted, nullable means `null`; the two never collapse
 *
 * The exact HTTP response shape is owned by the transport mission; this
 * contract only defines the payload and its validated states.
 */

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

