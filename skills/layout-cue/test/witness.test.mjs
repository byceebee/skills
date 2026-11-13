import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { inspectPage } from '../scripts/measure.mjs';
import { parseRules } from '../scripts/rules.mjs';

const entry = fileURLToPath(new URL('../scripts/witness.mjs', import.meta.url));
const config = fileURLToPath(new URL('../examples/rules.json', import.meta.url));

function capture(url, directory, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, 'capture', url, '--config', config, '--out', directory, '--strict', ...args]);
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
}

test('validates responsive rule bounds and relative edge comparisons', () => {
  assert.throws(() => parseRules({ regions: [{ id: 'bad', selector: 'main', minWidth: 600, maxWidth: 300 }] }), /reversed/);
  assert.throws(() => parseRules({ checks: [{ id: 'bad', selector: 'main', metric: 'width', expected: 100, relativeTo: 'body' }] }), /same axis/);
  assert.throws(() => parseRules({ checks: [{ id: 'bad', selector: 'main', metric: 'left', expected: 0, relativeTo: 'body', relativeEdge: 'top' }] }), /same axis/);
  assert.throws(() => parseRules({ checks: [{ id: 'bad', selector: 'main', metric: 'left', expected: 0, relativeEdge: 'right' }] }), /requires relativeTo/);
  assert.throws(() => parseRules({ checks: [{ id: 'bad', selector: 'main', metric: 'width', expected: 100, tolerence: 1 }] }), /Unknown field/);
  assert.throws(() => parseRules({ checks: [{ id: 'bad', selector: 'main', metric: 'height', expected: 10, pathname: '' }] }), /pathname/);
  assert.throws(() => parseRules({ checks: [{ id: 'bad', selector: 'main', metric: 'height', expected: 10, whenVisible: '' }] }), /whenVisible/);
});

