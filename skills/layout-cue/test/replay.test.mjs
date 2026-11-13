import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { replay, validateRecipe } from '../scripts/replay.mjs';

const recipe = {
  version: 1,
  id: 'cash-edit',
  route: '/cash',
  steps: [{ click: '[data-testid="edit-cash"]' }],
  ready: '[role="dialog"]',
  target: '[role="dialog"]',
  state: 'Edit cash drawer dialog open',
  viewport: { width: 360, height: 800 },
  timeoutMs: 1000,
};

function report({ width = 360, theme = 'light', route = 'http://localhost:4173/cash', scroll = [0, 0], actual = 24, clipped = true } = {}) {
  return {
    viewport: { width, height: 800 },
    theme,
    context: { route, scroll: { viewport: scroll, containers: [] } },
    checks: [{ id: 'dialog-gap', actual, expected: 24, status: actual === 24 ? 'pass' : 'fail' }],
    element: { clipping: { clipped: { top: 0, right: 0, bottom: clipped ? 12 : 0, left: 0 }, visible: { height: clipped ? 68 : 80 }, status: clipped ? 'fail' : 'pass' } },
  };
}

function mockAgent(reports, commands = []) {
  let readyCalls = 0;
  return (_path, args) => {
    commands.push(args);
    if (args[0] === 'ready') return { ready: ++readyCalls > 0 };
    if (args[0] === 'capture-pair') return { ruler: `${args[1]}-ruler.jpg`, clean: `${args[1]}-clean.jpg`, measurement: `${args[1]}.json`, report: reports.shift() };
    return { ok: true };
  };
}

test('recipe requires explicit replay actions, state, target, and expected viewport', () => {
  assert.equal(validateRecipe(recipe).timeoutMs, 1000);
  assert.throws(() => validateRecipe({ ...recipe, route: 'javascript:alert(1)' }), /route/);
  assert.throws(() => validateRecipe({ ...recipe, steps: [{ action: 'click' }] }), /explicit/);
  assert.throws(() => validateRecipe({ ...recipe, viewport: undefined }), /viewport/);
});

test('before and after replay same recipe and calculate check and clipping deltas', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'layout-cue-replay-'));
  const commands = [];
  try {
    const first = await replay({ recipe, phase: 'before', evidenceDir: dir, invoke: mockAgent([report()]), sleep: async () => {} });
    assert.equal(first.report.viewport.width, 360);
    assert.equal(JSON.parse(await readFile(join(dir, 'before', 'manifest.json'), 'utf8')).state, recipe.state);
    const second = await replay({ recipe, phase: 'after', evidenceDir: dir, invoke: mockAgent([report({ route: 'http://candidate.local/cash', actual: 20, clipped: false })], commands), sleep: async () => {} });
    assert.equal(second.comparison.verified, true);
    assert.deepEqual(second.comparison.checks[0], { id: 'dialog-gap', before: 24, after: 20, delta: -4, beforeStatus: 'pass', afterStatus: 'fail', expected: 24 });
    assert.deepEqual(second.comparison.clipping, {
      verified: true,
      before: { edges: { top: 0, right: 0, bottom: 12, left: 0 }, visibleHeight: 68 },
      after: { edges: { top: 0, right: 0, bottom: 0, left: 0 }, visibleHeight: 80 },
      improved: true,
      edgeDelta: { top: 0, right: 0, bottom: -12, left: 0 },
    });
    assert.deepEqual(commands.slice(0, 5), [['navigate', '/cash'], ['ready', '[data-testid="edit-cash"]'], ['click', '[data-testid="edit-cash"]'], ['ready', '[role="dialog"]'], ['start', '[role="dialog"]']]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('after replay marks viewport, theme, and scroll differences unverified', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'layout-cue-replay-'));
  try {
    await replay({ recipe, phase: 'before', evidenceDir: dir, invoke: mockAgent([report()]), sleep: async () => {} });
    const after = await replay({ recipe, phase: 'after', evidenceDir: dir, invoke: mockAgent([report({ width: 390, theme: 'dark', scroll: [0, 40] })]), sleep: async () => {} });
    assert.equal(after.comparison.verified, false);
    assert.deepEqual(after.comparison.contextDifferences, ['viewport', 'theme', 'scroll', 'declared-viewport-mismatch']);
    assert.ok(after.comparison.unverified[0].startsWith('context-mismatch:'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ready selector timeout is bounded and before evidence is required for after', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'layout-cue-replay-'));
  try {
    await assert.rejects(replay({ recipe: { ...recipe, timeoutMs: 100 }, phase: 'before', evidenceDir: dir, invoke: () => ({ ready: false }), sleep: async () => {}, now: (() => { let n = 0; return () => n += 60; })() }), /Timed out/);
    await assert.rejects(replay({ recipe, phase: 'after', evidenceDir: dir, invoke: mockAgent([report()]), sleep: async () => {} }), /before phase first/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
