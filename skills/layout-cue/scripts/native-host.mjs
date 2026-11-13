#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const hostName = 'com.byceebee.layout_witness';
const sessionFile = resolve(process.env.LAYOUT_WITNESS_NATIVE_SESSION ?? resolve(homedir(), '.layout-witness', 'native-agent.json'));
const lockPath = `${sessionFile}.lock`;
const maxRequestBytes = 256 * 1024;
const maxNativeMessageBytes = 8 * 1024 * 1024;
const responseTimeoutMs = 30_000;
const pending = new Map();
let nextRequestId = 0;
let inputBuffer = Buffer.alloc(0);
let sessionSecret;
let server;
let ownsLock = false;
let shuttingDown = false;

function writeNativeMessage(value) {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > maxNativeMessageBytes) throw new Error('Native message exceeds 8 MB.');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
}

function readNativeMessages(chunk) {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (inputBuffer.length >= 4) {
    const length = inputBuffer.readUInt32LE(0);
    if (!length || length > maxNativeMessageBytes) throw new Error('Invalid native message length.');
    if (inputBuffer.length < length + 4) return;
    const body = inputBuffer.subarray(4, length + 4);
    inputBuffer = inputBuffer.subarray(length + 4);
    let message;
    try { message = JSON.parse(body.toString('utf8')); } catch { continue; }
    if (message?.type === 'ping') {
      writeNativeMessage({ type: 'pong' });
      continue;
    }
    if (typeof message?.id !== 'string') continue;
    const operation = pending.get(message.id);
    if (!operation) continue;
    pending.delete(message.id);
    if (message.error !== undefined) operation.reject(new Error(String(message.error).slice(0, 1_000)));
    else operation.resolve(message.value);
  }
}

async function readRequest(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function acquireLock() {
  await mkdir(dirname(sessionFile), { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner;
    try { owner = JSON.parse(await readFile(lockPath, 'utf8')); } catch {
      const age = Date.now() - (await stat(lockPath)).mtimeMs;
      if (age < 5_000) throw new Error('A Layout Cue native session is starting.');
    }
    if (Number.isInteger(owner?.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0);
        throw new Error('A Layout Cue native session is already running.');
      } catch (probeError) {
        if (probeError.code === 'EPERM') throw new Error('A Layout Cue native session is already running.');
        if (probeError.code !== 'ESRCH') throw probeError;
      }
    }
    await rm(lockPath, { force: true });
    lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  }
  ownsLock = true;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
  } finally {
    await lock.close();
  }
}

async function start() {
  await acquireLock();
  sessionSecret = randomBytes(32).toString('hex');
  server = createServer(async (request, response) => {
    if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::ffff:127.0.0.1') {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/command' || request.headers.origin ||
        request.headers.authorization !== `Bearer ${sessionSecret}`) {
      response.writeHead(401).end(JSON.stringify({ error: 'Agent authentication failed.' }));
      return;
    }
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
      response.writeHead(415).end(JSON.stringify({ error: 'Expected a JSON command.' }));
      return;
    }
    try {
      const command = JSON.parse(await readRequest(request));
      if (!command || typeof command !== 'object' || Array.isArray(command) || typeof command.action !== 'string') {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Unknown agent action.' }));
        return;
      }
      const id = `native-${++nextRequestId}`;
      const result = new Promise((resolveResult, rejectResult) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          rejectResult(new Error('The extension did not reply within 30 seconds.'));
        }, responseTimeoutMs);
        pending.set(id, {
          resolve(value) { clearTimeout(timeout); resolveResult(value); },
          reject(error) { clearTimeout(timeout); rejectResult(error); },
        });
      });
      try {
        writeNativeMessage({ ...command, action: command.action === 'measure' ? 'status' : command.action, id });
      } catch (error) {
        pending.get(id)?.reject(error);
        pending.delete(id);
      }
      const value = await result;
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    } catch (error) {
      const status = error.message === 'Request is too large.' ? 413 : 400;
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const { port } = server.address();
  await rm(sessionFile, { force: true });
  await writeFile(sessionFile, `${JSON.stringify({ port, token: sessionSecret })}\n`, { mode: 0o600, flag: 'wx' });
  writeNativeMessage({ ready: true, host: hostName });
  process.stdin.on('data', (chunk) => {
    try { readNativeMessages(chunk); } catch (error) {
      process.stderr.write(`${error.message}\n`);
      void cleanup();
    }
  });
  process.stdin.once('end', () => void cleanup());
  process.stdin.once('error', () => void cleanup());
  process.stderr.write('Layout Cue native host connected.\n');
}

async function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const operation of pending.values()) operation.reject(new Error('Layout Cue disconnected from Chrome.'));
  pending.clear();
  if (server?.listening) await new Promise((resolveClose) => server.close(resolveClose));
  if (ownsLock) {
    await rm(sessionFile, { force: true });
    await rm(lockPath, { force: true });
  }
}

process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
start().catch(async (error) => {
  process.stderr.write(`${error.message}\n`);
  await cleanup();
  process.exitCode = 1;
});
