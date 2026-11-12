import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
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
  assert.throws(() => parseRules({ checks: [{ id: 'bad', selector: 'main', metric: 'width', expected: 100, relativeTo: 'body' }] }), /box edge/);
  assert.throws(() => parseRules({ checks: [{ id: 'bad', selector: 'main', metric: 'width', expected: 100, tolerence: 1 }] }), /Unknown field/);
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
