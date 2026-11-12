import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';

const skillDirectory = new URL('../', import.meta.url);
const cli = new URL('../scripts/agent.mjs', import.meta.url);

async function command(directory, ...args) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cli.pathname, ...args], {
      cwd: skillDirectory,
      env: { ...process.env, LAYOUT_WITNESS_SESSION: join(directory, 'agent.json') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (value) => { stdout += value; });
    child.stderr.setEncoding('utf8').on('data', (value) => { stderr += value; });
    child.once('error', rejectPromise);
    child.once('exit', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function openSocket(url, origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(url, { origin });
    socket.once('open', () => resolvePromise(socket));
    socket.once('error', rejectPromise);
  });
}

async function post(url, token, action, extra = {}) {
  return await fetch(new URL('/command', url), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  });
}

test('pairs one extension and streams guide control and measurements through CLI', { timeout: 12_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'layout-witness-agent-'));
  const sessionFile = join(directory, 'agent.json');
  const child = spawn(process.execPath, [cli.pathname, 'serve'], {
    env: { ...process.env, LAYOUT_WITNESS_SESSION: sessionFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (value) => { stdout += value; });
  child.stderr.setEncoding('utf8').on('data', (value) => { stderr += value; });
  let socket;

  try {
    const rulesFile = join(directory, 'rules.json');
    await writeFile(rulesFile, JSON.stringify({ checks: [], regions: [{ id: 'main', selector: 'main' }] }));
    for (let attempt = 0; attempt < 100 && !stdout.includes('ws://127.0.0.1:'); attempt++) await delay(30);
    const pairing = /ws:\/\/127\.0\.0\.1:(\d+)\/([a-f0-9]{64})/.exec(stdout);
    assert.ok(pairing, stdout + stderr);
    const session = JSON.parse(await readFile(sessionFile, 'utf8'));
    assert.equal(session.port, Number(pairing[1]));
    assert.equal(session.token, pairing[2]);
    assert.equal((await stat(sessionFile)).mode & 0o777, 0o600);
    const url = `http://127.0.0.1:${session.port}`;
    assert.deepEqual(await (await fetch(`${url}/health`, { headers: { authorization: `Bearer ${session.token}` } })).json(), { paired: false });
    assert.equal((await fetch(`${url}/health`)).status, 401);
    assert.equal((await post(url, session.token, 'status')).status, 503);

    const pairingUrl = `ws://127.0.0.1:${session.port}/${session.token}`;
    await assert.rejects(openSocket(pairingUrl, 'https://example.com'), /403/);
    await assert.rejects(openSocket(`ws://127.0.0.1:${session.port}/wrong-token`), /403/);
    socket = await openSocket(pairingUrl);
    await assert.rejects(openSocket(pairingUrl), /403/);
    const received = [];
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      received.push(message);
      const value = { origin: 'http://127.0.0.1:4173', report: { viewport: { width: 1440, height: 900 } } };
      socket.send(JSON.stringify({ id: message.id, value }));
    });

    for (const action of ['status', 'start', 'stop', 'pick', 'select', 'clear', 'defaults', 'import', 'disconnect', 'status']) {
      const args = action === 'select' ? ['#primary'] : action === 'import' ? [rulesFile] : [];
      const result = await command(directory, action, ...args);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).origin, 'http://127.0.0.1:4173');
    }
    const measure = await command(directory, 'measure');
    assert.equal(measure.code, 0, measure.stderr);
    assert.deepEqual(JSON.parse(measure.stdout), { viewport: { width: 1440, height: 900 } });
    assert.deepEqual(received.map(({ action }) => action), [
      'status', 'start', 'stop', 'pick', 'select', 'clear', 'defaults', 'import', 'disconnect', 'status', 'status',
    ]);
    assert.equal(received[4].selector, '#primary');

    socket.close();
    socket = undefined;
    const unpaired = await command(directory, 'status');
    assert.equal(unpaired.code, 1);
    assert.match(unpaired.stderr, /Pair the active browser tab/);
    const notRunning = await command(directory, 'serve');
    assert.equal(notRunning.code, 1);
    assert.match(notRunning.stderr, /already running/);
  } finally {
    socket?.close();
    const exit = new Promise((resolvePromise) => child.once('exit', resolvePromise));
    child.kill('SIGTERM');
    await exit;
    await rm(directory, { recursive: true, force: true });
  }
});
