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
const frameDir = mkdtempSync(join(tmpdir(), 'parallix-demo-'));

const COLUMNS = 100;
const ROWS = 24;
const BACKGROUND = '#101418';
const DEFAULT_FG = '#e6edf3';
const FONT_SIZE = 15;
const WIDTH = 960;
const HEIGHT = 520;
// ImageMagick renders SVG with its own MSVG renderer, which ignores
// `font-family` outright — every frame came out in a proportional face, so
// column arithmetic could not line up. Frames are drawn with ImageMagick's text
// primitives instead, which honour `-font`. The advance is measured rather than
// derived from the font's metrics so the columns stay exact if the font changes.
const FONT = 'DejaVu-Sans-Mono';
const CHAR_WIDTH = measureAdvance();
const LINE_HEIGHT = 20;
const MARGIN_X = 28;
const MARGIN_Y = 42;
const BOLD_PALETTE = {
  '#484f58': '#8b949e', '#ff7b72': '#ffa198', '#3fb950': '#56d364', '#d29922': '#e3b341',
  '#58a6ff': '#79c0ff', '#bc8cff': '#d2a8ff', '#39c5cf': '#56d4dd', '#b1bac4': '#e6edf3',
  '#8b949e': '#b1bac4'
};
// The cast is a real terminal session and `px` colour-codes its own output, so
// the render keeps the SGR foreground colours instead of flattening them.
const PALETTE = {
  30: '#484f58', 31: '#ff7b72', 32: '#3fb950', 33: '#d29922',
  34: '#58a6ff', 35: '#bc8cff', 36: '#39c5cf', 37: '#b1bac4',
  90: '#8b949e', 91: '#ffa198', 92: '#56d364', 93: '#e3b341',
  94: '#79c0ff', 95: '#d2a8ff', 96: '#56d4dd', 97: '#e6edf3'
};

// Width of one glyph: the difference between a 200- and a 100-glyph label, so
// the label's own padding cancels out.
function measureAdvance() {
  const width = (count) => Number(execFileSync('convert', [
    '-font', FONT, '-pointsize', String(FONT_SIZE), `label:${'M'.repeat(count)}`, '-format', '%w', 'info:'
  ], { encoding: 'utf8' }).trim());
  return (width(200) - width(100)) / 100;
}

// The virtual screen: one array of {text, color, bold} cells per line.
let screen = [[]];
let pen = { color: DEFAULT_FG, bold: false };

try {
  const output = events.filter(([, type]) => type === 'o');
  // One frame per ~0.35s of cast time, plus a frame at every command boundary
  // and at every event the retimer decided to hold on — otherwise the frame a
  // viewer is meant to read is merged into the next one. 800+ raw events would
  // render a GIF nobody waits through.
  let lastFrameAt = -Infinity;
  for (let index = 0; index < output.length; index += 1) {
    const [at, , text] = output[index];
    write(text);
    const boundary = text.includes('\n$ ');
    const last = index === output.length - 1;
    const held = output[index + 1] ? output[index + 1][0] - at >= 0.8 : true;
    if (!boundary && !last && !held && at - lastFrameAt < 0.35) { continue; }
    lastFrameAt = at;
    const frame = join(frameDir, `frame-${String(frames.length).padStart(3, '0')}.png`);
    execFileSync('convert', renderArgs(frame));
    frames.push({ at, frame, hold: last });
  }
  // Hold on the frames a viewer actually reads: mission contract, diff, result.
  const timed = frames.map(({ at, frame, hold }, index) => {
    const gap = frames[index + 1] ? frames[index + 1].at - at : 3;
    return { frame, delay: hold ? 4 : Math.max(0.1, Math.min(gap, 4)) };
  });
  execFileSync('convert', ['-loop', '0', ...timed.flatMap(({ delay, frame }) => ['-delay', String(Math.round(delay * 100)), frame]), '+dither', '-colors', '64', '-layers', 'optimize', gifPath]);
} finally {
  rmSync(frameDir, { recursive: true, force: true });
}

// Feed one cast chunk to the virtual screen: SGR sequences move the pen, every
// other escape sequence is dropped, and the text between them lands on screen.
function write(chunk) {
  const escape = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B[[\]()#;?]*[0-9;?]*[ -/]*[@-~]/g;
  let cursor = 0;
  let match;
  while ((match = escape.exec(chunk)) !== null) {
    put(chunk.slice(cursor, match.index));
    const sgr = /^\u001B\[([0-9;]*)m$/.exec(match[0]);
    if (sgr) { movePen(sgr[1]); }
    cursor = escape.lastIndex;
  }
  put(chunk.slice(cursor));
}

function movePen(params) {
  for (const raw of (params || '0').split(';')) {
    const code = Number(raw || '0');
    if (code === 0) { pen = { color: DEFAULT_FG, bold: false }; }
    else if (code === 1) { pen = { ...pen, bold: true }; }
    else if (code === 22) { pen = { ...pen, bold: false }; }
    else if (code === 39) { pen = { ...pen, color: DEFAULT_FG }; }
    else if (PALETTE[code]) { pen = { ...pen, color: PALETTE[code] }; }
  }
}

// A carriage return rewrites the current line — that is how every spinner and
// progress counter in the cast redraws itself. The pty terminates lines with
// CRLF, where the carriage return ends the line rather than rewriting it.
function put(text) {
  const printable = text
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  for (const char of printable) {
    if (char === '\n') { screen.push([]); continue; }
    if (char === '\r') { screen[screen.length - 1] = []; continue; }
    const line = screen[screen.length - 1];
    const tail = line[line.length - 1];
    if (tail && tail.color === pen.color && tail.bold === pen.bold) { tail.text += char; }
    else { line.push({ text: char, color: pen.color, bold: pen.bold }); }
  }
  screen = screen.slice(-(ROWS * 4));
}

function renderArgs(frame) {
  // The pty wraps at 100 columns without emitting newlines; do the same here.
  const lines = screen.flatMap(wrap).slice(-ROWS);
  const draws = lines.flatMap((line, row) => {
    let column = 0;
    return line.flatMap(({ text, color, bold }) => {
      const x = (MARGIN_X + column * CHAR_WIDTH).toFixed(1);
      column += text.length;
      if (text.trim() === '') { return []; }
      const y = MARGIN_Y + row * LINE_HEIGHT;
      return ['-fill', bold ? brighten(color) : color, '-draw', `text ${x},${y} '${escapeMvg(text)}'`];
    });
  });
  return [
    '-size', `${WIDTH}x${HEIGHT}`, `xc:${BACKGROUND}`,
    '-font', FONT, '-pointsize', String(FONT_SIZE),
    ...draws, frame
  ];
}

function escapeMvg(text) {
  return text.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

// Bold is rendered as a brighter foreground rather than a bold face: MSVG
// synthesizes bold at a different advance than the regular face, which breaks
// the monospaced column arithmetic every span position depends on.
function brighten(color) {
  return color === DEFAULT_FG ? '#ffffff' : BOLD_PALETTE[color] || color;
}

function wrap(line) {
  const wrapped = [[]];
  let width = 0;
  for (const cell of line) {
    for (const char of cell.text) {
      if (width === COLUMNS) { wrapped.push([]); width = 0; }
      const current = wrapped[wrapped.length - 1];
      const tail = current[current.length - 1];
      if (tail && tail.color === cell.color && tail.bold === cell.bold) { tail.text += char; }
      else { current.push({ text: char, color: cell.color, bold: cell.bold }); }
      width += 1;
    }
  }
  return wrapped;
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
