import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { inspectPage } from './measure.mjs';
import { parseRules } from './rules.mjs';

const help = `Layout Cue
  node scripts/witness.mjs watch <url> --config <file> [--width <px>] [--height <px>] [--theme light|dark]
  node scripts/witness.mjs capture <url> --config <file> [--width <px> ...] [--theme light|dark ...] [--strict] [--headed]
  Both modes accept --out <directory> and --ready <selector>.`;

async function saveJson(path, data) {
  await writeFile(`${path}.next`, `${JSON.stringify(data, null, 2)}\n`);
  await rename(`${path}.next`, path);
}

async function openPage(page, url, ready) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!response?.ok()) throw new Error(`The page returned HTTP ${response?.status() ?? 'unknown'}.`);
  if (ready) await page.locator(ready).waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function sample(page, config) {
  return page.evaluate(inspectPage, { action: 'sample', config });
}

async function watch(browser, settings) {
  const page = await browser.newPage(settings.views[0]);
  await openPage(page, settings.url, settings.ready);
  const directory = settings.output;
  const reportFile = join(directory, 'layout.json');
  console.log(`Live report: ${reportFile}`);
  let lastSignature;
  let stop = false;
  const finish = () => { stop = true; };
  process.on('SIGINT', finish);
  process.on('SIGTERM', finish);
  try {
    while (!stop && !page.isClosed()) {
      try {
        const report = await sample(page, settings.config);
        const signature = JSON.stringify(report);
        const missingOverlay = await page.locator('[data-layout-witness]').count() === 0;
        if (signature !== lastSignature || missingOverlay) {
          await page.evaluate(inspectPage, { action: 'paint', report });
          const nextImage = join(directory, 'overlay.next.png');
          await page.screenshot({ path: nextImage });
          await rename(nextImage, join(directory, 'overlay.png'));
          await saveJson(reportFile, { sampledAt: new Date().toISOString(), ...report });
          lastSignature = signature;
        }
      } catch (error) {
        if (stop || page.isClosed()) break;
        if (!/Execution context was destroyed|Cannot find context|navigation/i.test(error.message)) throw error;
        lastSignature = undefined;
      }
      await sleep(350);
    }
  } finally {
    process.off('SIGINT', finish);
    process.off('SIGTERM', finish);
  }
}

async function capture(browser, settings) {
  const results = [];
  for (const view of settings.views) {
    const page = await browser.newPage(view);
    const name = `${view.viewport.width}-${view.colorScheme}`;
    const directory = join(settings.output, name);
    await mkdir(directory, { recursive: true });
    try {
      await openPage(page, settings.url, settings.ready);
      await page.screenshot({ path: join(directory, 'clean.png'), animations: 'disabled' });
      const report = await sample(page, settings.config);
      await page.evaluate(inspectPage, { action: 'paint', report });
      await page.screenshot({ path: join(directory, 'overlay.png'), animations: 'disabled' });
      await saveJson(join(directory, 'layout.json'), report);
      const counts = { pass: 0, fail: 0, unavailable: 0, skipped: 0 };
      for (const { status } of report.checks) counts[status]++;
      const unavailableRegions = report.regions.filter((region) => !region.box).length;
      results.push({ name, ...counts, unavailableRegions });
      console.log(`${name}: ${counts.fail} failed, ${counts.unavailable} unavailable, ${counts.skipped} skipped, ${unavailableRegions} unavailable regions.`);
    } finally { await page.close(); }
  }
  await saveJson(join(settings.output, 'summary.json'), { results });
  if (settings.strict && results.some((result) => result.fail || result.unavailable || result.unavailableRegions)) process.exitCode = 1;
}

function positiveInteger(input, name) {
  const result = Number(input);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${name} must be a positive integer.`);
  return result;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' }, out: { type: 'string' }, ready: { type: 'string' },
      width: { type: 'string', multiple: true }, height: { type: 'string' },
      theme: { type: 'string', multiple: true }, headed: { type: 'boolean' },
      strict: { type: 'boolean' }, help: { type: 'boolean' },
    },
  });
  if (values.help) { console.log(help); return; }
  const [mode, address] = positionals;
  if (!['watch', 'capture'].includes(mode) || positionals.length !== 2 || !values.config) throw new Error(help);
  const url = new URL(address);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Provide an HTTP(S) URL without embedded credentials.');
  }
  const widths = [...new Set((values.width ?? (mode === 'watch' ? ['1440'] : ['1440', '390']))
    .map((value) => positiveInteger(value, '--width')))];
  const themes = [...new Set(values.theme ?? (mode === 'watch' ? ['light'] : ['light', 'dark']))];
  if (themes.some((theme) => !['light', 'dark'].includes(theme))) throw new Error('--theme must be light or dark.');
  if (mode === 'watch' && (widths.length !== 1 || themes.length !== 1 || values.strict)) {
    throw new Error('Watch uses one width and theme. Use capture for a review matrix or a strict result.');
  }
  const views = widths.flatMap((width) => themes.map((colorScheme) => ({
    viewport: { width, height: values.height ? positiveInteger(values.height, '--height') : width >= 768 ? 960 : 844 },
    colorScheme, reducedMotion: 'reduce',
  })));
  const config = parseRules(JSON.parse(await readFile(values.config, 'utf8')));
  const output = values.out ? resolve(values.out) : await mkdtemp(join(tmpdir(), 'layout-witness-'));
  await mkdir(output, { recursive: true });
  console.log(`Evidence directory: ${output}`);
  const browser = await chromium.launch({
    headless: mode !== 'watch' && !values.headed,
    ...(mode === 'watch' ? { handleSIGINT: false, handleSIGTERM: false } : {}),
  });
  try {
    const settings = { url: url.href, ready: values.ready, config, output, views, strict: values.strict };
    if (mode === 'watch') await watch(browser, settings);
    else await capture(browser, settings);
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
