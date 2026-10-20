// web-font-bundle — the packaged-font contract for the loopback web board.
//
// TASK-2773.11: ADR 0054 keeps the browser shell self-contained, so the two
// faces the wave-2773 typography names (JetBrains Mono, Barlow Condensed) only
// render when the bundle carries them. These cases hold the three halves of
// that contract in one place: the served content security policy permits the
// same-origin fetch and nothing else changes, the stylesheet declares each face
// from a relative packaged path with an explicit unicode-range, and the type
// tokens keep a fallback stack for a glyph outside the subset or a font that
// fails to load. The real-socket half — the packaged host answering each font
// path as font/woff2 — is proven by
// test/integration/presentation/web-bundle-shell.integration.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PROTECTION_HEADERS } from '../../../../src/interfaces/web/host-request-policy.js';
import { DISPLAY, MONO } from '../../../../web/src/palette.js';

const FONT_ASSET_DIR = new URL('../../../../web/public/fonts/', import.meta.url);
const STYLE_SOURCE = new URL('../../../../web/src/style.css', import.meta.url);

/** Every `@font-face` block body in a stylesheet source. */
function fontFaceDeclarations(css: string): string[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(match => match[1]);
}

function urlTargets(decl: string): string[] {
  return [...decl.matchAll(/url\(\s*(['"]?)([^)'\"]+)\1\s*\)/g)].map(match => match[2]);
}

function familyOf(decl: string): string {
  return /font-family\s*:\s*['"]?([^;'\"]+)['"]?\s*;/.exec(decl)?.[1]?.trim() ?? '';
}

function stackFamilies(stack: string): string[] {
  return stack.split(',').map(entry => entry.trim().replace(/^['"]|['"]$/g, ''));
}

test('web font bundle: CSP allows same-origin bundled fonts and changes no other directive (TASK-2773.11)', () => {
  // One literal pins the whole policy: `font-src 'self'` is the only move from
  // the pre-wave policy, and every other directive stays exactly as written.
  assert.equal(PROTECTION_HEADERS['content-security-policy'],
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    + "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; "
    + "frame-ancestors 'none'; form-action 'self'");
});

test('web font bundle: the shell stylesheet declares each intended face from a relative packaged url (TASK-2773.11)', () => {
  const css = readFileSync(STYLE_SOURCE, 'utf8');
  const declarations = fontFaceDeclarations(css);
  for (const family of ['JetBrains Mono', 'Barlow Condensed']) {
    const faces = declarations.filter(decl => familyOf(decl) === family);
    assert.ok(faces.length > 0, `the shell stylesheet must declare @font-face for ${family}`);
    for (const decl of faces) {
      assert.match(decl, /unicode-range\s*:/, `${family} must declare an explicit unicode-range`);
      assert.match(decl, /format\(\s*['"]?woff2['"]?\s*\)/, `${family} must ship woff2 only`);
      const urls = urlTargets(decl);
      assert.ok(urls.length > 0, `${family} @font-face must name a font file`);
      for (const url of urls) {
        assert.doesNotMatch(url, /^[a-z][a-z0-9+.-]*:/i, `${url} must not name a url scheme`);
        assert.doesNotMatch(url, /^\/\//, `${url} must not be a protocol-relative url`);
        assert.match(url, /^\/fonts\/[A-Za-z0-9._-]+\.woff2$/, `${url} must be a same-origin packaged font path`);
      }
    }
  }
  // No remote reference of any kind survives into the shell stylesheet.
  assert.doesNotMatch(css, /https?:\/\//, 'the shell stylesheet must reference no remote asset');
});

test('web font bundle: the packaged font tree carries the licence and the coverage record (TASK-2773.11)', () => {
  const files = readdirSync(FONT_ASSET_DIR);
  for (const family of ['jetbrains-mono', 'barlow-condensed']) {
    const subsets = files.filter(file => file.startsWith(`${family}-`) && file.endsWith('.woff2'));
    assert.ok(subsets.length > 0, `web/public/fonts must carry a ${family} woff2 subset`);
    for (const subset of subsets) {
      assert.equal(readFileSync(new URL(subset, FONT_ASSET_DIR)).subarray(0, 4).toString('latin1'), 'wOF2',
        `${subset} must be a real woff2 file`);
    }
  }
  const notices = ['OFL-JetBrains-Mono.txt', 'OFL-Barlow-Condensed.txt', 'FONTS.txt'];
  for (const notice of notices) {
    assert.ok(files.includes(notice), `the packaged font tree must carry ${notice}`);
  }
  const jetbrainsOfl = readFileSync(new URL('OFL-JetBrains-Mono.txt', FONT_ASSET_DIR), 'utf8');
  const barlowOfl = readFileSync(new URL('OFL-Barlow-Condensed.txt', FONT_ASSET_DIR), 'utf8');
  for (const [text, family] of [[jetbrainsOfl, 'JetBrains Mono'], [barlowOfl, 'Barlow Condensed']] as const) {
    assert.match(text, /SIL Open Font License, Version 1\.1/, `${family} must ship the OFL text`);
    assert.ok(text.includes(family), `the ${family} notice must name its family`);
  }
  // The coverage record names both families, the subset ranges they actually
  // cover, and what happens outside them.
  const coverage = readFileSync(new URL('FONTS.txt', FONT_ASSET_DIR), 'utf8');
  assert.match(coverage, /JetBrains Mono/);
  assert.match(coverage, /Barlow Condensed/);
  assert.match(coverage, /fallback/i);
  const css = readFileSync(STYLE_SOURCE, 'utf8');
  const declaredRanges = new Set(fontFaceDeclarations(css)
    .map(decl => /unicode-range\s*:\s*([^;]+);/.exec(decl)?.[1]?.replace(/\s+/g, ' ')?.trim())
    .filter((range): range is string => range !== undefined));
  assert.ok(declaredRanges.size > 0, 'the stylesheet must declare unicode-ranges to record');
  for (const range of declaredRanges) {
    assert.ok(coverage.includes(range), `FONTS.txt must record the declared range ${range}`);
  }
});

test('web font bundle: type tokens keep a fallback stack for an unsupported glyph or a failed load (TASK-2773.11)', () => {
  const mono = stackFamilies(MONO);
  const display = stackFamilies(DISPLAY);
  assert.equal(mono[0], 'JetBrains Mono');
  assert.equal(display[0], 'Barlow Condensed');
  // A generic family last: a font that never loads still resolves to a readable
  // system face rather than to the browser default.
  assert.equal(mono.at(-1), 'monospace');
  assert.equal(display.at(-1), 'sans-serif');
  for (const fallback of ['Menlo', 'ui-monospace']) {
    assert.ok(mono.includes(fallback), `the mono stack must keep the ${fallback} fallback`);
  }
  for (const fallback of ['Arial Narrow', 'system-ui']) {
    assert.ok(display.includes(fallback), `the display stack must keep the ${fallback} fallback`);
  }
});
