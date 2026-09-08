#!/usr/bin/env node
// Re-times docs/assets/first-value-demo.cast for playback. The recording keeps
// the real wall clock; this pass decides how long each moment stays on screen:
// the operator beats (typing, the mission contract, agent selection and
// fallbacks, the review outcome, the diff, the result) get seconds, while the
// agent token streams are skimmed.
import { readFileSync, writeFileSync } from 'node:fs';

const castPath = new URL('../docs/assets/first-value-demo.cast', import.meta.url).pathname;
const [header, ...lines] = readFileSync(castPath, 'utf8').trim().split('\n');
const events = lines.map(line => JSON.parse(line));

const ANSI = /\][^]*(?:|\\)|[[\]()#;?]*[0-9;?]*[ -/]*[@-~]/g;
const plain = text => text.replace(ANSI, '');

// Drop the shell teardown: typing `exit` is how the recording stops, not part
// of the demo, and it must not steal the final hold from the integration
// result. Everything after the last substantial output line goes.
const lastOutput = events.findLastIndex(([, , text]) => plain(text).trim().length >= 10);
if (lastOutput >= 0) { events.length = lastOutput + 1; }

// Classify every event once. A keystroke only counts as one inside a typing
// run — shell prints its prompt, driver types, the line ends — because short
// chunks of agent output look identical in isolation.
const KEYSTROKE = 'keystroke';
const PROMPT = 'prompt';
const kinds = events.map(() => '');
let typing = false;
events.forEach(([, , text], index) => {
  const body = plain(text);
  if (typing) {
    if (body.includes('\n')) { typing = false; return; }
    kinds[index] = KEYSTROKE;
    return;
  }
  if (/\$ $/.test(body)) {
    kinds[index] = PROMPT;
    typing = true;
  }
});
// The screen the operator was reading when they decided to type the next
// command: the mission contract before `px active`, the diff before
// `px integrate`. Walk back past terminal noise to the last real output.
const dwell = events.map(() => false);
kinds.forEach((kind, index) => {
  if (kind !== PROMPT) { return; }
  for (let back = index - 1; back >= 0; back -= 1) {
    if (kinds[back]) { return; }
    if (plain(events[back][2]).trim().length > 3) { dwell[back] = true; return; }
  }
});

/** Seconds this event stays on screen. */
function hold(text, index) {
  if (index === events.length - 1) { return 4; }
  if (kinds[index] === KEYSTROKE) { return 0.06; }
  if (kinds[index] === PROMPT) { return 0.4; }
  if (dwell[index]) { return 4; }
  if (/^# Mission:|^## (Goal|Success Criteria|Checkpoints)/m.test(text)) { return 3; }
  if (/Integration completed successfully/.test(text)) { return 4; }
  if (/reviewer outcome =|Autonomous review stopped|reviewer approved/.test(text)) { return 1.5; }
  if (/Limit hit|fell back|blocked|\(attempt \d\)|safety harness|rolling task state back/.test(text)) { return 1.5; }
  if (/Selected agent for step/.test(text)) { return 1.2; }
  if (/^diff --git|^[+-]{1,3} /m.test(text)) { return 0.2; }             // diff under review
  if (/\[(PASS|INFO|WARN|FAIL)\]|^Step \d/m.test(text)) { return 0.03; } // harness log
  return 0.008;                                                         // agent stream
}

// A cast timestamp is when an event is written, so an event's own hold is the
// gap before the NEXT one: accumulate after emitting, not before.
let at = 0;
const retimed = events.map(([, kind, text], index) => {
  const line = JSON.stringify([Number(at.toFixed(3)), kind, text]);
  at += hold(plain(text), index);
  return line;
});
writeFileSync(castPath, [header, ...retimed].join('\n') + '\n');
console.log(`retimed ${events.length} events to ${at.toFixed(1)}s`);
