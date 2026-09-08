#!/usr/bin/env node
// Renders the checked-in asciicast to a small GIF using only Node and ImageMagick.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const castPath = join(root, 'docs/assets/first-value-demo.cast');
const gifPath = join(root, 'docs/assets/first-value-demo.gif');
const [, ...events] = readFileSync(castPath, 'utf8').trim().split('\n').map(JSON.parse);
const frames = [];
let screen = '';
const frameDir = mkdtempSync(join(tmpdir(), 'parallix-demo-'));

try {
  const output = events.filter(([, type]) => type === 'o');
  // One frame per ~0.35s of cast time, plus a frame at every command boundary
  // and at every event the retimer decided to hold on — otherwise the frame a
  // viewer is meant to read is merged into the next one. 800+ raw events would
  // render a GIF nobody waits through.
  let lastFrameAt = -Infinity;
  for (let index = 0; index < output.length; index += 1) {
    const [at, , text] = output[index];
    screen += strip(text);
    const boundary = text.includes('\n$ ');
    const last = index === output.length - 1;
    const held = output[index + 1] ? output[index + 1][0] - at >= 0.8 : true;
    if (!boundary && !last && !held && at - lastFrameAt < 0.35) { continue; }
    lastFrameAt = at;
    const frame = join(frameDir, `frame-${String(frames.length).padStart(3, '0')}.png`);
    // The pty wraps at 100 columns without emitting newlines; do the same here.
    const lines = screen.split('\n').flatMap(wrap).slice(-24).map(escapeXml);
    const spans = lines.map((line, index) => `<tspan x="28" dy="${index ? 20 : 0}">${line}</tspan>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="520"><rect width="100%" height="100%" fill="#101418"/><text x="28" y="42" fill="#e6edf3" font-family="DejaVu Sans Mono,monospace" font-size="15">${spans}</text></svg>`;
    const svgPath = `${frame}.svg`;
    writeFileSync(svgPath, svg);
    execFileSync('convert', [svgPath, frame]);
    frames.push({ at, frame, hold: last });
  }
  // Hold on the frames a viewer actually reads: mission contract, diff, result.
  const timed = frames.map(({ at, frame, hold }, index) => {
    const gap = frames[index + 1] ? frames[index + 1].at - at : 3;
    return { frame, delay: hold ? 4 : Math.max(0.1, Math.min(gap, 4)) };
  });
  execFileSync('convert', ['-loop', '0', ...timed.flatMap(({ delay, frame }) => ['-delay', String(Math.round(delay * 100)), frame]), '+dither', '-colors', '16', '-layers', 'optimize', gifPath]);
} finally {
  rmSync(frameDir, { recursive: true, force: true });
}

// The cast is a real terminal session: drop ANSI colour/cursor control so the
// SVG text stays valid XML.
function strip(text) {
  return text
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B[[\]()#;?]*[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
}

function wrap(line) {
  return line.match(/.{1,100}/g) ?? [''];
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
