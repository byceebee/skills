import { inspectPage } from '../scripts/measure.mjs';
import { parseRules } from '../scripts/rules.mjs';
import { inspectElement } from './element.mjs';

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

async function inject(tabId, func, parameters) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args: [parameters],
  });
  return injection?.result ?? null;
}

const run = (tabId, origin, action, config) => inject(tabId, inspectPage, { action, origin, config });
const inspect = (tabId, origin, action, selector) => inject(tabId, inspectElement, { action, origin, selector });
const elementKey = (tabId) => `element:${tabId}`;

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
    await chrome.storage.session.remove([key, elementKey(tabId)]);
    await run(tabId, origin, 'stop');
    await inspect(tabId, origin, 'clear');
  } else if (['status', 'pick', 'clear'].includes(action) && enabled) {
    report = await run(tabId, origin, 'status', current.config) ?? await activate(tabId, origin, current.config);
  }

  if (action === 'clear' || action === 'pick') await chrome.storage.session.remove(elementKey(tabId));
  const selection = report
    ? await inspect(tabId, origin, action === 'pick' || action === 'clear' ? action : 'status')
    : null;
  if (report && selection.element) report.element = selection.element;
  return { origin, label: current.label, hasCustomRules: current.custom, report, selection };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'element-selected' && sender.frameId === 0 && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    inOrder(tabId, async () => {
      const key = sessionKey(tabId);
      const origin = (await chrome.storage.session.get(key))[key];
      if (origin && tabOrigin(sender.url) === origin) {
        await chrome.storage.session.set({ [elementKey(tabId)]: { selector: message.selector, pathname: message.pathname } });
      }
    }).catch(console.error);
    return false;
  }
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
      await chrome.storage.session.remove([key, elementKey(tabId)]);
      return;
    }
    if (change.status !== 'complete') return;
    const { config } = await settings(origin);
    try {
      if (!await run(tabId, origin, 'status', config)) await activate(tabId, origin, config);
      const selectionKey = elementKey(tabId);
      const selection = (await chrome.storage.session.get(selectionKey))[selectionKey];
      if (selection?.pathname === new URL(tab.url).pathname) {
        await inspect(tabId, origin, 'restore', selection.selector);
      } else if (selection) await chrome.storage.session.remove(selectionKey);
    } catch {
      // A subsequent navigation or a revoked grant can invalidate this tab.
      await chrome.storage.session.remove([key, elementKey(tabId)]);
    }
  }).catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  inOrder(tabId, () => chrome.storage.session.remove([sessionKey(tabId), elementKey(tabId)])).catch(console.error);
});
