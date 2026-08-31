// ---------------------------------------------------------------------------
// Blocked-agent countdown — display semantics
//
// The single source of truth for how a raw `blockedForMs` becomes the
// countdown text the board renders (`3d`, `5h 12m`, `45m`, `∞`, or nothing).
// `AgentStrip` renders from it, and the board refresh fingerprint compares it:
// the repaint decision must track what the operator actually sees, so a poll
// that moves the raw milliseconds while the label stays put must not repaint
// (task-2442).
// ---------------------------------------------------------------------------

/** Format a remaining-block duration in milliseconds into the exact string the board renders. */
export function formatCountdown(ms: number): string {
  if (ms === Infinity) { return '∞'; }
  if (ms === 0) { return ''; }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) { return `${minutes}m`; }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours < 24) {
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