test('scopes checks to route and visible state, and measures clipped height against scrollports', { timeout: 20000 }, async () => {
  const server = createServer((request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end(`<style>body{margin:0}.scrollport{height:100px;overflow:auto}.target{height:40px;margin-top:80px}.target.clear{margin-top:20px}</style><main><button id="state" class="gate" hidden>Open</button><div class="scrollport"><div id="target" class="target">Target</div></div></main>`));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/edit`);
    const rules = parseRules({ checks: [
      { id: 'edit-clipped', selector: '#target', metric: 'clipped-height', expected: 0, tolerance: 0, pathname: '/edit', whenVisible: '.gate' },
      { id: 'missing-active-target', selector: '#missing', metric: 'visible-height', expected: 10, pathname: '/edit', whenVisible: '.gate' },
      { id: 'other-route', selector: '#target', metric: 'clipped-height', expected: 0, pathname: '/other', whenVisible: '.gate' },
    ] });
    const sample = async () => page.evaluate(({ source, config }) => (0, eval)(`(${source})`)({ action: 'sample', config }), { source: inspectPage.toString(), config: rules });
    let result = await sample();
    assert.equal(result.checks.find(({ id }) => id === 'edit-clipped').status, 'skipped');
    assert.equal(result.checks.find(({ id }) => id === 'other-route').status, 'skipped');

    await page.locator('#state').evaluate(node => { node.hidden = false; });
    result = await sample();
    assert.equal(result.checks.find(({ id }) => id === 'missing-active-target').status, 'unavailable');
    let clipped = result.checks.find(({ id }) => id === 'edit-clipped');
    assert.equal(clipped.actual, 20);
    assert.equal(clipped.status, 'fail');
    assert.equal(result.checks.find(({ id }) => id === 'other-route').status, 'skipped');

    await page.locator('#state').evaluate(node => node.after(node.cloneNode()));
    result = await sample();
    assert.equal(result.checks.find(({ id }) => id === 'edit-clipped').status, 'unavailable');
    assert.match(result.checks.find(({ id }) => id === 'edit-clipped').reason, /multiple visible/);
    await page.locator('#state + button').evaluate(node => node.remove());

    await page.locator('#target').evaluate(node => node.classList.add('clear'));
    result = await sample();
    clipped = result.checks.find(({ id }) => id === 'edit-clipped');
    assert.equal(clipped.actual, 0);
    assert.equal(clipped.status, 'pass');
    assert.equal(result.checks.find(({ id }) => id === 'missing-active-target').status, 'unavailable');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('compares distinct source and target edges with durable 28 fail / 12 pass evidence', { timeout: 20000 }, async () => {
  const checks = [];
  const nodes = [];
  for (let index = 0; index < 40; index += 1) {
    const x = index * 40;
    const offset = index < 28 ? 8 : 0;
    nodes.push(`<i id="from-${index}" style="left:${x}px"></i><i id="to-${index}" style="left:${x + offset}px"></i>`);
    checks.push({ id: `edge-${index}`, selector: `#to-${index}`, metric: 'left', relativeTo: `#from-${index}`, expected: 0, tolerance: 1 });
  }
  checks.push({ id: 'center-from-right', selector: '#center-target', metric: 'center-x', relativeTo: '#center-source', relativeEdge: 'right', expected: 10, tolerance: 0 });
  const parsed = parseRules({ checks });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 300 } });
    await page.setContent(`<style>i{position:absolute;top:20px;width:20px;height:20px}#center-source{left:0}#center-target{left:20px}</style>${nodes.join('')}<i id="center-source"></i><i id="center-target"></i>`);
    const result = await page.evaluate(({ source, config }) => (0, eval)(`(${source})`)({ action: 'sample', config }), { source: inspectPage.toString(), config: parsed });
    const comparisons = result.checks.filter(({ id }) => id.startsWith('edge-'));
    assert.equal(comparisons.filter(({ status }) => status === 'fail').length, 28);
    assert.equal(comparisons.filter(({ status }) => status === 'pass').length, 12);
    assert.equal(comparisons[0].actual, 8);
    assert.equal(comparisons[0].relativeTo, '#from-0');
    assert.equal(comparisons[0].relativeEdge, 'left');
    assert.equal(comparisons[0].tolerance, 1);
    assert.equal(result.checks.find(({ id }) => id === 'center-from-right').actual, 10);
  } finally {
    await browser.close();
  }
});

test('captures a real responsive page and fails strict review after a geometry regression', { timeout: 30000 }, async () => {
  const demo = await readFile(new URL('../examples/demo.html', import.meta.url), 'utf8');
  let html = demo;
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(html);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const directory = await mkdtemp(join(tmpdir(), 'witness-test-'));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const passing = await capture(url, join(directory, 'pass'));
    assert.equal(passing.code, 0, passing.output);
    const summary = JSON.parse(await readFile(join(directory, 'pass', 'summary.json'), 'utf8'));
    assert.equal(summary.results.length, 4);
    assert.ok(summary.results.every((result) => result.pass >= 6 && !result.unavailableRegions));
    assert.ok((await readFile(join(directory, 'pass', '390-dark', 'overlay.png'))).length > 1000);
    const mobile = JSON.parse(await readFile(join(directory, 'pass', '390-dark', 'layout.json'), 'utf8'));
    assert.ok(!mobile.regions.some(({ id }) => id === 'sidebar-band'));
    html = demo.replace('240px minmax(0, 1fr)', '260px minmax(0, 1fr)');
    assert.notEqual(html, demo);
    const failing = await capture(url, join(directory, 'fail'), '--width', '1440', '--theme', 'light');
    assert.equal(failing.code, 1, failing.output);
    const report = JSON.parse(await readFile(join(directory, 'fail', '1440-light', 'layout.json'), 'utf8'));
    assert.equal(report.checks.find(({ id }) => id === 'desktop-sidebar-width').actual, 260);
    assert.equal(report.checks.find(({ id }) => id === 'desktop-sidebar-width').status, 'fail');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
