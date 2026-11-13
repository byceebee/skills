import { inspectPage } from '../scripts/measure.mjs';
import { parseRules } from '../scripts/rules.mjs';
import { discoverLayout } from '../scripts/discover.mjs';
import { inspectElement } from './element.mjs';
import { agentConnected, connectAgent, connectNativeAgent, disconnectAgent } from './agent.mjs';

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

const defaultSettings = { label: 'Default guides', config: { regions: [], checks: [] }, custom: false };

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
  return stored ?? defaultSettings;
}

async function inject(tabId, func, parameters) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args: [parameters],
  });
  return injection?.result ?? null;
}

const run = (tabId, origin, action, config) => inject(tabId, inspectPage, {
  action, origin, config: config && { ...config, defaultRegions: guides.regions },
});
const inspect = (tabId, origin, action, selector, comparison, relation, checks) =>
  inject(tabId, inspectElement, { action, origin, selector, comparison, relation, checks });
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

function clickTarget({ origin, selector }) {
  if (location.origin !== origin) return { error: 'The connected tab changed sites.' };
  let matches;
  try {
    matches = document.querySelectorAll(selector);
  } catch {
    return { error: 'Use a valid CSS selector.' };
  }
  if (matches.length !== 1) return { error: 'The click selector must match exactly one element.' };
  const target = matches[0];
  if (typeof target.click !== 'function' || !target.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    || !target.getClientRects().length || target.closest('[inert], :disabled, [aria-disabled="true"]')) {
    return { error: 'The click target is hidden or disabled.' };
  }
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  const box = target.getBoundingClientRect();
  const left = Math.max(0, box.left);
  const top = Math.max(0, box.top);
  const right = Math.min(innerWidth, box.right);
  const bottom = Math.min(innerHeight, box.bottom);
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  if (right <= left || bottom <= top || !target.contains(hit)) {
    return { error: 'The click target is clipped or covered.' };
  }
  target.click();
  return { clicked: selector };
}

function readAuditContext({ origin, selector }) {
  if (location.origin !== origin) throw new Error('The connected tab changed sites.');
  const matches = selector ? [...document.querySelectorAll(selector)].filter(node =>
    node.getClientRects().length && getComputedStyle(node).visibility === 'visible') : [];
  return {
    ready: selector ? matches.length === 1 : true,
    route: location.pathname + location.search + location.hash,
    animating: matches[0]?.getAnimations({ subtree: true }).some(animation =>
      animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)) ?? false,
    scroll: {
      viewport: [scrollX, scrollY],
      containers: Array.from(document.querySelectorAll('*')).flatMap((node, index) =>
        node.scrollLeft || node.scrollTop ? [{ index, x: node.scrollLeft, y: node.scrollTop }] : []),
    },
  };
}

function hideAuditOverlays({ origin, hidden }) {
  if (location.origin !== origin) throw new Error('The connected tab changed sites.');
  document.documentElement.toggleAttribute('data-layout-cue-capture-clean', hidden);
  document.querySelectorAll('[data-layout-witness], [data-layout-witness-element]').forEach(node => {
    if (hidden) node.style.setProperty('opacity', '0', 'important');
    else node.style.removeProperty('opacity');
  });
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
}

