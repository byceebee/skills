import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { inspectPage } from '../scripts/measure.mjs';
import { parseRules } from '../scripts/rules.mjs';

const fixture = `<!doctype html>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px sans-serif; }
  .grid, .named, .implicit, .flex, .parent, .none { min-height: 20px; }
  .grid { display: grid; width: 900px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .named { display: grid; width: 900px; grid-template-columns: [start] 1fr [middle] 1fr [end] 1fr [last]; }
  .implicit { display: grid; width: 900px; grid-template-columns: [start] 1fr [middle] 1fr [end]; }
  .implicit > :last-child { grid-column: 4; }
  .flex { display: flex; width: 900px; }
  .parent { display: grid; width: 900px; grid-template-columns: repeat(3, 1fr); }
  .subgrid { display: grid; grid-column: 1 / 4; grid-template-columns: subgrid; }
  .none { display: grid; width: 900px; grid-template-columns: none; }
  @media (max-width: 600px) {
    .grid { width: 360px; grid-template-columns: minmax(0, 1fr); }
    .named { width: 360px; grid-template-columns: [start] 1fr [middle] 1fr [end] 1fr [last]; }
    .implicit { width: 360px; }
    .flex, .parent, .none { width: 360px; }
  }
</style>
<div class="grid"><i></i><i></i><i></i></div>
<div class="named"><i></i><i></i><i></i></div>
<div class="implicit"><i></i><i></i><i></i></div>
<div class="flex"><i></i><i></i></div>
<div class="parent"><div></div><div></div><div></div><div class="subgrid"><i></i><i></i><i></i></div></div>
<div class="none"></div>`;

const rules = {
  regions: [],
  checks: [
    { id: 'wide-grid', selector: '.grid', metric: 'grid-column-count', expected: 3, minWidth: 601, tolerance: 0 },
    { id: 'wrong-wide-grid', selector: '.grid', metric: 'grid-column-count', expected: 4, minWidth: 601, tolerance: 0 },
    { id: 'narrow-grid', selector: '.grid', metric: 'grid-column-count', expected: 1, maxWidth: 600, tolerance: 0 },
    { id: 'named-lines', selector: '.named', metric: 'grid-column-count', expected: 3, tolerance: 0 },
    { id: 'implicit-track', selector: '.implicit', metric: 'grid-column-count', expected: 4, tolerance: 0 },
    { id: 'flex-columns', selector: '.flex', metric: 'grid-column-count', expected: 2 },
    { id: 'subgrid-columns', selector: '.subgrid', metric: 'grid-column-count', expected: 3 },
    { id: 'no-tracks', selector: '.none', metric: 'grid-column-count', expected: 0, tolerance: 0 },
  ],
};

test('validates and measures resolved grid column tracks in Chromium across widths', { timeout: 20000 }, async () => {
  const parsed = parseRules(rules);
  assert.equal(parsed.checks.length, rules.checks.length);
  assert.throws(() => parseRules({ checks: [{ id: 'negative', selector: '.grid', metric: 'grid-column-count', expected: -1 }] }), /expected/);
  assert.throws(() => parseRules({ checks: [{ id: 'fractional', selector: '.grid', metric: 'grid-column-count', expected: 1.5 }] }), /expected/);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(fixture);
    const sample = () => page.evaluate(({ source, config }) => {
      const inspect = (0, eval)(`(${source})`);
      return inspect({ action: 'sample', config });
    }, { source: inspectPage.toString(), config: parsed });
    const byId = (report, id) => report.checks.find((check) => check.id === id);

    const wide = await sample();
    assert.equal(byId(wide, 'wide-grid').actual, 3);
    assert.equal(byId(wide, 'wide-grid').status, 'pass');
    assert.equal(byId(wide, 'wrong-wide-grid').actual, 3);
    assert.equal(byId(wide, 'wrong-wide-grid').status, 'fail');
    assert.equal(byId(wide, 'narrow-grid'), undefined, 'the narrow-only rule is outside its width bounds');
    assert.equal(byId(wide, 'named-lines').actual, 3, 'named grid lines do not count as tracks');
    assert.equal(byId(wide, 'named-lines').status, 'pass');
    assert.equal(byId(wide, 'implicit-track').actual, 4, 'implicit columns are included in resolved tracks');
    assert.equal(byId(wide, 'implicit-track').status, 'pass');
    assert.equal(byId(wide, 'no-tracks').actual, 0, 'grid-template-columns:none resolves to zero tracks');
    assert.equal(byId(wide, 'no-tracks').status, 'pass');
    assert.equal(byId(wide, 'flex-columns').status, 'unavailable');
    assert.match(byId(wide, 'flex-columns').reason, /grid|flex/i);
    assert.equal(byId(wide, 'subgrid-columns').status, 'unavailable');
    assert.match(byId(wide, 'subgrid-columns').reason, /subgrid/i);

    await page.setViewportSize({ width: 360, height: 800 });
    const narrow = await sample();
    assert.equal(byId(narrow, 'wide-grid'), undefined, 'the desktop-only rule is outside its width bounds');
    assert.equal(byId(narrow, 'wrong-wide-grid'), undefined, 'the failing desktop-only rule is outside its width bounds');
    assert.equal(byId(narrow, 'narrow-grid').actual, 1);
    assert.equal(byId(narrow, 'narrow-grid').status, 'pass');
  } finally {
    await browser.close();
  }
});
