/**
 * Bounce-prompt output elision (TASK-2369.13 CP-3).
 *
 * Gate and hook failures can produce very large diagnostic output (a full
 * test suite plus a build can exceed 500 KB, ~130k tokens). Auto-bounce
 * prompts embed that output verbatim into the resumed agent session, which
 * can push the session past the model's context window. Pi then clamps
 * max_tokens to 1 for every subsequent turn, silently stranding the mission.
 *
 * Elide to a bounded head+tail: the head keeps the command context, the tail
 * keeps the actual failure (errors land at the end). Classification still
 * runs on the untruncated output; only the prompt embedding is elided.
 */

/** Hard cap for gate/hook output embedded in an agent bounce prompt (32 KB). */
export const BOUNCE_OUTPUT_MAX_CHARS = 32_768;

/** Head portion kept (command/context lines). */
export const BOUNCE_OUTPUT_HEAD_CHARS = 4_096;

/**
 * Elide oversized output to head+tail with an elision marker.
 * Output at or under `maxChars` is returned unchanged.
 */
export function elideBounceOutput(output: string, maxChars: number = BOUNCE_OUTPUT_MAX_CHARS): string {
  if (output.length <= maxChars) {
    return output;
  }
  const tailChars = maxChars - BOUNCE_OUTPUT_HEAD_CHARS;
  const elidedChars = output.length - BOUNCE_OUTPUT_HEAD_CHARS - tailChars;
  return [
    output.slice(0, BOUNCE_OUTPUT_HEAD_CHARS),
    '',
    `[... ${elidedChars} chars elided - gate output truncated to fit agent context ...]`,
    '',
    output.slice(-tailChars),
  ].join('\n');
}
