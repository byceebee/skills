import { inspectPage } from '../scripts/measure.mjs';
import { parseRules } from '../scripts/rules.mjs';

const guides = parseRules({
  regions: [
    { id: 'viewport', selector: 'html' },
    { id: 'header', selector: 'body > header, [role="banner"]' },
    { id: 'sidebar', selector: 'aside, [role="complementary"]' },
    { id: 'main-wide', selector: 'main, [role="main"]', columns: 12, gap: 16, minWidth: 1024 },
    { id: 'main-medium', selector: 'main, [role="main"]', columns: 8, gap: 16, minWidth: 640, maxWidth: 1023 },
    { id: 'main-compact', selector: 'main, [role="main"]', columns: 4, gap: 8, maxWidth: 639 },
  ],
});

function tabOrigin(url) {
  if (!url) return null;
  const parsed = new URL(url);
  return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : null;
}

function sessionKey(tabId) {
  return `tab:${tabId}`;
}

function ruleKey(origin) {
  return `rules:${origin}`;
}

async function settings(origin) {
  const key = ruleKey(origin);
  const stored = (await chrome.storage.local.get(key))[key];
  return stored ?? { label: 'Default guides', config: guides, custom: false };
}

async function run(tabId, origin, action, config) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: inspectPage,
    args: [{ action, origin, config }],
  });
  return injection?.result ?? null;
}

const operations = new Map();
function inOrder(tabId, operation) {
  const previous = operations.get(tabId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  operations.set(tabId, next);
  return next.finally(() => {
    if (operations.get(tabId) === next) operations.delete(tabId);
  });
}

async function activate(tabId, origin, config) {
  const report = await run(tabId, origin, 'start', config);
  await chrome.storage.session.set({ [sessionKey(tabId)]: origin });
  return report;
}

async function handleMessage({ action, tabId, rules, label }) {
  const tab = await chrome.tabs.get(tabId);
  const origin = tabOrigin(tab.url);
  if (!origin) throw new Error('Open an HTTP or HTTPS tab to inspect its layout.');
  const key = sessionKey(tabId);
  const enabled = (await chrome.storage.session.get(key))[key] === origin;
  let current = await settings(origin);
  let report = null;

  if (action === 'import' || action === 'defaults') {
    current = action === 'import'
      ? { label: label.slice(0, 120), config: parseRules(rules), custom: true }
      : { label: 'Default guides', config: guides, custom: false };
    if (action === 'import') await chrome.storage.local.set({ [ruleKey(origin)]: current });
    else await chrome.storage.local.remove(ruleKey(origin));
    if (enabled) report = await activate(tabId, origin, current.config);
  } else if (action === 'start') {
    report = await activate(tabId, origin, current.config);
  } else if (action === 'stop') {
    await chrome.storage.session.remove(key);
    await run(tabId, origin, 'stop');
  } else if (action === 'status' && enabled) {
    report = await run(tabId, origin, 'status', current.config) ?? await activate(tabId, origin, current.config);
  }

  return { origin, label: current.label, hasCustomRules: current.custom, report };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.url !== chrome.runtime.getURL('extension/popup.html')) return false;
  inOrder(message.tabId, () => handleMessage(message)).then(
    (value) => respond({ value }),
    (error) => respond({ error: error.message }),
  );
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== 'complete' && !change.url) return;
  inOrder(tabId, async () => {
    const key = sessionKey(tabId);
    const origin = (await chrome.storage.session.get(key))[key];
    if (!origin) return;
    if (tabOrigin(tab.url) !== origin) {
      await chrome.storage.session.remove(key);
      return;
    }
    if (change.status !== 'complete') return;
    const { config } = await settings(origin);
    try {
      if (!await run(tabId, origin, 'status', config)) await activate(tabId, origin, config);
    } catch {
      // A subsequent navigation or a revoked grant can invalidate this tab.
      await chrome.storage.session.remove(key);
    }
  }).catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  inOrder(tabId, () => chrome.storage.session.remove(sessionKey(tabId))).catch(console.error);
});
