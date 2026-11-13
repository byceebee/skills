import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { discoverLayout } from '../scripts/discover.mjs';

const html = `<!doctype html>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px sans-serif; }
  #page { width: 620px; padding: 16px; }
  #actions { display: flex; align-items: center; gap: 8px; }
  #actions button { width: 90px; height: 40px; }
  #actions button:nth-child(2) { margin-left: 14px; transform: translateY(9px); }
  #clip { width: 110px; height: 36px; overflow: hidden; white-space: nowrap; margin-top: 18px; }
  #scroll { width: 120px; overflow-x: auto; white-space: nowrap; margin-top: 18px; }
  #scroll span { display: inline-block; width: 90px; }
  #copy { width: 170px; margin-top: 18px; }
  #clean { display: flex; align-items: center; gap: 8px; margin-top: 18px; }
  #clean button { width: 80px; height: 36px; }
</style>
<main id="page">
  <section id="actions"><button>One</button><button>Two</button><button>Three</button></section>
  <div id="clip">A clipped label that cannot fit</div>
  <div id="scroll"><span>Scrollable filter one</span><span>Scrollable filter two</span></div>
  <p id="copy">A longer sentence that wraps onto multiple lines in this narrow content box.</p>
  <section id="clean"><button>Alpha</button><button>Beta</button><button>Gamma</button></section>
</main>`;

test('discovers bounded layout hints from rendered geometry and preserves intentional scroll', { timeout: 20000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    await page.setContent(html);
    const result = await page.evaluate(({ source, args }) => {
      const injected = (0, eval)(`(${source})`);
      return injected(args);
    }, { source: discoverLayout.toString(), args: { selector: '#page', tokens: { spacing: [4, 8, 12, 16, 24] } } });

    assert.equal(result.status, 'available');
    assert.ok(result.candidateCount <= 12);
    assert.equal(result.candidateCount, result.candidates.length);
    assert.ok(result.candidates.every(({ target, container, computed }) => target && container && computed));
    assert.ok(result.candidates.some(({ type, target, container }) => type === 'clipping' && target === '#clip' && container === '#clip'));
    const gap = result.candidates.find(({ type }) => type === 'uneven-gap');
    assert.ok(gap, 'reports a measurable uneven sibling gap');
    assert.equal(gap.container, '#actions');
    assert.equal(gap.actual.axis, 'x');
    assert.ok(Math.abs(gap.delta) > 4);
    assert.deepEqual(gap.tokenMatches, [{ value: 24, delta: 2 }], 'only matches explicitly supplied numeric spacing tokens');
    const alignment = result.candidates.find(({ type }) => type === 'alignment-outlier');
    assert.ok(alignment, 'reports a vertical alignment outlier in the same sibling group');
    assert.equal(alignment.container, '#actions');
    assert.equal(alignment.actual.axis, 'vertical');
    const wrapping = result.candidates.find(({ type }) => type === 'wrapping-text');
    assert.ok(wrapping, 'reports wrapping as a signal');
    assert.equal(wrapping.target, '#copy');
    assert.ok(wrapping.actual.lineCount > 1);
    assert.ok(!result.candidates.some(({ target }) => target.startsWith('#scroll')),
      'does not treat intentionally scrollable filter content as a clipping issue');
    assert.ok(!result.candidates.some(({ target }) => target.startsWith('#clean')),
      'does not flag the aligned, evenly spaced control group');
    assert.equal(JSON.stringify(result).includes('Scrollable filter one'), false, 'does not return page copy');

    const uniqueFailure = await page.evaluate(({ source }) => (0, eval)(`(${source})`)({ selector: 'button' }), { source: discoverLayout.toString() });
    assert.equal(uniqueFailure.status, 'unavailable');
    assert.equal(uniqueFailure.reason, 'multiple matches');
    assert.deepEqual(uniqueFailure.candidates, []);
  } finally {
    await browser.close();
  }
});
