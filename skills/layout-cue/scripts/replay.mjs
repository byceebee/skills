#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const defaultAgent = resolve(here, 'agent.mjs');

export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw new Error('Recipe must be a JSON object.');
  if (recipe.version !== 1) throw new Error('Recipe version must be 1.');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(recipe.id ?? '')) throw new Error('Recipe id must be a short filename-safe label.');
  if (typeof recipe.route !== 'string' || !recipe.route.trim() || /^\s*(javascript|data):/i.test(recipe.route)) throw new Error('Recipe route must be a non-empty path or HTTP(S) URL.');
  if (/^https?:/i.test(recipe.route)) {
    const url = new URL(recipe.route);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Recipe route must use HTTP or HTTPS.');
  } else if (!recipe.route.startsWith('/')) throw new Error('Recipe route must begin with /.');
  if (!Array.isArray(recipe.steps) || recipe.steps.some(step => !step || typeof step.click !== 'string' || !step.click.trim())) throw new Error('Recipe steps must be an array of explicit {"click":"CSS selector"} actions.');
  for (const key of ['ready', 'target', 'state']) if (typeof recipe[key] !== 'string' || !recipe[key].trim()) throw new Error(`Recipe ${key} must be a non-empty string.`);
  if (!recipe.viewport || !Number.isInteger(recipe.viewport.width) || recipe.viewport.width < 1 || !Number.isInteger(recipe.viewport.height) || recipe.viewport.height < 1) throw new Error('Recipe viewport must declare positive integer width and height.');
  const timeoutMs = recipe.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new Error('timeoutMs must be an integer from 100 to 120000.');
  return { ...recipe, timeoutMs };
}

function runAgent(agentPath, args) {
  const result = spawnSync(process.execPath, [agentPath, ...args], { encoding: 'utf8', timeout: 35_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `agent ${args[0]} failed`).trim());
  try { return JSON.parse(result.stdout); } catch { throw new Error(`agent ${args[0]} returned invalid JSON.`); }
}

function numericDeltas(before, after) {
  const oldChecks = new Map((before?.checks ?? []).filter(check => typeof check.id === 'string').map(check => [check.id, check]));
  const newChecks = new Map((after?.checks ?? []).filter(check => typeof check.id === 'string').map(check => [check.id, check]));
  const ids = [...new Set([...oldChecks.keys(), ...newChecks.keys()])].sort();
  return ids.map(id => {
    const a = oldChecks.get(id); const b = newChecks.get(id);
    const contract = check => ['selector', 'metric', 'relativeTo', 'relativeEdge', 'expected', 'tolerance', 'pathname', 'whenVisible']
      .map(key => check[key]);
    if (a && b && JSON.stringify(contract(a)) !== JSON.stringify(contract(b))) {
      return { id, verified: false, reason: 'rule-contract-changed' };
    }
    if (a?.status === 'skipped' && b?.status === 'skipped') return { id, status: 'skipped' };
    if (!a || !b || !Number.isFinite(a.actual) || !Number.isFinite(b.actual)) return { id, verified: false, reason: !a ? 'missing-before' : !b ? 'missing-after' : 'non-numeric-actual' };
    return { id, before: a.actual, after: b.actual, delta: b.actual - a.actual, beforeStatus: a.status, afterStatus: b.status, expected: b.expected };
  });
}

function clippingDelta(before, after) {
  const a = before?.element?.clipping; const b = after?.element?.clipping;
  if (!a || !b || !a.clipped || !b.clipped || !['top', 'right', 'bottom', 'left'].every(edge => Number.isFinite(a.clipped[edge]) && Number.isFinite(b.clipped[edge]))) return { verified: false, reason: 'clipping-data-unavailable' };
  const beforeClipped = Object.values(a.clipped).some(value => value > 0);
  const afterClipped = Object.values(b.clipped).some(value => value > 0);
  return {
    verified: true,
    before: { edges: a.clipped, visibleHeight: a.visible?.height },
    after: { edges: b.clipped, visibleHeight: b.visible?.height },
    improved: beforeClipped && !afterClipped,
    edgeDelta: Object.fromEntries(Object.keys(a.clipped).map(edge => [edge, b.clipped[edge] - a.clipped[edge]])),
  };
}

function routePath(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value, 'http://layout-cue.invalid');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return value; }
}

