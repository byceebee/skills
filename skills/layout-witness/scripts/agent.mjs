#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { WebSocket, WebSocketServer } from 'ws';

const defaultSessionFile = resolve(homedir(), '.layout-witness', 'agent.json');
const sessionFile = resolve(process.env.LAYOUT_WITNESS_SESSION ?? defaultSessionFile);
const allowedActions = new Set([
  'status', 'start', 'stop', 'measure', 'pick', 'select', 'clear', 'import', 'defaults', 'disconnect',
]);
const payloadLimit = 256 * 1024;
const responseTimeoutMs = 30_000;
const help = `Usage:
  node scripts/agent.mjs serve
  node scripts/agent.mjs status|start|stop|measure|pick|clear|defaults|disconnect
  node scripts/agent.mjs select <css-selector>
  node scripts/agent.mjs import <rules.json>`;

function fail(message) {
  throw new Error(message);
}

function parseArguments(args) {
  const [command, ...rest] = args;
  if (!command || !allowedActions.has(command) && command !== 'serve') fail(help);
  if (command === 'select' && rest.length !== 1) fail('select needs one CSS selector.');
  if (command === 'import' && rest.length !== 1) fail('import needs one rules file.');
  if (!['select', 'import'].includes(command) && rest.length) fail(`${command} takes no arguments.`);
  return { command, argument: rest[0] };
}

