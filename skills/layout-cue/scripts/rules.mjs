const edges = ['left', 'right', 'top', 'bottom'];
const metrics = new Set([
  ...edges, ...edges.map((edge) => `padding-${edge}`),
  'width', 'height', 'row-gap', 'column-gap', 'line-height', 'font-size', 'stroke-width', 'horizontal-overflow',
  'grid-column-count',
]);

function assertObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`Unknown field ${label}.${key}.`);
  }
}

function optionalNumber(rule, field, { min = 0, integer = false, max = Infinity } = {}) {
  if (!(field in rule)) return;
  const value = rule[field];
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${rule.id}.${field} must be a ${integer ? 'whole' : 'finite'} number between ${min} and ${max}.`);
  }
}

function validateEntries(entries, name, allowed, validate) {
  if (!Array.isArray(entries)) throw new Error(`${name} must be an array.`);
  const seen = new Set();
  for (const entry of entries) {
    assertObject(entry, allowed, name);
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) {
      throw new Error(`${name} entries need a lowercase, hyphenated id.`);
    }
    if (seen.has(entry.id)) throw new Error(`Duplicate ${name} id ${entry.id}.`);
    seen.add(entry.id);
    if (typeof entry.selector !== 'string' || !entry.selector.trim()) throw new Error(`${entry.id} needs a selector.`);
    validate(entry);
  }
}

function validateWidthBounds(rule) {
  optionalNumber(rule, 'minWidth', { integer: true });
  optionalNumber(rule, 'maxWidth', { integer: true });
  if (rule.minWidth > rule.maxWidth) throw new Error(`${rule.id} has reversed width bounds.`);
}

export function parseRules(value) {
  assertObject(value, ['regions', 'checks'], 'Rules');
  const { regions = [], checks = [] } = value;
  validateEntries(regions, 'regions', ['id', 'selector', 'columns', 'gap', 'inset', 'minWidth', 'maxWidth'], (region) => {
    optionalNumber(region, 'columns', { min: 1, max: 64, integer: true });
    optionalNumber(region, 'gap');
    optionalNumber(region, 'inset');
    validateWidthBounds(region);
  });
  validateEntries(checks, 'checks', ['id', 'selector', 'metric', 'expected', 'tolerance', 'minWidth', 'maxWidth', 'relativeTo'], (rule) => {
    if (!metrics.has(rule.metric)) throw new Error(`Unsupported metric for ${rule.id}: ${rule.metric}.`);
    if (!Number.isFinite(rule.expected)) throw new Error(`${rule.id} needs a finite expected value.`);
    if (rule.metric === 'grid-column-count') optionalNumber(rule, 'expected', { integer: true });
    optionalNumber(rule, 'tolerance');
    validateWidthBounds(rule);
    if ('relativeTo' in rule && (!edges.includes(rule.metric) || typeof rule.relativeTo !== 'string' || !rule.relativeTo.trim())) {
      throw new Error(`${rule.id}.relativeTo must be a selector and can only be used with a box edge.`);
    }
  });
  if (!regions.length && !checks.length) throw new Error('Configure at least one region or check.');
  return { regions, checks };
}
