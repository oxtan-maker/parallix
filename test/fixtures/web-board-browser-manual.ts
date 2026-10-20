/** Disposable whole-board walkthrough. Run with npx tsx; no operator state. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pointerBoard } from './web-pointer-board.js';
import { makeCard, makeCards, makeProjection } from './board-projection.js';
import { toWebBoardSnapshot } from '../../src/interfaces/web/transport.js';
import { C, MONO } from '../../web/src/palette.js';
import { createWebHost } from '../../src/interfaces/web/host.js';
import { loadWebAssets } from '../../src/adapters/web/asset-store.js';

const fixture = await pointerBoard();
try {
  const { page } = fixture;
  // The production host supplies integrity-checked packaged fonts and CSP.
  const host = createWebHost({ assets: loadWebAssets('build/web'), buildProjection: async () => makeProjection() });
  const info = await host.start();
  try {
    const remote: string[] = [];
    page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') remote.push(request.url()); });
    await page.goto(info.origin);
    await page.evaluate(async () => {
      await Promise.all([document.fonts.load('14px "JetBrains Mono"'), document.fonts.load('24px "Barlow Condensed"')]);
    });
    assert.equal(await page.evaluate(() => document.fonts.check('14px "JetBrains Mono"') && document.fonts.check('24px "Barlow Condensed"')), true);
    assert.deepEqual(remote, []);
    console.log('Packaged production host: both font families loaded; zero requests to other hosts.');
  } finally { await host.close(); }
  // Restore the disposable interactive host and route its fonts from the same files.
  await page.goBack();
  const shellStyle = async () => page.evaluate(({color,background,fontFamily}) => {
    Object.assign(document.getElementById('root')!.style, {height:'100vh',display:'flex',flexDirection:'column',overflowY:'auto',color,background,fontFamily,fontSize:'12px'});
  }, {color:C.text,background:C.page,fontFamily:MONO});
  for (const viewport of [{width:1600,height:900}, {width:800,height:480}]) {
    await page.setViewportSize(viewport);
    await shellStyle();
    await page.route('**/fonts/*.woff2', route => route.fulfill({ contentType: 'font/woff2', body: readFileSync(`web/public${new URL(route.request().url()).pathname}`) }));
    const cards = makeCards(40, 'active').map((card, index) => ({ ...card,
      blockingReason: index === 0 ? 'fixture blocked' : null, gate: index === 1 ? 'failed' as const : card.gate,
      commands: [{command:'cancel' as const,enabled:true,reason:null,targetLane:null}],
    }));
    const base = toWebBoardSnapshot(makeProjection({active:cards, done:[makeCard({lane:'done',status:'done',closed:true})]}));
    await fixture.render({...base, operationLog:[{operationId:'manual',phase:'execute',message:'Isolated log observation',timestamp:'2026-10-20T08:09:10Z'}]});
    const lane = page.locator('[aria-label="active stage"]');
    const geometry = await lane.evaluate(node => {
      const scroller = node.lastElementChild!; scroller.scrollTop=200;
      const row = [...document.querySelectorAll<HTMLElement>('*')].find(element => element.style.overflowX === 'auto' && element.contains(node))!;
      row.scrollLeft=200;
      return {lane:scroller.scrollTop,horizontal:row.scrollLeft,rowWidth:row.clientWidth,rowContent:row.scrollWidth,logBottom:document.querySelector('[aria-label="Operation log"]')!.getBoundingClientRect().bottom};
    });
    assert.equal(geometry.lane,200);
    if(viewport.width===800) assert.ok(geometry.horizontal>0);
    assert.equal(geometry.logBottom,viewport.height);
    const rail=page.locator('details.shipped');
    await rail.locator(':scope > summary').click(); assert.equal(await rail.evaluate(node => (node as HTMLDetailsElement).open),true);
    await rail.locator(':scope > summary').click();
    assert.deepEqual(await lane.locator('[data-board-card]').evaluateAll(nodes=>nodes.slice(0,2).map(node=>getComputedStyle(node).borderTopColor)),['rgb(226, 96, 78)','rgb(226, 96, 78)']);
    await lane.evaluate(node => {node.lastElementChild!.scrollTop=0;});
    const cancel=lane.locator('[data-action-kind="mission:cancel"]').first();
    const before=fixture.requests.length;
    await cancel.click(); await page.getByRole('dialog').waitFor(); assert.equal(fixture.requests.length,before);
    await page.getByRole('button',{name:'keep mission',exact:true}).click(); assert.equal(fixture.requests.length,before);
    await cancel.click(); await page.getByRole('button',{name:/delete .* lifecycle rows/}).click();
    await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
    assert.equal(fixture.requests.length,before+1);
    const selected = lane.locator('[data-board-card]').first();
    await selected.focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog', {name:/Mission progress/}).waitFor();
    assert.equal(await selected.getAttribute('aria-current'),'true');
    await page.keyboard.press('Escape');
    assert.match(await selected.locator('footer [role="status"]').innerText(),/Cancelled/);
    // Timestamp uses native summary semantics rather than a custom button.
    const summary=page.locator('[aria-label="Operation log"] summary');
    await summary.click(); assert.match(await page.locator('[aria-label="Operation log"]').innerText(),/source: 2026-10-20T08:09:10Z/);
    await page.screenshot({path:`/tmp/board-manual-${viewport.width}.png`});
    console.log(JSON.stringify({viewport,geometry,observed:'lane/viewport scrolling, done disclosure, red blocked/failed borders, two-stage cancel and local timestamp disclosure pass'}));
    await fixture.render(toWebBoardSnapshot(makeProjection()));
    assert.equal(await page.locator('[data-board-card]').count(),0);
    console.log('Compact empty lanes remain visible; no cards fabricated.');
    for (const kind of ['long','unknown','review'] as const) {
      const card=makeCard({lane:kind==='long'?'active':'review',status:kind==='long'?'active':'review',blockingReason:null, currentWork:{operationId:'manual-live',phase:'execute',summary:'Disposable work',agent:null,updatedAt:new Date().toISOString(),freshness:'live'}, checkpoint:kind==='unknown'?null:'CP-1',
        checkpointEvidence:kind==='unknown'?[]:Array.from({length:100},(_,i)=>({name:`CP-${i+1}`,description:`Step ${i+1}`,goalCheck:[],state:'future' as const})),
        reviewRound:kind==='review'?2:kind==='unknown'?99:null, reviewPhase:kind==='review'?'reviewing':null, reviewHistory:[], reviewDisposition:kind==='review'?'REQUEST_CHANGES':null});
      await fixture.render(toWebBoardSnapshot(makeProjection({[kind==='long'?'active':'review']:[card]})));
      if(kind!=='unknown') {
        await page.getByRole('button',{name:/View checkpoint evidence/}).click();
        await page.getByRole('dialog').getByRole('button',{name:'CP-100',exact:true}).click();
        await page.keyboard.press('Escape');
      }
      if(kind==='review') assert.ok(await page.getByLabel(/outcome recorded: changes requested/).count());
      if(kind==='unknown') {
        assert.match(await page.locator('[data-board-card]').innerText(),/review round unknown/);
        assert.match(await page.getByRole('group',{name:'Checkpoint plan',exact:true}).getAttribute('aria-description') ?? '',/Plan unavailable.*Completion unknown/);
      }
      assert.ok(await page.locator('.fan.spin').count());
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.equal(await page.locator('[data-board-card]').evaluateAll(nodes=>nodes.some(node=>node.getAnimations({subtree:true}).some(animation=>animation.playState==='running'))),false);
      console.log(`${kind}: supplied plan/disposition rendered; no active reduced-motion animations.`);
    }
    await page.unroute('**/fonts/*.woff2');
    await page.route('**/fonts/*.woff2',route=>route.abort());
    await page.reload();
    await shellStyle();
    await fixture.render(toWebBoardSnapshot(makeProjection({active:[makeCard({title:'Readable fallback Ω 漢字 → ✓'})]})));
    assert.match(await page.locator('[data-board-card]').innerText(),/Readable fallback Ω 漢字 → ✓/);
    await page.screenshot({path:`/tmp/board-fallback-${viewport.width}.png`});
    console.log('Font requests blocked: text and out-of-subset glyphs remain visible.');
    await page.unroute('**/fonts/*.woff2');
  }
} finally { await fixture.close(); }