async function sendCommand(command, argument) {
  let session;
  try {
    session = JSON.parse(await readFile(sessionFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') fail('Layout Witness agent is not running. Start it with `node scripts/agent.mjs serve`.');
    fail(`Cannot read the Layout Witness agent session: ${error.message}`);
  }

  if (!Number.isInteger(session?.port) || session.port < 1 || session.port > 65535 ||
      typeof session.token !== 'string' || !/^[a-f0-9]{64}$/.test(session.token)) {
    fail('Invalid Layout Witness session. Restart the local agent server.');
  }

  let rules;
  let label;
  if (command === 'import') {
    const rulesPath = resolve(argument);
    const file = await stat(rulesPath);
    if (file.size > payloadLimit) fail('Use a rules file smaller than 256 KB.');
    try {
      rules = JSON.parse(await readFile(rulesPath, 'utf8'));
    } catch (error) {
      fail(`Cannot read a valid JSON rules file: ${error.message}`);
    }
    label = rulesPath.split(/[\\/]/).at(-1);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), responseTimeoutMs + 2_000);
  try {
    const response = await fetch(`http://127.0.0.1:${session.port}/command`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: command,
        ...(command === 'select' ? { selector: argument } : {}),
        ...(command === 'import' ? { rules, label } : {}),
      }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) fail(result.error ?? `Agent command failed with HTTP ${response.status}.`);

    if (command === 'measure') {
      if (!result.report) fail('Layout guides are off. Run `node scripts/agent.mjs start` before measuring.');
      process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (error.name === 'AbortError') fail('The browser extension did not respond within 30 seconds. Check its pairing in the Layout Witness popup.');
    if (error.cause?.code === 'ECONNREFUSED') fail('Layout Witness agent is not running. Start it with `node scripts/agent.mjs serve`.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readRequest(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > payloadLimit) fail('Request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function serve() {
  const secret = randomBytes(32).toString('hex');
  const lockPath = `${sessionFile}.lock`;
  await mkdir(dirname(sessionFile), { recursive: true, mode: 0o700 });

  let lock;
  try {
    lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner;
    try { owner = JSON.parse(await readFile(lockPath, 'utf8')); } catch {
      const lockAge = Date.now() - (await stat(lockPath)).mtimeMs;
      if (lockAge < 5_000) fail('A Layout Witness agent process is starting. Retry in a moment.');
    }
    if (Number.isInteger(owner?.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0);
        fail('A Layout Witness agent process is already running. Use its pairing URL or stop it first.');
      } catch (probeError) {
        if (probeError.code === 'EPERM') fail('A Layout Witness agent process is already running.');
        if (probeError.code !== 'ESRCH') throw probeError;
      }
    }
    await rm(lockPath, { force: true });
    lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  await lock.close();

  let browser;
  const pending = new Map();
  let requestId = 0;
  let shuttingDown = false;
  const http = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::ffff:127.0.0.1') {
      response.writeHead(403).end();
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      if (request.headers.authorization !== `Bearer ${secret}`) {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ paired: browser?.readyState === WebSocket.OPEN }));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/command' || origin) {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${secret}`) {
      response.writeHead(401).end(JSON.stringify({ error: 'Agent authentication failed.' }));
      return;
    }
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
      response.writeHead(415).end(JSON.stringify({ error: 'Expected a JSON command.' }));
      return;
    }
    if (!browser || browser.readyState !== WebSocket.OPEN) {
      response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Pair the active browser tab from the Layout Witness popup.' }));
      return;
    }

    try {
      const message = JSON.parse(await readRequest(request));
      if (!message || typeof message !== 'object' || Array.isArray(message) || !allowedActions.has(message.action)) {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Unknown agent action.' }));
        return;
      }
      if (message.action === 'select' && (typeof message.selector !== 'string' || !message.selector.trim() || message.selector.length > 2_000)) {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'select needs a nonempty CSS selector under 2,000 characters.' }));
        return;
      }

      const id = String(++requestId);
      const pendingCommand = new Promise((resolvePromise, rejectPromise) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          rejectPromise(new Error('The extension did not reply within 30 seconds.'));
        }, responseTimeoutMs);
        pending.set(id, {
          resolve(value) { clearTimeout(timeout); resolvePromise(value); },
          reject(error) { clearTimeout(timeout); rejectPromise(error); },
        });
      });
      browser.send(JSON.stringify({ ...message, action: message.action === 'measure' ? 'status' : message.action, id }));
      const result = await pendingCommand;
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      const code = error.message === 'Request is too large.' ? 413 : 400;
      response.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }));
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: payloadLimit, perMessageDeflate: false });
  http.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin ?? '';
    const authorizedOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    if (request.url !== `/${secret}` || !authorizedOrigin || browser) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
  });

  wss.on('connection', (client) => {
    browser = client;
    client.on('message', (data) => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message?.type === 'ping') {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (!message || typeof message !== 'object' || typeof message.id !== 'string') return;
      const operation = pending.get(message.id);
      if (!operation) return;
      pending.delete(message.id);
      if ('error' in message) operation.reject(new Error(String(message.error).slice(0, 1_000)));
      else operation.resolve(message.value);
    });
    client.on('close', () => {
      if (browser !== client) return;
      browser = undefined;
      for (const operation of pending.values()) operation.reject(new Error('The Layout Witness popup disconnected. Pair the tab again.'));
      pending.clear();
    });
    client.on('error', () => {});
  });

  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    browser?.terminate();
    for (const operation of pending.values()) operation.reject(new Error('The Layout Witness agent stopped.'));
    pending.clear();
    await new Promise((resolvePromise) => http.close(resolvePromise));
    wss.close();
    await rm(sessionFile, { force: true });
    await rm(lockPath, { force: true });
  };
  process.once('SIGINT', () => void cleanup().then(() => process.exit(0)));
  process.once('SIGTERM', () => void cleanup().then(() => process.exit(0)));

  await new Promise((resolvePromise, rejectPromise) => {
    http.once('error', rejectPromise);
    http.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = http.address();
  await rm(sessionFile, { force: true });
  await writeFile(sessionFile, `${JSON.stringify({ port, token: secret })}\n`, { mode: 0o600, flag: 'wx' });
  console.log(`Pair Layout Witness in its popup: ws://127.0.0.1:${port}/${secret}`);
  console.log('Agent is listening on 127.0.0.1. Press Ctrl+C to stop.');
}

try {
  const { command, argument } = parseArguments(process.argv.slice(2));
  if (command === 'serve') await serve();
  else await sendCommand(command, argument);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
