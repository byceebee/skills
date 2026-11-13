import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { inspectElement } from '../extension/element.mjs';

const html = `<!doctype html>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px sans-serif; }
  #dialog {
    position: relative; display: grid; grid-template-columns: 220px 1fr;
    column-gap: 20px; row-gap: 12px; width: 600px; padding: 16px;
  }
  #nested-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 200px; }
  #flex-shell { display: flex; gap: 10px; }
  #flex-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; width: 180px; }
  #hidden-grid { display: none; grid-template-columns: 1fr 1fr; }
  #offscreen-grid { position: absolute; left: 1200px; top: 0; display: grid; grid-template-columns: 1fr 1fr; }
  .flex-leaf { display: block; }
  @media (max-width: 520px) {
    #dialog { width: 360px; grid-template-columns: minmax(0, 1fr); }
    #nested-grid { grid-template-columns: minmax(0, 1fr); }
    #flex-grid { grid-template-columns: minmax(0, 1fr); }
  }
</style>
<dialog id="dialog" aria-label="Layout fixture">
  <section id="nested-grid"><span>Nested A</span><span>Nested B</span></section>
  <div id="flex-shell"><section id="flex-grid"><span>Flex grid A</span><span>Flex grid B</span><span>Flex grid C</span></section><span class="flex-leaf">Flex leaf</span></div>
  <section id="hidden-grid"><span>Hidden</span></section>
  <section id="offscreen-grid"><span>Offscreen</span></section>
</dialog>`;

test('reports visible nested local grids and tracks responsive changes on the existing selection', { timeout: 20000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.setContent(html);
    await page.locator('#dialog').evaluate(dialog => dialog.showModal());

    const invoke = (action, selector) => page.evaluate(({ source, action, selector }) => {
      const injected = (0, eval)(`(${source})`);
      return injected({ action, origin: location.origin, selector });
    }, { source: inspectElement.toString(), action, selector });

    const selected = await invoke('select', '#dialog');
    assert.equal(selected.element.selector, '#dialog');
    assert.equal(await page.locator('[data-layout-witness-element]:popover-open').isVisible(), true);
    const wide = selected.element.localGrids;
    assert.equal(wide.truncated, false);
    assert.deepEqual(wide.grids.map(({ selector, scope }) => [selector, scope]), [
      ['#dialog', 'selected'],
      ['#nested-grid', 'nested'],
      ['#flex-grid', 'nested'],
    ]);
    const dialogGrid = wide.grids[0];
    assert.equal(dialogGrid.columns.tracks.length, 2);
    assert.equal(dialogGrid.columns.gap, 20);
    assert.ok(dialogGrid.contentBox.width > 0);
    const nestedGrid = wide.grids.find(({ selector }) => selector === '#nested-grid');
    assert.equal(nestedGrid.columns.tracks.length, 2);
    assert.equal(nestedGrid.columns.gap, 8);
    const flexGrid = wide.grids.find(({ selector }) => selector === '#flex-grid');
    assert.equal(flexGrid.columns.tracks.length, 3);
    assert.equal(flexGrid.columns.gap, 6);

    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForTimeout(50);
    const narrow = await invoke('status');
    assert.equal(narrow.element.selector, selected.element.selector);
    assert.equal(narrow.element.localGrids.grids[0].columns.tracks.length, 1);
    assert.equal(narrow.element.localGrids.grids.find(({ selector }) => selector === '#nested-grid').columns.tracks.length, 1);
    assert.equal(narrow.element.localGrids.grids.find(({ selector }) => selector === '#flex-grid').columns.tracks.length, 1);

    const leaf = await invoke('select', '.flex-leaf');
    assert.equal(leaf.element.tag, 'span');
    assert.deepEqual(leaf.element.localGrids.grids, []);
  } finally {
    await browser.close();
  }
});
