// Gate icon contract (PX-0052): the web card draws the supplied Parallix gate designs.
// The fixtures under test/fixtures/web-gate-icons are the design's own files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GateIcon } from '../../../../web/src/gate-icon.js';
import type { WebMissionCard } from '../../../../src/interfaces/web/transport.js';

type Gate = WebMissionCard['gate'];
const FIXTURES = path.resolve(import.meta.dirname, '../../../fixtures/web-gate-icons');
const STYLESHEET = fs.readFileSync(path.resolve(import.meta.dirname, '../../../../web/src/style.css'), 'utf8');

// Every GateState and the design that shows it; unavailable is the unknown design.
const DESIGN: Record<Gate, string> = {
  passed: 'passed', failed: 'failed', running: 'running', stale: 'stale',
  'not-run': 'not-run', unconfigured: 'unconfigured', unavailable: 'unknown',
};

type Element = { tag: string; attributes: Record<string, string> };

function elements(markup: string): Element[] {
  return [...markup.matchAll(/<(svg|path|circle)\b([^>]*?)\/?>/g)].map(([, tag, raw]) => ({
    tag: tag!,
    attributes: Object.fromEntries([...raw!.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name!, value!])),
  }));
}

const designSvg = (design: string) => fs.readFileSync(path.join(FIXTURES, `${design}.svg`), 'utf8');
const designShapes = (design: string) => elements(designSvg(design).split('</style>')[1]!.replace('</svg>', ''));
const rendered = (gate: Gate) => renderToStaticMarkup(React.createElement(GateIcon, { gate }));
const squash = (css: string) => css.replace(/\s+/g, ' ').trim();

test('each GateState renders the design geometry exactly (PX-0052)', () => {
  for (const [gate, design] of Object.entries(DESIGN) as [Gate, string][]) {
    const [root, ...shapes] = elements(rendered(gate)).filter(element => element.tag !== 'svg' || element.attributes.viewBox);
    const [designRoot] = elements(designSvg(design));
    assert.equal(root!.attributes.viewBox, '0 0 24 24');
    assert.equal(root!.attributes.viewBox, designRoot!.attributes.viewBox);
    assert.equal(root!.attributes.class, designRoot!.attributes.class);
    assert.equal(root!.attributes['data-state'], designRoot!.attributes['data-state']);
    assert.deepEqual(shapes, designShapes(design), `${gate} draws ${design}.svg path data, opacities and classes`);
  }
});

test('each icon carries the design accessible name and unavailable keeps its detail (PX-0052)', () => {
  for (const [gate, design] of Object.entries(DESIGN) as [Gate, string][]) {
    const html = rendered(gate);
    const label = /aria-label="([^"]*)"/.exec(designSvg(design))![1];
    assert.match(html, new RegExp(`<svg[^>]*role="img"[^>]*aria-label="${label}"|<svg[^>]*aria-label="${label}"[^>]*role="img"`), `${gate} is named ${label}`);
  }
  const unavailable = rendered('unavailable');
  assert.match(unavailable, /title="Gate evidence could not be observed"/);
  assert.match(unavailable, /<span[^>]*>Gate evidence could not be observed<\/span>/, 'reachable to assistive technology');
  assert.doesNotMatch(unavailable, /gate · unavailable/);
  assert.doesNotMatch(rendered('passed'), /title=|<span[^>]*>[^<]+<\/span>/, 'no visible text accompanies a known state');
});

test('only the running arc is animated and every other icon is static (PX-0052)', () => {
  for (const gate of Object.keys(DESIGN) as Gate[]) {
    const html = rendered(gate);
    assert.equal(html.includes('data-animate="true"'), gate === 'running', `${gate} animate flag`);
    assert.equal(html.includes('pg-spin'), gate === 'running', `${gate} spin arc`);
    assert.doesNotMatch(html, /animation|transform/, `${gate} carries no inline motion`);
  }
  const running = elements(rendered('running')).filter(element => element.attributes.class === 'pg-spin');
  assert.equal(running.length, 1);
  const design = squash(fs.readFileSync(path.join(FIXTURES, 'gate-icons.css'), 'utf8'));
  const css = squash(STYLESHEET);
  for (const rule of [
    /\.pg-icon \{ fill:none;[^}]*\}/, /\.pg-icon\[data-state="running"\] \{[^}]*\}/, /\.pg-icon\[data-state="passed"\] \{[^}]*\}/,
    /\.pg-icon\[data-state="failed"\] \{[^}]*\}/, /\.pg-icon\[data-state="stale"\] \{[^}]*\}/,
    /\.pg-icon\[data-animate="true"\]\[data-state="running"\] \.pg-spin \{[^}]*\}/, /@keyframes pg-spin \{[^}]*\}[^}]*\}/,
  ]) {
    const designRule = rule.exec(design)?.[0];
    assert.ok(designRule, `design defines ${rule}`);
    assert.ok(css.includes(designRule), `style.css carries the design rule ${designRule}`);
  }
  assert.match(css, /stroke-width:1\.9/);
  assert.match(css, /transform-origin:17\.5px 17\.5px; animation:pg-spin 1\.6s linear infinite/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{ \.pg-spin \{ animation:none !important; \} \}/);
  for (const state of ['not-run', 'unconfigured', 'unknown']) { assert.ok(css.includes(`.pg-icon[data-state="${state}"]`), state); }
  assert.match(css, /\.pg-icon\[data-state="unknown"\] \{ color:#8b97a1; \}/);
});
