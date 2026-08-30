/**
 * Focused component tests for the read-only browser board (TASK-2434).
 *
 * Every fixture is transport-shaped: it is built from the shared board
 * projection fixtures and passed through `toWebBoardSnapshot`, so no domain
 * rule is duplicated here. The second half of this file scans the production
 * browser sources for the anti-slop boundary the mission fixes: no mock data,
 * no domain-rule mapping, no Node or concrete-adapter import, no browser
 * persistence, and no mutation path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../web/src/board.js';
import { Shell } from '../web/src/shell.js';
import { durationText } from '../web/src/format.js';
import { toWebBoardSnapshot } from '../src/interfaces/web/transport.js';
import type { WebBoardSnapshot } from '../src/interfaces/web/transport.js';
import type { BoardProjection } from '../src/application/projections/board.js';
import type { AgentAvailabilityMetric } from '../src/application/projections/board.js';
import type { MissionCard } from '../src/application/projections/mission-board.js';
import { agentFamily } from '../src/domain/agents.js';
import { emptyMetrics, makeAttentionItem, makeCard, makeProjection } from './fixtures/board-projection.js';

const webSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src');
const browserSources = fs.readdirSync(webSrc)
  .filter((name) => /\.(?:ts|tsx|css)$/.test(name))
  .map((name) => ({ name, text: fs.readFileSync(path.join(webSrc, name), 'utf8') }));

const render = (snapshot: WebBoardSnapshot): string =>
  renderToStaticMarkup(React.createElement(Board, { snapshot }));

const snapshotOf = (overrides: Partial<BoardProjection>): WebBoardSnapshot =>
  toWebBoardSnapshot({ ...makeProjection(), ...overrides });

function metric(overrides: Partial<AgentAvailabilityMetric>): AgentAvailabilityMetric {
  return { family: agentFamily('custom'), available: true, blockedForMs: 0, reason: null, ...overrides };
}

/** A snapshot with a card in every lane, an attention item, and agent facts. */
function populated(): WebBoardSnapshot {
  const blocked = makeCard({
    id: 'task-0001' as MissionCard['id'],
    title: 'blocked mission',
    lane: 'review',
    status: 'review',
    agent: agentFamily('claude'),
    checkpoint: 'CP-2.md',
    checkpointDescription: 'CP-2: components extracted',
    nextActionText: 'act on reviewer findings',
    gate: 'failed',
    pullRequest: { kind: 'pull-request', provider: 'forgejo', id: '47', url: 'https://example.invalid/pr/47', sourceBranch: 'mission/task-0001', targetBranch: 'main' },
    reviewRound: 2,
    reviewHistory: [
      { number: 1, reviewer: agentFamily('codex'), implementer: agentFamily('claude'), phase: 'approved', disposition: 'APPROVED', comment: null, findingSummaries: [], pushbacks: [], fixes: [] },
      { number: 2, reviewer: agentFamily('codex'), implementer: agentFamily('claude'), phase: 'reviewing', disposition: null, comment: null, findingSummaries: [], pushbacks: [], fixes: [] },
    ],
    blockingReason: 'two blocking findings',
    flags: ['review_blocking'],
    commands: [{ command: 'integrate', enabled: false, reason: 'review is not approved' }],
  });
  const base = makeProjection({
    backlog: [makeCard({ id: 'task-0002' as MissionCard['id'], title: 'backlog mission', lane: 'backlog', status: 'backlog' })],
    refined: [makeCard({ id: 'task-0003' as MissionCard['id'], title: 'refined mission', lane: 'refined', status: 'refined' })],
    active: [makeCard({ id: 'task-0004' as MissionCard['id'], title: 'active mission', lane: 'active', status: 'active' })],
    review: [blocked],
    integration: [makeCard({ id: 'task-0005' as MissionCard['id'], title: 'integration mission', lane: 'integration', status: 'integration' })],
    done: [makeCard({ id: 'task-0006' as MissionCard['id'], title: 'shipped mission', lane: 'done', status: 'done', closed: true })],
  });
  return toWebBoardSnapshot({
    ...base,
    attentionQueue: [makeAttentionItem(blocked, { kind: 'blocking', detail: 'two blocking findings' }, 1)],
    availableActions: [{ command: 'draft', enabled: true, reason: null }],
    operationLog: [{ operationId: 'op-1', phase: 'checkpoint', message: 'CP-2 committed', timestamp: '2026-08-30T10:00:00.000Z' }],
    sourceFacts: [{ source: 'git', status: 'fresh', value: 'main@abcdef' }, { source: 'stats', status: 'unavailable' }],
    metrics: {
      ...emptyMetrics,
      agentAvailability: [
        metric({ family: agentFamily('codex'), runningSessions: 0 }),
        metric({ family: agentFamily('claude'), available: false, blockedForMs: 90_000, reason: 'usage limit hit', runningSessions: null }),
        metric({ family: agentFamily('mistral'), available: false, blockedForMs: Number.POSITIVE_INFINITY, reason: 'manual block' }),
      ],
      unattributedRunningSessions: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Populated rendering (SC1)
// ---------------------------------------------------------------------------

test('a populated snapshot renders repository identity and all six received stages in received order', () => {
  const html = render(populated());
  assert.match(html, /test-repo/);
  const positions = ['REFINED', 'BACKLOG', 'ACTIVE', 'REVIEW', 'INTEGRATION', 'DONE'].map((label) => html.indexOf(label));
  assert.ok(positions.every((position) => position >= 0), 'every received lane renders');
  // The intake pair stacks in the design authority's order; every other lane
  // keeps the order the server sent.
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'lanes render in the board order');
});

test('every received card renders in its stage, including the collapsible done history', () => {
  const html = render(populated());
  for (const id of ['task-0001', 'task-0002', 'task-0003', 'task-0004', 'task-0005', 'task-0006']) {
    assert.ok(html.includes(id), `${id} renders`);
  }
  assert.match(html, /shipped mission/);
  assert.match(html, /<details class="shipped" aria-label="done stage">/);
});

test('attention items render the server rank, reason kind, detail and action display', () => {
  const html = render(populated());
  assert.match(html, /01/);
  assert.match(html, /blocking/);
  assert.match(html, /two blocking findings/);
});

test('card facts render from the server without substitution', () => {
  const html = render(populated());
  assert.match(html, /CP-2\.md/);
  assert.match(html, /gate ✗ FAIL/);
  assert.match(html, /act on reviewer findings/);
  assert.match(html, /round 2/);
  assert.match(html, /href="https:\/\/example\.invalid\/pr\/47"/);
  assert.match(html, /review history: 2 rounds/);
  assert.match(html, /review_blocking/);
});

test('the operation log renders the server entry rather than a reconstructed one', () => {
  const html = render(populated());
  assert.match(html, /2026-08-30T10:00:00\.000Z/);
  assert.match(html, /CP-2 committed/);
});

// ---------------------------------------------------------------------------
// Empty, unavailable and unknown values (SC2)
// ---------------------------------------------------------------------------

test('an empty snapshot states each region is empty and never shows a zero metric as a fact', () => {
  const html = render(snapshotOf({}));
  assert.equal(html.split('no missions in this stage').length - 1, 6);
  assert.match(html, /nothing in the attention queue/);
  assert.match(html, /no operations recorded/);
  assert.ok(!html.includes('running'), 'no agent session count is invented for an empty snapshot');
});

test('an unknown gate renders as unknown, never as a pass', () => {
  const html = render(snapshotOf({
    stages: makeProjection({ active: [makeCard({ checkpoint: 'CP-1.md', gate: 'unknown' })] }).stages,
  }));
  assert.match(html, /gate · unknown/);
  assert.ok(!html.includes('gate ✓'), 'unknown never renders as passed');
});

test('an absent implementer renders as absent, never as an idle or named agent', () => {
  const html = render(snapshotOf({
    stages: makeProjection({ active: [makeCard({ agent: null })] }).stages,
  }));
  assert.match(html, /no implementer/);
});

test('omitted, null and observed-zero running sessions each render as themselves', () => {
  const html = render(populated());
  assert.match(html, /0 running/, 'an observed zero renders as zero');
  assert.match(html, /sessions unknown/, 'an unobserved liveness renders as unknown');
  assert.match(html, /unattributed sessions unknown/);
  // mistral has no runningSessions key at all: it contributes no session text.
  assert.equal(html.split('sessions unknown').length - 1, 2, 'only the null cases print unknown');
});

test('an indefinite agent block never renders as a numeric duration', () => {
  const html = render(populated());
  assert.match(html, /blocked · indefinite/);
  assert.match(html, /blocked · 1m 30s/);
});

test('agent-block durations use human-sized units', () => {
  assert.equal(durationText({ kind: 'finite', ms: 3_625 * 60_000 }), '2d 12h');
  assert.equal(durationText({ kind: 'finite', ms: 400 * 24 * 60 * 60_000 }), '1y 1mo');
});

// ---------------------------------------------------------------------------
// Read-only boundary and reference-preserving overflow (SC4, SC5)
// ---------------------------------------------------------------------------

test('every rendered action is a disabled native control carrying the server display and state', () => {
  const html = render(populated());
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  assert.ok(buttons.length > 0, 'the fixture renders at least one action');
  for (const button of buttons) {
    assert.match(button, /disabled/, `action is native-disabled: ${button}`);
    assert.ok(!/onclick/i.test(button), `action has no click handler: ${button}`);
  }
  assert.match(html, /px active task-0001/, "the server's display string is rendered verbatim");
  assert.ok(
    !/<button[^>]*aria-label="px integrate task-0001 — ineligible/.test(html),
    'an action the server did not mark runnable is not rendered as a card control',
  );
});

test('the rendered board carries no drag, drop or draggable affordance', () => {
  const html = render(populated());
  for (const token of ['draggable', 'ondrag', 'ondrop', 'ondragover', 'ondragstart']) {
    assert.ok(!html.toLowerCase().includes(token), `no ${token} in the rendered board`);
  }
});

test('narrow viewports scroll the board horizontally instead of dropping lanes', () => {
  const html = render(populated());
  assert.match(html, /overflow-x:auto/, 'the lane row scrolls horizontally like the reference');
  assert.match(html, /min-width:318px/, 'in-flight lanes keep the reference minimum width');
  assert.ok(!html.includes('display:none'), 'no lane or action is hidden at any width');
});

// ---------------------------------------------------------------------------
// Landmarks, headings, accessible names and visible focus (SC7)
// ---------------------------------------------------------------------------

test('the shell renders a main landmark and marks itself busy while the snapshot loads', () => {
  // renderToStaticMarkup runs no effects, so this is the pre-fetch state.
  const html = renderToStaticMarkup(React.createElement(Shell));
  assert.match(html, /<main[^>]*aria-busy="true"/);
  assert.match(html, /role="status"/);
  assert.match(html, /<h1[^>]*>LOADING BOARD<\/h1>/);
});

test('every board region is a named landmark and every lane carries a heading', () => {
  const html = render(populated());
  for (const region of ['Agent availability', 'Operation log']) {
    assert.ok(html.includes(`aria-label="${region}"`), `${region} is a named region`);
  }
  assert.match(html, /aria-labelledby="attention-heading"/);
  for (const lane of ['backlog', 'refined', 'active', 'review', 'integration', 'done']) {
    assert.ok(html.includes(`aria-label="${lane} stage"`), `${lane} is a named region`);
  }
  assert.equal((html.match(/<h1[^>]*>/g) ?? []).length, 1, 'the board has exactly one h1');
  const headings = html.match(/<h2[^>]*>/g) ?? [];
  assert.ok(headings.length >= 7, 'the attention rail and every lane carry an h2');
});

test('every action control has an accessible name carrying the server display and state', () => {
  const html = render(populated());
  const names = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.length > 0, 'the fixture renders at least one action');
  for (const name of names) {
    assert.match(name ?? '', / — (?:enabled|ineligible|unavailable)/, `accessible name states availability: ${String(name)}`);
  }
  assert.ok(
    names.some((name) => (name ?? '').includes('command is not eligible for this mission')),
    "a non-enabled action's server reason reaches its accessible name",
  );
});

test('the done-history disclosure is a native, keyboard-operable control rather than a scripted toggle', () => {
  const html = render(populated());
  assert.match(html, /<details class="shipped" aria-label="done stage"><summary>/);
  assert.ok(!/tabindex/i.test(html), 'focus order is the document order, never overridden');
});

test('the browser stylesheet defines a visible focus indicator', () => {
  const css = browserSources.find((file) => file.name === 'style.css');
  assert.ok(css !== undefined, 'the client ships a stylesheet');
  assert.match(css.text, /:focus-visible\s*\{[^}]*outline:/);
});

// ---------------------------------------------------------------------------
// Anti-slop source scan of the production browser code (SC8)
// ---------------------------------------------------------------------------

test('production browser code imports no Node built-in, concrete adapter, or server module', () => {
  for (const file of browserSources) {
    for (const forbidden of ["'node:", 'src/adapters/', 'child_process', 'better-sqlite3', 'simple-git', "'fastify'"]) {
      assert.ok(!file.text.includes(forbidden), `${file.name} must not reference ${forbidden}`);
    }
  }
  const transportImports = browserSources.filter((file) => file.text.includes('/src/interfaces/web/transport.js'));
  assert.ok(transportImports.length > 0, 'the client reuses the shared transport contract');
});

test('production browser code uses no browser persistence or cached snapshot', () => {
  for (const file of browserSources) {
    for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'caches.', 'setInterval', 'EventSource']) {
      assert.ok(!file.text.includes(forbidden), `${file.name} must not use ${forbidden}`);
    }
  }
});

