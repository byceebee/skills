#!/usr/bin/env node

import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const hostName = 'com.byceebee.layout_witness';
const extensionId = process.argv[2];
if (!/^[a-p]{32}$/.test(extensionId ?? '')) {
  process.stderr.write('Usage: node scripts/install-native.mjs <32-character Chrome extension ID>\n');
  process.exit(1);
}

const home = homedir();
let hostDirectory;
if (process.platform === 'darwin') {
  hostDirectory = join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
} else if (process.platform === 'linux') {
  const configHome = process.env.XDG_CONFIG_HOME || join(home, '.config');
  hostDirectory = join(configHome, 'google-chrome', 'NativeMessagingHosts');
} else {
  process.stderr.write('Automatic native host registration currently supports Chrome on macOS and Linux.\n');
  process.exit(1);
}

const installDirectory = join(home, '.layout-witness', 'native-host');
const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(skillDirectory, 'scripts', 'native-host.mjs');
const executable = join(installDirectory, 'layout-witness-native-host');
const manifestPath = join(hostDirectory, `${hostName}.json`);
const quoteShell = (value) => `'${value.replaceAll("'", "'\\''")}'`;

await mkdir(installDirectory, { recursive: true, mode: 0o700 });
await mkdir(hostDirectory, { recursive: true, mode: 0o700 });
await writeFile(executable, `#!/bin/sh\nexec ${quoteShell(process.execPath)} ${quoteShell(hostScript)}\n`, { mode: 0o700 });
await chmod(executable, 0o700);
await writeFile(manifestPath, `${JSON.stringify({
  name: hostName,
  description: 'Layout Cue local browser audit bridge',
  path: executable,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
}, null, 2)}\n`, { mode: 0o600 });

process.stdout.write(`Registered Layout Cue for extension ${extensionId}.\n`);
process.stdout.write(`Native host manifest: ${manifestPath}\n`);
process.stdout.write('Reload the extension in chrome://extensions, then use Connect audit tab in its popup.\n');
