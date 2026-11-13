const select = (id) => document.getElementById(id);
const toggle = select('toggle');
const pick = select('pick');
const clear = select('clear');
const importButton = select('import');
const reset = select('reset');
const fileInput = select('rules-file');
const download = select('download');
const message = select('message');
const connect = select('connect-agent');
const connectNative = select('connect-native');
const disconnect = select('disconnect-agent');
const controls = [toggle, pick, clear, importButton, reset, download, connect, connectNative, disconnect];

let tabId;
let state;
let busy = false;
let view = 'page';
let metrics = 'box';
let lastSelector;
let lastElementSignature;

function status(text = '', error = false) {
  message.textContent = text;
  message.toggleAttribute('data-error', error);
}

async function request(action, data) {
  const response = await chrome.runtime.sendMessage({ action, tabId, ...data });
  if (!response) throw new Error('Reopen Layout Cue to reconnect to this tab.');
  if (response.error) throw new Error(response.error);
  return response.value;
}

const pixels = (value) => `${Number(value.toFixed(2))} px`;

function drawMap(report) {
  const { width, height } = report.viewport;
  const map = select('map');
  map.style.setProperty('--ratio', width / height);
  select('viewport').textContent = `${width} × ${height} px`;

  function tile(box, className) {
    const element = document.createElement('span');
    element.className = className;
    Object.assign(element.style, {
      left: `${box.left / width * 100}%`,
      top: `${box.top / height * 100}%`,
      width: `${box.width / width * 100}%`,
      height: `${box.height / height * 100}%`,
    });
    return element;
  }

  map.replaceChildren(
    ...report.regions.filter(({ box }) => box).map(({ box }) => tile(box, 'guide')),
    ...report.checks.filter(({ status }) => status === 'fail').map(({ box }) => tile(box, 'failure')),
  );
}

function chooseView(next) {
  view = next;
  for (const name of ['page', 'element']) {
    select(`${name}-view`).setAttribute('aria-pressed', String(name === view));
    select(`${name}-report`).hidden = name !== view;
  }
}

function properties(id, entries) {
  const nodes = entries.flatMap(([label, value]) => {
    const name = document.createElement('dt');
    const detail = document.createElement('dd');
    name.textContent = label;
    detail.textContent = value;
    return [name, detail];
  });
  select(id).replaceChildren(...nodes);
}

function chooseMetrics(next) {
  metrics = next;
  for (const name of ['box', 'style', 'svg']) {
    select(`${name}-metrics`).setAttribute('aria-pressed', String(name === metrics));
    select(`${name}-details`).hidden = name !== metrics;
  }
}

function drawElement(element) {
  if (select('selector').textContent !== element.selector) select('selector').textContent = element.selector;
  properties('element-box', [
    ['Rendered size', `${element.box.width} × ${element.box.height} px`],
    ['Viewport position', `${element.box.x}, ${element.box.y} px`],
  ]);
  const spacing = ['margin', 'border', 'padding'].map((metric) => {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = metric[0].toUpperCase() + metric.slice(1);
    row.append(name);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const cell = document.createElement('td');
      cell.textContent = element[metric][side] || '—';
      row.append(cell);
    }
    return row;
  });
  select('element-spacing').replaceChildren(...spacing);
  const { typography, layout } = element;
  properties('element-style', [
    ['Font family', typography.fontFamily], ['Font size', typography.fontSize],
    ['Font weight', typography.fontWeight], ['Line height', typography.lineHeight],
    ['Letter spacing', typography.letterSpacing], ['Baseline (viewport Y)', typography.baselineY == null ? null : pixels(typography.baselineY)],
    ['Display', layout.display],
    ['Box sizing', layout.boxSizing], ['Row gap', layout.rowGap], ['Column gap', layout.columnGap],
    ['Grid columns', layout.columns], ['Grid rows', layout.rows],
  ].filter(([, value]) => value));

  const svg = element.svg;
  select('svg-metrics').hidden = !svg;
  if (!svg && metrics === 'svg') chooseMetrics('box');
  if (svg) {
    const bounds = ({ x, y, width, height }) => `${x}, ${y} · ${width} × ${height}`;
    properties('element-svg', [
      ['Rendered size', `${svg.rendered.width} × ${svg.rendered.height} px`],
      ['ViewBox', svg.viewBox ? bounds(svg.viewBox) : '—'],
      ['Artwork bounds', svg.artwork ? bounds(svg.artwork) : '—'],
      ['Stroke widths', svg.strokeWidths.join(', ') || '—'],
    ]);
  }
}