async function handleMessage({ action, tabId, rules, label, selector, url, comparison, relation, check, tokens }, expectedOrigin) {
  const tab = await chrome.tabs.get(tabId);
  const origin = tabOrigin(tab.url);
  if (!origin) throw new Error('Open an HTTP or HTTPS tab to inspect its layout.');
  if (expectedOrigin && origin !== expectedOrigin) throw new Error('The connected tab changed sites. Pair it again from the toolbar.');
  if (action === 'ready') {
    if (typeof selector !== 'string' || !selector.trim()) throw new Error('Provide a readiness selector.');
    return inject(tabId, readAuditContext, { origin, selector });
  }
  if (action === 'discover') {
    if (typeof selector !== 'string' || !selector.trim()) throw new Error('Provide a composition selector.');
    const result = await inject(tabId, discoverLayout, { selector, tokens, origin });
    if (!result || result.error) throw new Error(result?.error ?? 'Discovery is unavailable.');
    return result;
  }
  if (action === 'export-rules') return { rules: (await settings(origin)).config };
  if (action === 'navigate' || action === 'click') {
    if (!expectedOrigin) throw new Error('Connect the audit tab before sending browser commands.');
    if (action === 'navigate') {
      if (typeof url !== 'string' || !url.trim()) throw new Error('Provide a URL or route.');
      const destination = new URL(url, tab.url);
      if (tabOrigin(destination.href) !== origin || destination.username || destination.password) {
        throw new Error('Navigation is limited to the connected site.');
      }
      if (destination.href === tab.url) await chrome.tabs.reload(tabId);
      else await chrome.tabs.update(tabId, { url: destination.href });
      return { navigatingTo: destination.href };
    }
    if (typeof selector !== 'string' || !selector.trim()) throw new Error('Provide a CSS selector to click.');
    const result = await inject(tabId, clickTarget, { origin, selector });
    if (result?.error || !result) throw new Error(result?.error ?? 'The click target is unavailable.');
    return result;
  }
  if (action === 'connect-agent' || action === 'connect-native') {
    const runAgentCommand = (request) => inOrder(tabId, () => handleMessage({ ...request, tabId }, origin));
    if (action === 'connect-native') await connectNativeAgent(tabId, origin, runAgentCommand);
    else await connectAgent(label, tabId, origin, runAgentCommand);
  }
  if (action === 'disconnect-agent') disconnectAgent(tabId);
  const key = sessionKey(tabId);
  const enabled = (await chrome.storage.session.get(key))[key] === origin;
  let current = await settings(origin);
  let report = null;
  if (!enabled && ['pick', 'pick-comparison', 'select', 'compare', 'related', 'save-check', 'clear'].includes(action)) throw new Error('Start guides before selecting an element.');

  if (action === 'import' || action === 'defaults') {
    current = action === 'import'
      ? { label: label.slice(0, 120), config: parseRules(rules), custom: true }
      : defaultSettings;
    if (action === 'import') await chrome.storage.local.set({ [ruleKey(origin)]: current });
    else await chrome.storage.local.remove(ruleKey(origin));
    if (enabled) report = await activate(tabId, origin, current.config);
  } else if (action === 'start') {
    report = await activate(tabId, origin, current.config);
  } else if (action === 'stop') {
    await chrome.storage.session.remove([key, elementKey(tabId)]);
    await run(tabId, origin, 'stop');
    await inspect(tabId, origin, 'clear');
  } else if (['status', 'capture', 'capture-matched-clean', 'pick', 'pick-comparison', 'select', 'compare', 'related', 'save-check', 'clear', 'connect-agent', 'connect-native', 'disconnect-agent'].includes(action) && enabled) {
    report = await run(tabId, origin, 'status', current.config);
    if (!report?.grids) report = await activate(tabId, origin, current.config);
  }

  if (['clear', 'pick', 'pick-comparison'].includes(action)) await chrome.storage.session.remove(elementKey(tabId));
  const explicit = ['select', 'compare', 'related'].includes(action) || (action === 'start' && selector !== undefined);
  const selectionAction = explicit ? (action === 'start' ? 'select' : action) : ['pick', 'pick-comparison', 'clear', 'start'].includes(action)
    ? (action === 'start' ? 'auto' : action) : 'status';
  let selection = report ? await inspect(tabId, origin, selectionAction, selector, comparison, relation, report.checks) : null;
  if (action === 'save-check') {
    const active = selection?.comparison;
    if (!active?.measurements.length || !check || typeof check.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(check.id)) {
      throw new Error('Pin a comparison and provide a lowercase check ID.');
    }
    const { id, expected, tolerance, minWidth, maxWidth } = check;
    const checks = active.measurements.map(({ fromSelector, toSelector }, index) => ({
      id: active.measurements.length === 1 ? id : `${id}-${index + 1}`,
      selector: toSelector,
      metric: active.to,
      relativeTo: fromSelector,
      relativeEdge: active.from,
      expected,
      ...(tolerance === undefined ? {} : { tolerance }),
      ...(minWidth === undefined ? {} : { minWidth }),
      ...(maxWidth === undefined ? {} : { maxWidth }),
    }));
    const config = parseRules({
      regions: current.config.regions,
      checks: [...current.config.checks, ...checks],
    });
    current = { config, custom: true, label: current.custom ? current.label : 'Saved checks' };
    await chrome.storage.local.set({ [ruleKey(origin)]: current });
    report = await activate(tabId, origin, config);
    selection = await inspect(tabId, origin, 'status', undefined, undefined, undefined, report.checks);
  }
  if (explicit) {
    if (!selection?.element) throw new Error(selection?.error ?? 'The selected element is unavailable.');
    await chrome.storage.session.set({ [elementKey(tabId)]: {
      selector: selector ?? selection.element.selector,
      pathname: new URL(tab.url).pathname,
      ...(action === 'compare' ? { comparison } : {}),
    } });
  }
  if (selection?.element) report.element = selection.element;
  if (selection?.comparison) report.comparison = selection.comparison;
  if (action === 'capture' || action === 'capture-matched-clean') {
    if (!report?.element) throw new Error('Select an element with guides on before capturing.');
    if (report.comparison && !report.comparison.measurements.some(({ drawn }) => drawn)) {
      throw new Error('Bring both comparison edges into view before capturing the ruler.');
    }
    if (!report.grids.length) {
      throw new Error('The page grid is unavailable.');
    }
    const { x, y, width, height } = report.element.box;
    if (!(width > 0 && height > 0 && x + width > 0 && y + height > 0
      && x < report.viewport.width && y < report.viewport.height)) {
      if (report.element.clipping?.status !== 'outside') {
        throw new Error('Scroll the selected element into the viewport before capturing.');
      }
    }
  }
  if (action === 'capture-clean' && enabled) throw new Error('Stop guides before capturing a clean screenshot.');
  if (['capture', 'capture-clean', 'capture-matched-clean'].includes(action)) {
    const isActive = async () => {
      const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      return active?.id === tabId && active.url === tab.url;
    };
    if (!await isActive()) throw new Error('Bring the paired tab to the foreground before capturing.');
    const matchedClean = action === 'capture-matched-clean';
    if (report) report.context = await inject(tabId, readAuditContext, { origin });
    try {
      if (matchedClean) await inject(tabId, hideAuditOverlays, { origin, hidden: true });
      const jpeg = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 90 });
      if (!await isActive()) throw new Error('The active tab changed during capture.');
      if (report) {
        const context = await inject(tabId, readAuditContext, { origin });
        if (JSON.stringify(context) !== JSON.stringify(report.context)) {
          throw new Error('The route or scroll position changed during capture.');
        }
      }
      return { report, jpeg };
    } finally {
      if (matchedClean && (await chrome.tabs.get(tabId).catch(() => null))?.url === tab.url) {
        await inject(tabId, hideAuditOverlays, { origin, hidden: false });
      }
    }
  }
  return { origin, label: current.label, hasCustomRules: current.custom, report, selection, agentConnected: agentConnected(tabId) };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (['element-selected', 'comparison-selected'].includes(message.type) && sender.frameId === 0 && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    inOrder(tabId, async () => {
      const key = sessionKey(tabId);
      const origin = (await chrome.storage.session.get(key))[key];
      if (origin && tabOrigin(sender.url) === origin) {
        await chrome.storage.session.set({ [elementKey(tabId)]: {
          selector: message.selector, pathname: message.pathname,
          ...(message.type === 'comparison-selected' ? { comparison: message.comparison } : {}),
        } });
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
  disconnectAgent(tabId, tabOrigin(tab.url));
  inOrder(tabId, async () => {
    const key = sessionKey(tabId);
    const origin = (await chrome.storage.session.get(key))[key];
    if (!origin) return;
    if (tabOrigin(tab.url) !== origin) {
      await chrome.storage.session.remove([key, elementKey(tabId)]);
      return;
    }
    if (change.status !== 'complete' && tab.status !== 'complete') return;
    const { config } = await settings(origin);
    try {
      const report = await run(tabId, origin, 'status', config);
      if (!report?.grids) await activate(tabId, origin, config);
      const selectionKey = elementKey(tabId);
      const selection = (await chrome.storage.session.get(selectionKey))[selectionKey];
      if (selection?.pathname === new URL(tab.url).pathname) {
        const restored = await inspect(tabId, origin, selection.comparison ? 'compare' : 'restore', selection.selector, selection.comparison);
        if (restored?.element || restored?.picking) return;
      }
      if (selection) await chrome.storage.session.remove(selectionKey);
      await inspect(tabId, origin, 'auto');
    } catch {
      // A subsequent navigation or a revoked grant can invalidate this tab.
      await chrome.storage.session.remove([key, elementKey(tabId)]);
    }
  }).catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  disconnectAgent(tabId);
  inOrder(tabId, () => chrome.storage.session.remove([sessionKey(tabId), elementKey(tabId)])).catch(console.error);
});
