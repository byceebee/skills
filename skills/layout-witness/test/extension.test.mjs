import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const skillDirectory = fileURLToPath(new URL('../', import.meta.url));
const overlay = '[data-layout-witness]';

async function downloadReport(popup) {
  const event = popup.waitForEvent('download');
  await popup.getByRole('button', { name: 'Download report' }).click();
  const download = await event;
  assert.equal(download.suggestedFilename(), 'layout-witness.json');
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

test('inspects the existing tab and restores its guides only on the same origin', { timeout: 35000 }, async () => {
  const fixture = await readFile(join(skillDirectory, 'examples/demo.html'), 'utf8');
  const manifest = JSON.parse(await readFile(join(skillDirectory, 'manifest.json'), 'utf8'));
  assert.ok(!manifest.host_permissions && !manifest.optional_host_permissions);
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(fixture);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  let context;
  try {
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}`;
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${skillDirectory}`, `--load-extension=${skillDirectory}`],
    });
    const page = context.pages()[0];
    await page.goto(origin);
    await page.evaluate(() => { sessionStorage.setItem('fixture-session', 'existing'); });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionUrl = new URL(worker.url());
    const cdp = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const { targetId } = targetInfos.find((target) => target.url === page.url());
    await cdp.send('Extensions.triggerAction', { id: extensionUrl.host, targetId });

    // Drive the popup document in a regular extension tab. TriggerAction above supplies
    // the real toolbar grant, while keeping the fixture as the selected tab for initialization.
    async function openPopupDocument() {
      const document = await context.newPage();
      await page.bringToFront();
      await document.goto(new URL('/extension/popup.html', extensionUrl).href);
      return document;
    }
    let popup = await openPopupDocument();
    await popup.getByRole('button', { name: 'Start guides' }).click();
    await page.locator(overlay).waitFor();
    assert.match(await popup.locator('#summary').textContent(), /visible guides/);

    await popup.locator('#rules-file').setInputFiles(join(skillDirectory, 'examples/rules.json'));
    await popup.getByText('Rules saved for this site.').waitFor();
    const check = (report) => report.checks.find(({ id }) => id === 'desktop-sidebar-width');
    assert.equal(check(await downloadReport(popup)).status, 'pass');

    const changedStyle = await page.addStyleTag({ content: '.app-layout { grid-template-columns: 260px minmax(0, 1fr); }' });
    await popup.getByText('260 px measured, 240 px expected').first().waitFor();
    const changed = check(await downloadReport(popup));
    assert.equal(changed.actual, 260);
    assert.equal(changed.status, 'fail');

    const screenshots = process.env.LAYOUT_WITNESS_TEST_SCREENSHOTS;
    if (screenshots) {
      await page.screenshot({ path: join(screenshots, 'desktop-overlay.png') });
      await popup.locator('main').screenshot({ path: join(screenshots, 'popup-light.png') });
      await popup.emulateMedia({ colorScheme: 'dark' });
      await popup.locator('main').screenshot({ path: join(screenshots, 'popup-dark.png') });
    }

    await page.evaluate(() => {
      const action = document.createElement('button');
      action.id = 'fixture-action';
      action.style.cssText = 'padding: 8px 12px; line-height: 20px; margin: 4px;';
      action.innerHTML = 'Open <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8h12" stroke="currentColor" stroke-width="2"/></svg>';
      action.onclick = () => { action.dataset.activated = 'true'; };
      document.querySelector('main').prepend(action);
    });
    await popup.getByRole('button', { name: 'Inspect element' }).click();
    await page.locator('[data-layout-witness-element]').waitFor();
    const fixtureAction = page.locator('#fixture-action');
    await fixtureAction.focus();
    await page.keyboard.press('Enter');
    assert.equal(await fixtureAction.getAttribute('data-activated'), null);
    if (popup.isClosed()) popup = await openPopupDocument();
    await popup.getByText('#fixture-action', { exact: true }).waitFor();
    const atomic = (await downloadReport(popup)).element;
    assert.equal(atomic.selector, '#fixture-action');
    assert.equal(atomic.padding.left, '12px');
    assert.equal(atomic.margin.top, '4px');
    assert.equal(atomic.typography.lineHeight, '20px');
    assert.equal(atomic.svg.rendered.width, 16);
    assert.deepEqual(atomic.svg.strokeWidths, ['2px']);
    if (screenshots) {
      await page.screenshot({ path: join(screenshots, 'atomic-button.png') });
      await popup.emulateMedia({ colorScheme: 'dark' });
      await popup.locator('main').screenshot({ path: join(screenshots, 'popup-element.png') });
      await popup.getByRole('button', { name: 'SVG', exact: true }).click();
      await popup.locator('main').screenshot({ path: join(screenshots, 'popup-svg.png') });
    }

    await popup.getByRole('button', { name: 'Clear' }).click();
    await page.locator('[data-layout-witness-element]').waitFor({ state: 'detached' });
    await popup.getByRole('button', { name: 'Inspect element' }).click();
    await page.locator('[data-layout-witness-element]').waitFor();
    await fixtureAction.click({ position: { x: 5, y: 5 } });
    assert.equal(await fixtureAction.getAttribute('data-activated'), null);
    if (popup.isClosed()) popup = await openPopupDocument();
    await popup.getByText('#fixture-action', { exact: true }).waitFor();
    assert.equal((await downloadReport(popup)).element.selector, '#fixture-action');
    await fixtureAction.evaluate(button => { button.style.paddingLeft = '16px'; });
    assert.equal((await downloadReport(popup)).element.padding.left, '16px');

    await popup.getByRole('button', { name: 'Inspect element' }).click();
    await page.locator('[data-layout-witness-element]').waitFor();
    await page.locator('.page-heading').click();
    if (popup.isClosed()) popup = await openPopupDocument();
    await popup.getByText('Selected element').waitFor();
    const heading = (await downloadReport(popup)).element;
    assert.equal(heading.tag, 'h1');
    if (screenshots) await page.screenshot({ path: join(screenshots, 'atomic-heading.png') });

    await changedStyle.evaluate((style) => style.remove());
    const restored = await downloadReport(popup);
    assert.equal(check(restored).status, 'pass');
    assert.equal(restored.element.selector, heading.selector);
    await page.reload();
    await page.locator(overlay).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('fixture-session')), 'existing');
    assert.equal(check(await downloadReport(popup)).status, 'pass');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    const mobile = await downloadReport(popup);
    assert.deepEqual(mobile.viewport, { width: 390, height: 844 });
    assert.equal(mobile.theme, 'dark');
    assert.equal(check(mobile), undefined);
    if (screenshots) {
      await page.screenshot({ path: join(screenshots, 'mobile-overlay.png') });
      await popup.locator('main').screenshot({ path: join(screenshots, 'popup-mobile-report.png') });
    }

    await popup.getByRole('button', { name: 'Stop guides' }).click();
    await page.locator(overlay).waitFor({ state: 'detached' });
    await popup.getByRole('button', { name: 'Start guides' }).click();
    await page.locator(overlay).waitFor();
    await page.goto(`http://localhost:${port}`);
    await page.waitForLoadState('load');
    const session = await worker.evaluate(async () => chrome.storage.session.get(null));
    assert.deepEqual(session, {});
    assert.equal(await page.locator(overlay).count(), 0);
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
