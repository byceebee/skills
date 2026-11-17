#!/usr/bin/env node
// Local page that asks Layout Cue to pair the native audit host with a tab.
// The extension ID is derived from this skill's installed directory, matching
// Chrome's unpacked-extension ID rule. ?ext= overrides it if the extension was
// loaded from a different path.
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extensionIdFromDirectory } from './pairing.mjs';

const port = Number(process.env.PORT || 4330);
const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const derivedExtensionId = await extensionIdFromDirectory(skillDirectory);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Layout Cue agent pairing</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 3rem auto; max-width: 42rem; padding: 0 1rem; }
  #result { padding: .75rem 1rem; border: 1px solid #bbb; border-radius: 4px; }
  #result[data-ok="true"] { color: #0b5c3b; border-color: #0b5c3b; }
  #result[data-ok="false"] { color: #a3241c; border-color: #a3241c; }
</style>
</head>
<body>
<h1>Layout Cue agent pairing</h1>
<p id="result" role="status" aria-live="polite">Requesting pairing…</p>
<script type="module">
  const result = document.querySelector('#result');
  const params = new URLSearchParams(location.search);
  const extensionId = params.get('ext') || ${JSON.stringify(derivedExtensionId)};
  const target = params.get('target') || 'http://127.0.0.1:4319';
  const tabParam = params.get('tab');
  const message = { action: 'auto-pair', target };
  if (tabParam && /^\\d+$/.test(tabParam)) message.tabId = Number(tabParam);
  try {
    const response = await chrome.runtime.sendMessage(extensionId, message);
    if (response?.error) throw new Error(response.error);
    result.dataset.ok = 'true';
    result.textContent = 'Paired tab ' + response.value.tabId + ' at ' + response.value.origin + '. You can close this tab.';
  } catch (error) {
    result.dataset.ok = 'false';
    result.textContent = 'Pairing failed: ' + error.message;
  }
</script>
</body>
</html>`;

createServer((request, response) => {
  if (request.url?.startsWith('/health')) {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Layout Cue pairing page on http://127.0.0.1:${port}/ (extension ${derivedExtensionId})\n`);
});