function contextDifferences(before, after, expectedViewport) {
  const differences = [];
  for (const [name, a, b] of [
    ['viewport', before?.viewport, after?.viewport],
    ['theme', before?.theme, after?.theme],
    ['scroll', before?.context?.scroll, after?.context?.scroll],
  ]) if (JSON.stringify(a) !== JSON.stringify(b)) differences.push(name);
  if (routePath(before?.context?.route) !== routePath(after?.context?.route)) differences.push('route');
  for (const report of [before, after]) {
    if (report?.viewport?.width !== expectedViewport.width || report?.viewport?.height !== expectedViewport.height) differences.push('declared-viewport-mismatch');
    if (!report?.theme || !report?.context?.route || !report?.context?.scroll) differences.push('incomplete-context');
  }
  return [...new Set(differences)];
}

export async function replay({ recipe: inputRecipe, phase, evidenceDir, agentPath = defaultAgent, invoke = runAgent, sleep = delay, now = Date.now }) {
  const recipe = validateRecipe(inputRecipe);
  if (!['before', 'after'].includes(phase)) throw new Error('Phase must be before or after.');
  if (!evidenceDir) throw new Error('Evidence directory is required.');
  const root = resolve(evidenceDir);
  const phaseDir = resolve(root, phase);
  if (!phaseDir.startsWith(`${root}/`)) throw new Error('Invalid evidence directory.');
  await mkdir(phaseDir, { recursive: true });
  const call = (...args) => invoke(agentPath, args);

  const waitFor = async (selector, description) => {
    const readyDeadline = now() + recipe.timeoutMs;
    do {
      const result = call('ready', selector);
      if (result?.ready && !result.animating) return result;
      if (now() >= readyDeadline) throw new Error(`Timed out after ${recipe.timeoutMs} ms waiting for ${description}: ${selector}`);
      await sleep(Math.min(200, Math.max(1, readyDeadline - now())));
    } while (true);
  };

  call('navigate', recipe.route);
  for (const step of recipe.steps) {
    await waitFor(step.click, 'click target');
    call('click', step.click);
  }
  await waitFor(recipe.ready, 'ready selector');
  call('start', recipe.target);
  const stem = resolve(phaseDir, 'evidence');
  const captured = call('capture-pair', stem);
  const report = captured?.report ?? captured?.measurement?.report ?? captured?.measurement;
  if (!captured?.ruler || !captured?.clean || !report || typeof report !== 'object') throw new Error('capture-pair must return ruler, clean, and measurement/report data.');
  const manifest = {
    schemaVersion: 1,
    recipe: recipe.id,
    phase,
    state: recipe.state,
    route: recipe.route,
    expectedViewport: recipe.viewport,
    replay: { steps: recipe.steps, ready: recipe.ready, target: recipe.target },
    capturedAt: new Date(now()).toISOString(),
    evidence: { ruler: captured.ruler, clean: captured.clean, measurement: captured.measurement },
    report,
  };
  let comparison;
  if (phase === 'after') {
    let before;
    try { before = JSON.parse(await readFile(resolve(root, 'before', 'manifest.json'), 'utf8')); }
    catch { throw new Error('Run the before phase first in the same evidence directory.'); }
    if (before.recipe !== recipe.id || before.state !== recipe.state) throw new Error('Before evidence belongs to a different recipe or declared state.');
    if (JSON.stringify(before.route) !== JSON.stringify(manifest.route) ||
        JSON.stringify(before.expectedViewport) !== JSON.stringify(manifest.expectedViewport) ||
        JSON.stringify(before.replay) !== JSON.stringify(manifest.replay)) {
      throw new Error('Before evidence was produced with different route, viewport, or replay steps.');
    }
    const differences = contextDifferences(before.report, report, recipe.viewport);
    comparison = {
      verified: differences.length === 0,
      unverified: differences.length ? [`context-mismatch:${differences.join(',')}`] : [],
      contextDifferences: differences,
      checks: numericDeltas(before.report, report),
      clipping: clippingDelta(before.report, report),
    };
    manifest.comparison = comparison;
  }
  await writeFile(resolve(phaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return manifest;
}

async function main(args) {
  if (args.length !== 3 || ['-h', '--help'].includes(args[0])) {
    process.stdout.write('Usage: node scripts/replay.mjs <recipe.json> <before|after> <evidence-dir>\n');
    return args.length === 1 && ['-h', '--help'].includes(args[0]) ? 0 : 2;
  }
  const [recipePath, phase, evidenceDir] = args;
  let recipe;
  try { recipe = JSON.parse(await readFile(resolve(recipePath), 'utf8')); }
  catch (error) { throw new Error(`Cannot read valid recipe JSON: ${error.message}`); }
  const result = await replay({ recipe, phase, evidenceDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
