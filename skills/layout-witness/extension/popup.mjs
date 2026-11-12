const select = (id) => document.getElementById(id);
const toggle = select('toggle');
const importButton = select('import');
const reset = select('reset');
const fileInput = select('rules-file');
const download = select('download');
const message = select('message');

let tabId;
let state;
let busy = false;

function status(text = '', error = false) {
  message.textContent = text;
  message.toggleAttribute('data-error', error);
}

async function request(action, data) {
  const response = await chrome.runtime.sendMessage({ action, tabId, ...data });
  if (!response) throw new Error('Reopen Layout Witness to reconnect to this tab.');
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

function draw(state) {
  select('origin').textContent = state.origin;
  select('rule-name').textContent = state.label;
  reset.hidden = !state.hasCustomRules;
  toggle.textContent = state.report ? 'Stop guides' : 'Start guides';
  toggle.toggleAttribute('data-running', Boolean(state.report));
  select('results').hidden = !state.report;
  if (!state.report) return;

  drawMap(state.report);
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
      ? `${pixels(check.actual)} measured, ${pixels(check.expected)} expected`
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
  for (const button of [toggle, importButton, reset, download]) button.disabled = true;
  try {
    await operation();
    draw(state);
  } catch (error) {
    if (!state) select('origin').textContent = 'No inspectable tab';
    status(error.message, true);
  } finally {
    busy = false;
    for (const button of [toggle, importButton, reset, download]) button.disabled = !state;
  }
}

toggle.addEventListener('click', () => act(async () => {
  state = await request(state.report ? 'stop' : 'start');
}));
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
download.addEventListener('click', () => act(async () => {
  state = await request('status');
  if (!state.report) throw new Error('Start guides to measure this tab.');
  const json = new Blob([`${JSON.stringify(state.report, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(json);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'layout-witness.json';
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
  if (busy || !state?.report) return;
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