test('production browser code performs exactly one fetch and no mutating request', () => {
  const fetches = browserSources.flatMap((file) => (file.text.match(/\bfetch\(/g) ?? []).map(() => file.name));
  assert.deepEqual(fetches, ['board-data.ts'], 'the snapshot read is the only fetch in the client');
  for (const file of browserSources) {
    for (const verb of ["'POST'", "'PUT'", "'PATCH'", "'DELETE'", 'method:']) {
      assert.ok(!file.text.includes(verb), `${file.name} must not build a mutating request (${verb})`);
    }
  }
});

test('production browser code contains no mock mission data or invented metric', () => {
  for (const file of browserSources) {
    assert.ok(!/task-\d/.test(file.text), `${file.name} must not embed a mission id`);
    for (const invented of ['missions/wk', 'median', 'throughput', 'bottleneck', 'cycle time']) {
      assert.ok(!file.text.toLowerCase().includes(invented.toLowerCase()), `${file.name} must not invent ${invented}`);
    }
  }
});

test('production browser code maps no lane to a lifecycle rule or command', () => {
  const laneLiteral = /'(?:backlog|refined|active|review|integration|done)'/;
  const allowed = new Set([
    "const INTAKE_LANES: readonly string[] = ['refined', 'backlog'];",
    "const SHIPPED_LANE = 'done';",
  ]);
  for (const file of browserSources) {
    for (const line of file.text.split('\n')) {
      if (laneLiteral.test(line)) {
        assert.ok(allowed.has(line.trim()), `${file.name} maps a lane outside the layout buckets: ${line.trim()}`);
      }
    }
    assert.ok(!/'px /.test(file.text), `${file.name} must not embed a px command string`);
  }
});

test('the client adds no router, browser state framework, server-rendering layer, or design system', () => {
  for (const file of browserSources) {
    for (const forbidden of ['react-router', 'redux', 'zustand', 'mobx', 'jotai', 'recoil', '@tanstack', 'react-dom/server', 'styled-components', '@emotion', '@mui', 'tailwind', 'bootstrap']) {
      assert.ok(!file.text.includes(forbidden), `${file.name} must not depend on ${forbidden}`);
    }
  }
  const imports = browserSources.flatMap((file) => [...file.text.matchAll(/from '([^']+)'/g)].map((match) => match[1]));
  const external = imports.filter((specifier) => specifier !== undefined && !specifier.startsWith('.'));
  assert.deepEqual([...new Set(external)].sort(), ['react', 'react-dom/client'], 'the client depends on React and React DOM only');
});
