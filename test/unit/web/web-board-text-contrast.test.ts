import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Window } from 'happy-dom';
import { FlightColumn } from '../../../web/src/flight-column.js';
import { AttentionRail } from '../../../web/src/attention-rail.js';
import { DoneRail } from '../../../web/src/done-rail.js';
import { C, DANGER, TYPE } from '../../../web/src/palette.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { toWebBoardSnapshot } from '../../../src/interfaces/web/transport.js';
import { makeCard, makeFullCard, makeProjection, makeAttentionItem } from '../../fixtures/board-projection.js';

function rgb(color: string): number[] {
  if (color.startsWith('#')) { return color.slice(1).match(/../g)!.map(value => parseInt(value, 16)); }
  const values = color.match(/[\d.]+/g);
  assert.ok(values, color);
  return values.slice(0, 3).map(Number);
}
function blend(front: number[], back: number[], opacity: number): number[] {
  return front.map((value, index) => value * opacity + back[index] * (1 - opacity));
}
function luminance(color: number[]): number {
  return color.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}
function contrast(front: number[], back: number[]): number {
  const a = luminance(front), b = luminance(back);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

test('informational palette passes every board surface including gradient and danger (TASK-2773.03)', () => {
  for (const surface of [C.card, C.cardFoot, C.panel, C.log, '#1b2027', DANGER.surface]) {
    for (const color of [C.text, C.muted, C.dim, C.faint, C.green, C.cyan, C.amber, C.red, C.purple, C.done]) {
      const ratio = contrast(rgb(color), rgb(surface));
      assert.ok(ratio >= 4.5, `${color} on ${surface}: ${ratio.toFixed(2)}:1`);
    }
  }
  assert.ok(contrast(rgb('#5a6873'), rgb(C.card)) < 4.5);
  const css = readFileSync(new URL('../../../web/src/style.css', import.meta.url), 'utf8');
  for (const token of ['faint', 'dim', 'stroke'] as const) {
    assert.ok(css.includes(`--${token}: ${C[token]};`), `CSS mirror for ${token}`);
  }
});

for (const check of ['contrast', 'type'] as const) {
  for (const gate of ['not-run', 'unconfigured', 'unavailable', 'failed', 'passed'] as const) {
    test(`rendered board text meets ${check} floor for ${gate} (TASK-2773.03)`, () => {
      const card = makeFullCard({ gate, agent: null, blockingReason: null,
        commands: [{ command: 'review', enabled: false, reason: 'unavailable', targetLane: null }],
        // The attempt budget renders glyphs as text, so it belongs in the floor
        // walk rather than only in its own contract suite.
        reviewRound: 2, reviewPhase: 'reviewing', reviewDisposition: null,
        reviewHistory: [
          { number: 1, reviewer: agentFamily('codex'), implementer: agentFamily('custom'), phase: 'approved', disposition: 'APPROVED', comment: null, findingSummaries: [], pushbacks: [], fixes: [] },
          { number: 2, reviewer: agentFamily('codex'), implementer: agentFamily('custom'), phase: 'reviewing', disposition: null, comment: null, findingSummaries: [], pushbacks: [], fixes: [] },
        ] });
      const projection = {
        ...makeProjection({ review: [card], done: [makeCard({ lane: 'done', status: 'done', closed: true })] }),
        attentionQueue: [makeAttentionItem(card, { kind: 'review-lane', detail: 'needs review' }, 1)],
      };
      const snapshot = toWebBoardSnapshot(projection);
      const common = { onAction() {}, onSelect() {}, selectedId: null, pendingCommands: new Map() };
      const html = renderToString(createElement('div', { style: { color: C.text, fontSize: TYPE.body, background: C.panel } },
        createElement(FlightColumn, { ...common, stage: snapshot.stages.find(stage => stage.lane === 'review')!, style: {}, onDragStart() {}, onDrop() {}, draggable: false }),
        createElement(AttentionRail, { ...common, snapshot }),
        createElement(DoneRail, { stage: snapshot.stages.find(stage => stage.lane === 'done')! }),
        createElement(FlightColumn, { ...common, stage: { lane: 'active', cards: [], count: 0 }, style: {}, onDragStart() {}, onDrop() {}, draggable: false })));
      const window = new Window();
      try {
        window.document.body.innerHTML = html;
        let checked = 0;
        const walk = (element: typeof window.document.body, inherited: { color: string; size: number; background: number[]; opacity: number; backdrop: number[] }) => {
          if (element.getAttribute('aria-hidden') === 'true') { return; }
          const style = element.style;
          const backgroundValue = style.background;
          const ownBackground = backgroundValue.match(/#[\da-f]{6}/i)?.[0]
            ?? (backgroundValue.startsWith('rgb(') ? backgroundValue : undefined);
          const background = ownBackground ? rgb(ownBackground) : inherited.background;
          const opacity = inherited.opacity * (style.opacity ? Number(style.opacity) : 1);
          const backdrop = style.opacity ? inherited.background : inherited.backdrop;
          const state = { color: style.color || inherited.color, size: parseFloat(style.fontSize) || inherited.size, background, opacity, backdrop };
          for (const node of element.childNodes) {
            if (node.nodeType === 3 && node.textContent?.trim()) {
              const label = node.textContent.trim();
              const renderedBackground = blend(background, backdrop, opacity);
              const ratio = contrast(blend(rgb(state.color), backdrop, opacity), renderedBackground);
              if (check === 'contrast') { assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(2)}:1, opacity ${opacity}`); }
              if (check === 'type') { assert.ok(state.size >= 11, `${label}: ${state.size}px`); }
              checked++;
            }
          }
          for (const child of element.children) { walk(child as typeof element, state); }
        };
        walk(window.document.body.firstElementChild as typeof window.document.body,
          { color: C.text, size: TYPE.body, background: rgb(C.panel), opacity: 1, backdrop: rgb(C.panel) });
        assert.ok(checked > 25, `only ${checked} text nodes checked`);
        assert.match(html, /<details class="shipped"/);
        assert.match(html, /aria-disabled="true"/);
      } finally { void window.close(); }
    });
  }
}
