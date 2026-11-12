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
    const popup = await context.newPage();
    await page.bringToFront();
    await popup.goto(new URL('/extension/popup.html', extensionUrl).href);
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

    await changedStyle.evaluate((style) => style.remove());
    assert.equal(check(await downloadReport(popup)).status, 'pass');
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
