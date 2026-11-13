import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const hostScript = fileURLToPath(new URL('../scripts/native-host.mjs', import.meta.url));
const cliScript = fileURLToPath(new URL('../scripts/agent.mjs', import.meta.url));
const execute = promisify(execFile);

async function* messages(stream) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
      const end = 4 + buffer.readUInt32LE();
      yield JSON.parse(buffer.subarray(4, end));
      buffer = buffer.subarray(end);
    }
  }
}

test('the CLI discovers the native tab and a second host cannot remove its session', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'layout-witness-native-test-'));
  const sessionFile = join(directory, 'session.json');
  const env = { ...process.env, LAYOUT_WITNESS_NATIVE_SESSION: sessionFile };
  delete env.LAYOUT_WITNESS_SESSION;
  const host = spawn(process.execPath, [hostScript], { env, stdio: ['pipe', 'pipe', 'ignore'] });
  const exited = once(host, 'exit');
  const frames = messages(host.stdout);
  try {
    const { value } = await frames.next();
    assert.equal(value.ready, true);
    const originalSession = await readFile(sessionFile, 'utf8');
    await assert.rejects(execute(process.execPath, [hostScript], { env }), /already running/);
    assert.equal(await readFile(sessionFile, 'utf8'), originalSession);

    const measure = execute(process.execPath, [cliScript, 'measure'], { env });
    const { value: request } = await frames.next();
    assert.equal(request.action, 'status');
    const report = { viewport: { width: 390, height: 844 } };
    const body = Buffer.from(JSON.stringify({ id: request.id, value: { report } }));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    host.stdin.write(header.subarray(0, 2));
    host.stdin.write(Buffer.concat([header.subarray(2), body]));
    assert.deepEqual(JSON.parse((await measure).stdout), report);
    host.stdin.end();
    assert.deepEqual(await exited, [0, null]);
    await assert.rejects(readFile(sessionFile), { code: 'ENOENT' });
  } finally {
    if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
