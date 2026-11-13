import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const skillDirectory = fileURLToPath(new URL('../', import.meta.url));
const overlay = '[data-layout-witness]';

async function downloadReport(popup) {
  const event = popup.waitForEvent('download');
  await popup.getByRole('button', { name: 'Download report' }).click();
  const download = await event;
  assert.equal(download.suggestedFilename(), 'layout-cue.json');
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
    await popup.getByText('12 columns · Default', { exact: true }).waitFor();

    const gridRules = {
      regions: [{ id: 'custom-desktop-grid', selector: 'main', columns: 10, minWidth: 1024 }],
      checks: [{ id: 'page-overflow', selector: 'html', metric: 'horizontal-overflow', expected: 0 }],
    };
    async function importGridRules(rules) {
      await popup.locator('#rules-file').setInputFiles({
        name: 'responsive-grid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rules)),
      });
    }
    await importGridRules({ checks: gridRules.checks });
    await popup.getByText('1 passed · 0 failed · 0 unavailable').waitFor();
    assert.deepEqual((await downloadReport(popup)).grids, [{ id: 'main-wide', columns: 12, source: 'default' }]);

    await importGridRules(gridRules);
    await popup.getByText('10 columns · Custom', { exact: true }).waitFor();
    for (const [width, columns] of [[1023, 8], [640, 8], [639, 4], [320, 4]]) {
      await page.setViewportSize({ width, height: 844 });
      const report = await downloadReport(popup);
      assert.deepEqual(report.grids.map(({ columns, source }) => [columns, source]), [[columns, 'default']]);
      assert.equal(report.checks[0].status, 'pass');
    }
    await popup.getByText('4 columns · Default', { exact: true }).waitFor();
    const mobileScreenshots = process.env.LAYOUT_WITNESS_TEST_SCREENSHOTS;
    if (mobileScreenshots) {
      await page.screenshot({ path: join(mobileScreenshots, 'compact-default-grid.png') });
      await popup.locator('main').screenshot({ path: join(mobileScreenshots, 'compact-default-popup.png') });
    }
    await page.setViewportSize({ width: 1440, height: 900 });

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

test('popup comparison picker previews and pins a two-element gap', { timeout: 30000 }, async () => {
  const fixture = await readFile(join(skillDirectory, 'examples/demo.html'), 'utf8');
  const manifest = JSON.parse(await readFile(join(skillDirectory, 'manifest.json'), 'utf8'));
  assert.ok(!manifest.host_permissions && !manifest.optional_host_permissions);
  const server = createServer((request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end(fixture));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let context;
  try {
    const { port } = server.address();
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium', viewport: { width: 360, height: 812 },
      args: [`--disable-extensions-except=${skillDirectory}`, `--load-extension=${skillDirectory}`],
    });
    const page = context.pages()[0];
    const origin = `http://127.0.0.1:${port}`;
    await page.goto(origin);
    await page.locator('#demo-edit-open').click();
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extension = new URL(worker.url());
    const cdp = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const { targetId } = targetInfos.find(target => target.url === page.url());
    await cdp.send('Extensions.triggerAction', { id: extension.host, targetId });

    async function openPopup() {
      const popup = await context.newPage();
      await page.bringToFront();
      await popup.goto(new URL('/extension/popup.html', extension).href);
      return popup;
    }
    let popup = await openPopup();
    await popup.getByRole('button', { name: 'Start guides' }).click();
    await popup.getByRole('button', { name: 'Compare spacing' }).click();
    await page.locator('[data-layout-witness-element]').waitFor();
    await page.locator('#demo-edit-name').click();
    const second = page.locator('#demo-edit-owner');
    const bounds = await second.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    if (process.env.LAYOUT_WITNESS_TEST_SCREENSHOTS) {
      await page.screenshot({ path: join(process.env.LAYOUT_WITNESS_TEST_SCREENSHOTS, 'manual-comparison-preview.png') });
    }
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.locator('[data-layout-cue-focus]').waitFor();
    if (popup.isClosed()) popup = await openPopup();
    await popup.getByRole('heading', { name: 'Live comparison' }).waitFor();
    const report = await downloadReport(popup);
    assert.deepEqual(report.comparison.measurements.map(({ actual, drawn }) => [actual, drawn]), [[52, true]]);
    assert.equal(report.comparison.measurements[0].fromSelector, '#demo-edit-name');
    assert.equal(report.comparison.measurements[0].toSelector, '#demo-edit-owner');
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('agent controls the granted tab and measures an existing selection without downloading', { timeout: 30000 }, async () => {
  const demo = await readFile(join(skillDirectory, 'examples/demo.html'), 'utf8');
  const directory = await mkdtemp(join(tmpdir(), 'layout-witness-browser-'));
  const script = join(skillDirectory, 'scripts/agent.mjs');
  const env = { ...process.env, LAYOUT_WITNESS_SESSION: join(directory, 'session.json') };
  const broker = spawn(process.execPath, [script, 'serve'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const run = promisify(execFile);
  const command = async (...args) => JSON.parse((await run(process.execPath, [script, ...args], { env })).stdout);
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(
      request.url === '/demo' ? demo : request.url === '/other'
        ? '<!doctype html><h1>Sign in</h1><input id="email">'
        : '<!doctype html><header>Example</header><main><button id="item" style="padding: 8px">Open</button><button>Close</button></main>',
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  let context;
  try {
    let output = '';
    let pairing;
    for await (const chunk of broker.stdout) {
      output += chunk;
      pairing = output.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}/)?.[0];
      if (pairing) break;
    }
    assert.ok(pairing);
    const url = `http://127.0.0.1:${server.address().port}/`;
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      acceptDownloads: false,
      args: [`--disable-extensions-except=${skillDirectory}`, `--load-extension=${skillDirectory}`],
    });
    const page = context.pages()[0];
    await page.goto(url);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extension = new URL(worker.url());
    const cdp = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const { targetId } = targetInfos.find(target => target.url === url);
    await cdp.send('Extensions.triggerAction', { id: extension.host, targetId });
    const popup = await context.newPage();
    let downloads = 0;
    for (const tab of [page, popup]) tab.on('download', () => downloads++);
    await page.bringToFront();
    await popup.goto(new URL('/extension/popup.html', extension).href);
    await popup.getByText('Agent access').click();
    await popup.getByLabel('Pairing URL').fill(pairing);
    await popup.getByRole('button', { name: 'Connect agent', exact: true }).click();
    await popup.getByText('Connected to this tab', { exact: true }).waitFor();
    await popup.close();

    assert.equal((await command('status')).report, null);
    await page.evaluate(() => {
      const orphan = document.createElement('div');
      orphan.setAttribute('data-layout-witness-element', '');
      document.documentElement.append(orphan);
    });
    const started = (await command('start')).report;
    assert.ok(started.element?.box.width > 0, 'Start must include an atomic ruler');
    assert.equal(await page.locator(overlay).count(), 1);
    assert.equal(await page.locator('[data-layout-witness-element]').count(), 1);
    const before = (await command('start', '#item')).report;
    assert.equal(before.element.padding.left, '8px');
    await page.bringToFront();
    const screenshot = join(directory, 'ruler.jpg');
    const evidence = await command('capture', screenshot);
    assert.equal(evidence.selector, '#item');
    assert.equal((await readFile(screenshot)).subarray(0, 3).toString('hex'), 'ffd8ff');
    assert.equal(JSON.parse(await readFile(join(directory, 'ruler.json'), 'utf8')).element.selector, '#item');
    await assert.rejects(command('select', 'button'), /exactly one visible element/);
    await assert.rejects(command('select', '['), /valid CSS selector/);
    await page.evaluate(() => { window.witnessGuide = document.querySelector('[data-layout-witness-element]'); });
    await page.addStyleTag({ content: '#item { padding-left: 12px !important; }' });
    const after = await command('measure');
    assert.equal(after.element.selector, before.element.selector);
    assert.equal(after.element.padding.left, '12px');
    assert.equal(await page.evaluate(() => window.witnessGuide === document.querySelector('[data-layout-witness-element]')), true);

    await command('clear');
    assert.equal((await command('measure')).element, undefined);
    await assert.rejects(command('capture', join(directory, 'without-ruler.jpg')), /Select an element/);
    await command('stop');
    await page.locator(overlay).waitFor({ state: 'detached' });
    await assert.rejects(command('measure'), /guides are off/);
    await command('start');
    await command('select', '#item');
    await page.reload();
    await page.locator('[data-layout-witness-element]').waitFor();
    assert.equal((await command('measure')).element.selector, '#item');
    await page.goto(new URL('/other', url).href);
    await page.locator('[data-layout-witness-element]').waitFor();
    const noMain = await command('measure');
    assert.ok(noMain.element?.box.width > 0);
    assert.ok(noMain.regions.some(region => region.id === 'viewport-grid' && region.columns > 0));
    await command('navigate', '/demo');
    await page.locator('#demo-edit-open').waitFor();
    await page.setViewportSize({ width: 360, height: 812 });
    const demoRules = join(directory, 'demo-checks.json');
    const { checks } = JSON.parse(await readFile(join(skillDirectory, 'examples/rules.json'), 'utf8'));
    await writeFile(demoRules, JSON.stringify({ checks }));
    await command('import', demoRules);
    await command('click', '#demo-edit-open');
    const fields = '#demo-edit-fields > label';
    const selectors = [1, 2, 3].map(index => `${fields}:nth-of-type(${index})`);
    await assert.rejects(command('compare', 'right', 'top', ...selectors), /same axis/);
    await assert.rejects(command('compare', 'bottom', 'top', fields, selectors[0]), /distinct visible/);
    const screenshots = process.env.LAYOUT_WITNESS_TEST_SCREENSHOTS;
    if (screenshots) {
      await command('stop');
      await command('capture-clean', join(screenshots, 'comparison-before-clean.jpg'));
      await command('start');
    }
    await command('compare', 'bottom', 'top', ...selectors, '--focus');
    await command('save-check', 'edit-field-gap', '12', '1', '320', '360');
    await assert.rejects(command('save-check', 'edit-field-gap', '12'), /Duplicate/);
    const comparisonBefore = await command('measure');
    const gapChecks = report => report.checks.filter(check => check.id.startsWith('edit-field-gap-'));
    assert.deepEqual(gapChecks(comparisonBefore).map(check => check.status), ['fail', 'fail']);
    assert.deepEqual(comparisonBefore.grids.map(grid => grid.columns), [4]);
    assert.equal(comparisonBefore.comparison.focused, true);
    assert.ok(comparisonBefore.checks.length > 0, 'Focus mode preserves active checks');
    assert.deepEqual(comparisonBefore.comparison.measurements.map(({ actual, drawn }) => [actual, drawn]), [[28, true], [28, true]]);
    assert.equal(await page.locator(overlay).evaluate(el => getComputedStyle(el).visibility), 'hidden');
    await page.evaluate(() => { window.comparisonGuide = document.querySelector('[data-layout-witness-element]'); });
    if (screenshots) {
      await delay(1050);
      await command('capture', join(screenshots, 'comparison-before.jpg'));
    }
    await page.locator('#demo-edit-dialog').evaluate(el => el.style.setProperty('--demo-edit-gap', '12px'));
    const comparisonAfter = await command('measure');
    assert.deepEqual(comparisonAfter.comparison.measurements.map(({ actual }) => actual), [12, 12]);
    assert.deepEqual(gapChecks(comparisonAfter).map(check => check.status), ['pass', 'pass']);
    assert.deepEqual(comparisonAfter.comparison.measurements.map(({ check }) => check.status), ['pass', 'pass']);
    assert.equal(await page.evaluate(() => window.comparisonGuide === document.querySelector('[data-layout-witness-element]')), true);
    if (screenshots) await command('capture', join(screenshots, 'comparison-after.jpg'));
    await page.emulateMedia({ colorScheme: 'dark' });
    if (screenshots) {
      // Chrome permits only two captureVisibleTab calls per second.
      await delay(1050);
      await command('capture', join(screenshots, 'comparison-dark.jpg'));
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await command('select', '#demo-edit-save');
    const clippingStyle = await page.addStyleTag({ content: '#demo-edit-dialog { max-height: 354px; }' });
    const clipped = (await command('measure')).element.clipping;
    assert.equal(clipped.status, 'partial');
    assert.ok(clipped.clipped.bottom > 0);
    assert.ok(clipped.sources.some(source => source.selector === '#demo-edit-dialog'));
    if (screenshots) {
      await delay(1050);
      await command('capture', join(screenshots, 'clipping-before.jpg'));
    }
    await page.locator('#demo-edit-save').focus();
    assert.equal((await command('measure')).element.clipping.status, 'inside');
    await page.setViewportSize({ width: 320, height: 812 });
    await page.locator('#demo-edit-dialog').evaluate(el => { el.scrollTop = 0; });
    const compact = await command('measure');
    assert.equal(compact.viewport.width, 320);
    assert.equal(compact.element.clipping.status, 'partial');
    assert.equal(gapChecks(compact).length, 2);
    await page.setViewportSize({ width: 360, height: 812 });
    await clippingStyle.evaluate(style => style.remove());
    await page.locator('#demo-edit-name').focus();
    if (screenshots) await command('capture', join(screenshots, 'clipping-after.jpg'));
    const parent = await command('related', 'parent');
    assert.equal(parent.report.element.selector, '#demo-edit-actions');
    assert.equal(parent.report.comparison, undefined);
    assert.equal(await page.locator(overlay).evaluate(el => getComputedStyle(el).visibility), 'visible');
    await command('compare', 'left', 'left', selectors[0], selectors[1]);
    assert.equal((await command('measure')).comparison.measurements[0].actual, 0);
    await command('stop');
    if (screenshots) {
      await delay(1050);
      await command('capture-clean', join(screenshots, 'comparison-clean.jpg'));
      await page.setViewportSize({ width: 1440, height: 900 });
      await command('start');
      await command('compare', 'bottom', 'top', ...selectors, '--focus');
      assert.equal(gapChecks(await command('measure')).length, 0);
      await delay(1050);
      await command('capture', join(screenshots, 'comparison-desktop.jpg'));
      const reportPopup = await context.newPage();
      await page.bringToFront();
      await reportPopup.goto(new URL('/extension/popup.html', extension).href);
      await reportPopup.getByRole('heading', { name: 'Live comparison' }).waitFor();
      await reportPopup.locator('main').screenshot({ path: join(screenshots, 'comparison-popup.png') });
      await reportPopup.close();
    }

    await page.setViewportSize({ width: 360, height: 812 });
    await page.reload();
    await page.locator('#demo-edit-open').waitFor();
    await command('click', '#demo-edit-open');
    await command('start');
    const savedAfterReload = await command('measure');
    assert.deepEqual(gapChecks(savedAfterReload).map(({ actual, status }) => [actual, status]), [[28, 'fail'], [28, 'fail']]);
    await page.goto(url.replace('127.0.0.1', 'localhost'));
    await assert.rejects(command('status'), /pair/i);
    assert.equal(downloads, 0);
  } finally {
    await context?.close();
    if (broker.exitCode === null) {
      const exited = once(broker, 'exit');
      broker.kill('SIGTERM');
      await exited;
    }
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