function draw(state) {
  select('origin').textContent = state.origin;
  select('rule-name').textContent = state.label;
  reset.hidden = !state.hasCustomRules;
  select('agent-status').textContent = state.agentConnected ? 'Connected to this tab' : 'Disconnected';
  select('agent-status').toggleAttribute('data-connected', state.agentConnected);
  select('agent-native').hidden = state.agentConnected;
  select('agent-pair').hidden = state.agentConnected;
  select('agent-connected').hidden = !state.agentConnected;
  toggle.textContent = state.report ? 'Stop guides' : 'Start guides';
  const running = Boolean(state.report);
  if (toggle.hasAttribute('data-running') !== running) select('rule-settings').open = !running;
  toggle.toggleAttribute('data-running', running);
  pick.hidden = !state.report;
  pick.textContent = state.selection?.picking ? 'Cancel selection' : 'Inspect element';
  select('results').hidden = !state.report;
  const element = state.report?.element;
  select('switcher').hidden = !element;
  if (element?.selector !== lastSelector) {
    chooseView(element && !state.selection?.automatic ? 'element' : 'page');
    chooseMetrics('box');
  }
  lastSelector = element?.selector;
  const signature = element && JSON.stringify(element);
  if (element && signature !== lastElementSignature) drawElement(element);
  lastElementSignature = signature;
  if (!state.report) return;

  drawMap(state.report);
  const gridLabels = (state.report.grids ?? []).map(({ columns, source }) =>
    `${columns} ${columns === 1 ? 'column' : 'columns'} · ${source === 'default' ? 'Default' : 'Custom'}`
  );
  const gridSummary = [...new Set(gridLabels)].join(' / ');
  if (select('grid-summary').textContent !== gridSummary) select('grid-summary').textContent = gridSummary;
  const { checks, regions } = state.report;
  const count = (status) => checks.filter((check) => check.status === status).length;
  const regionsVisible = regions.filter((region) => region.status === 'available').length;
  const summary = checks.length
    ? `${count('pass')} passed · ${count('fail')} failed · ${count('unavailable')} unavailable`
    : `${regionsVisible} visible guides · No checks configured`;
  if (select('summary').textContent !== summary) select('summary').textContent = summary;

  const findings = checks.filter((check) => check.status !== 'pass').slice(0, 3).map((check) => {
    const row = document.createElement('li');
    const title = document.createElement('strong');
    const details = document.createElement('span');
    title.textContent = check.id[0].toUpperCase() + check.id.slice(1).replaceAll('-', ' ');
    details.textContent = check.status === 'fail'
      ? check.metric === 'grid-column-count'
        ? `${check.actual} columns measured, ${check.expected} expected`
        : `${pixels(check.actual)} measured, ${pixels(check.expected)} expected`
      : check.reason;
    row.append(title, details);
    return row;
  });
  select('findings').replaceChildren(...findings);
}

async function act(operation) {
  if (busy) return;
  busy = true;
  status();
  for (const button of controls) button.disabled = true;
  try {
    await operation();
    draw(state);
  } catch (error) {
    if (!state) select('origin').textContent = 'No inspectable tab';
    status(error.message, true);
  } finally {
    busy = false;
    for (const button of controls) button.disabled = !state;
  }
}

toggle.addEventListener('click', () => act(async () => {
  state = await request(state.report ? 'stop' : 'start');
}));
pick.addEventListener('click', () => act(async () => {
  const picking = state.selection?.picking;
  state = await request(picking ? 'clear' : 'pick');
  if (!picking) window.close();
}));
clear.addEventListener('click', () => act(async () => { state = await request('clear'); }));
select('page-view').addEventListener('click', () => chooseView('page'));
select('element-view').addEventListener('click', () => chooseView('element'));
for (const name of ['box', 'style', 'svg']) {
  select(`${name}-metrics`).addEventListener('click', () => chooseMetrics(name));
}
importButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files;
  fileInput.value = '';
  if (!file) return;
  act(async () => {
    if (file.size > 256 * 1024) throw new Error('Use a rules file smaller than 256 KB.');
    let rules;
    try {
      rules = JSON.parse(await file.text());
    } catch {
      throw new Error('Select a valid JSON rules file.');
    }
    state = await request('import', { rules, label: file.name });
    status('Rules saved for this site.');
  });
});
reset.addEventListener('click', () => act(async () => {
  state = await request('defaults');
  status('Default guides restored.');
}));
connectNative.addEventListener('click', () => act(async () => { state = await request('connect-native'); }));
select('agent-pair').addEventListener('submit', (event) => {
  event.preventDefault();
  act(async () => {
    const input = select('pairing-url');
    state = await request('connect-agent', { label: input.value });
    input.value = '';
  });
});
disconnect.addEventListener('click', () => act(async () => { state = await request('disconnect-agent'); }));
download.addEventListener('click', () => act(async () => {
  state = await request('status');
  if (!state.report) throw new Error('Start guides to measure this tab.');
  const json = new Blob([`${JSON.stringify(state.report, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(json);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'layout-cue.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}));

await act(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('Open a tab to inspect its layout.');
  tabId = tab.id;
  state = await request('status');
});

setInterval(async () => {
  if (busy || !state) return;
  const previous = state;
  try {
    const current = await request('status');
    if (!busy && state === previous) {
      state = current;
      draw(state);
    }
  } catch (error) {
    if (!busy && state === previous) status(error.message, true);
  }
}, 800);
