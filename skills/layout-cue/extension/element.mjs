export function inspectElement({ action, origin, selector: restoreSelector, comparison, relation, checks }) {
  if (location.origin !== origin) throw new Error('This tab changed to a different site.');
  const key = Symbol.for('layout-witness.element');
  const current = globalThis[key];
  if (action === 'status') return current?.snapshot(checks) ?? { picking: false, element: null };
  if (action === 'clear') {
    current?.stop();
    document.querySelectorAll('[data-layout-witness-element]').forEach(host => host.remove());
    return { picking: false, element: null };
  }
  if (action === 'restore' && current) return current.snapshot();
  if (action === 'auto' && current) {
    const selection = current.snapshot();
    if (selection.element || selection.picking) return selection;
  }
  if (!['auto', 'pick', 'pick-comparison', 'restore', 'select', 'compare', 'related'].includes(action)) throw new Error('Unknown element inspection action.');
  function visibleMatches(selector) {
    return [...document.querySelectorAll(selector)].filter(node =>
      node.getClientRects().length && getComputedStyle(node).visibility === 'visible');
  }

  const axes = { left: 'x', right: 'x', 'center-x': 'x', top: 'y', bottom: 'y', 'center-y': 'y' };
  const isVisible = (node) => {
    const rect = node?.getBoundingClientRect();
    return rect?.width > 0 && rect.height > 0 && getComputedStyle(node).visibility === 'visible';
  };

  let requested;
  if (action === 'compare') {
    if (!comparison || !Object.hasOwn(axes, comparison.from) || axes[comparison.from] !== axes[comparison.to] ||
      !Array.isArray(comparison.selectors) || comparison.selectors.length < 2 || comparison.selectors.length > 6 ||
      new Set(comparison.selectors).size !== comparison.selectors.length ||
      comparison.selectors.some(value => typeof value !== 'string' || !value.trim() || value.length > 2000)) {
      return { error: 'Compare two to six distinct CSS selectors using edges on the same axis.' };
    }
    try {
      const matches = comparison.selectors.map(value => visibleMatches(value).filter(isVisible));
      if (matches.some(nodes => nodes.length !== 1) || new Set(matches.flat()).size !== matches.length) {
        return { error: 'Each comparison selector must match a distinct visible element.' };
      }
      requested = matches[0][0];
    } catch {
      return { error: 'Provide valid CSS selectors for comparison.' };
    }
  }
  if (action === 'related') {
    const currentSelector = current?.snapshot().element?.selector;
    if (!currentSelector) return { error: 'Select an element before moving to a related element.' };
    const node = document.querySelector(currentSelector);
    if (relation === 'parent') requested = node?.parentElement;
    if (relation === 'child') requested = Array.from(node?.children ?? []).find(isVisible);
    if (relation === 'previous' || relation === 'next') {
      const sibling = relation === 'previous' ? 'previousElementSibling' : 'nextElementSibling';
      requested = node?.[sibling];
      while (requested && !isVisible(requested)) requested = requested[sibling];
    }
    if (!isVisible(requested)) return { error: 'No visible element in that direction.' };
  }
  if (action === 'auto') {
    const onScreen = (node) => {
      const { top, bottom, left, right, width, height } = node.getBoundingClientRect();
      return width > 0 && height > 0 && right > 0 && bottom > 0 && top < innerHeight && left < innerWidth;
    };
    const scope = visibleMatches('[role="dialog"], dialog[open]').filter(onScreen).at(-1) ?? document;
    const focused = document.activeElement;
    requested = focused && focused !== document.body && scope.contains(focused) && onScreen(focused)
      ? focused : [...scope.querySelectorAll('h1, h2, [role="heading"], main, [role="main"], button, input')]
        .find(node => onScreen(node) && getComputedStyle(node).visibility === 'visible');
    requested ??= scope === document ? document.body : scope;
    if (!requested || !onScreen(requested)) return { picking: false, element: null };
  }
  if (action === 'select') {
    if (typeof restoreSelector !== 'string' || !restoreSelector.trim()) return { error: 'Provide a CSS selector.' };
    let matches;
    try {
      matches = visibleMatches(restoreSelector);
    } catch {
      return { error: 'Provide a valid CSS selector.' };
    }
    if (matches.length !== 1) return { error: `The selector must match exactly one visible element. Found ${matches.length}.` };
    [requested] = matches;
  }
  current?.stop();
  // An unpacked-extension reload can leave DOM from the previous isolated world.
  document.querySelectorAll('[data-layout-witness-element]').forEach(host => host.remove());

  const host = document.createElement('div');
  host.setAttribute('data-layout-witness-element', '');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    all: 'initial', position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none',
  });
  if (action === 'compare' && comparison.focus === true) {
    host.setAttribute('data-layout-cue-focus', '');
    document.querySelector('[data-layout-witness]')?.style.setProperty('visibility', 'hidden');
  }
  const root = host.attachShadow({ mode: 'closed' });
  const outline = document.createElement('div');
  Object.assign(outline.style, {
    position: 'fixed', display: 'none', boxSizing: 'border-box',
    outline: '2px solid #2d7efc', outlineOffset: '-1px',
  });
  const hint = document.createElement('div');
  hint.textContent = action === 'pick-comparison'
    ? `Choose element A, then hover B to preview the ${comparison?.from === 'right' ? 'horizontal' : 'vertical'} gap. Click B to pin; Enter selects the focused element. Esc cancels.`
    : 'Click an element, or press Enter on a focused element. Esc cancels.';
  Object.assign(hint.style, {
    position: 'fixed', bottom: '12px', left: '12px', right: '12px',
    width: 'fit-content', maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box',
    color: '#fff', background: '#151922', border: '1px solid #8cbaff',
    borderRadius: '7px', padding: '8px 10px', font: '13px/1.4 system-ui, sans-serif',
  });
  const guides = document.createElement('canvas');
  guides.style.cssText = 'position:fixed;inset:0;pointer-events:none';
  const ink = guides.getContext('2d');
  root.append(outline, guides);
  if (action === 'pick' || action === 'pick-comparison') root.append(hint);
  document.documentElement.append(host);

  let picking = action === 'pick' || action === 'pick-comparison';
  let comparisonFirst;
  let selector = requested ? selectorFor(requested) : restoreSelector;
  const pathname = location.pathname;
  let selected = requested;
  let hovered;
  let comparisonReport;
  let activeChecks = checks ?? [];
  let baselineY = null;
  let localGrids = { grids: [], truncated: false };
  let frame;
  let interval;
  const baselineCache = new WeakMap();
  const events = new AbortController();
  const tracking = new AbortController();
  const options = { capture: true, signal: events.signal };

  function draw(node) {
    if (!picking) {
      const topLayer = node?.closest(':modal, :popover-open') ??
        (action === 'compare' ? [...document.querySelectorAll(':modal, :popover-open')].find(layer => layer !== host) : null);
      if (topLayer && !host.matches(':popover-open')) {
        host.setAttribute('popover', 'manual');
        host.showPopover();
      } else if (!topLayer && host.matches(':popover-open')) {
        host.hidePopover();
        host.removeAttribute('popover');
      }
      paintGuides(node);
    }
    if (action === 'compare' || !node?.isConnected || !node.getClientRects().length) {
      outline.style.display = 'none';
      return;
    }
    const rect = node.getBoundingClientRect();
    Object.assign(outline.style, {
      display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
  }

  function paintGuides(node) {
    baselineY = null;
    localGrids = { grids: [], truncated: false };
    const scale = devicePixelRatio || 1;
    const width = Math.ceil(innerWidth * scale);
    const height = Math.ceil(innerHeight * scale);
    if (guides.width !== width || guides.height !== height) {
      guides.width = width;
      guides.height = height;
      guides.style.width = `${innerWidth}px`;
      guides.style.height = `${innerHeight}px`;
    }
    ink.setTransform(scale, 0, 0, scale, 0, 0);
    ink.clearRect(0, 0, innerWidth, innerHeight);
    const rect = node?.getBoundingClientRect();
    const style = node && getComputedStyle(node);
    const dark = document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches;
    const colors = {
      padding: dark ? '#6ee7b7' : '#047857',
      margin: dark ? '#fdba74' : '#9a3412',
      border: dark ? '#c4b5fd' : '#6d28d9',
      type: dark ? '#f9a8d4' : '#9d174d',
      icon: dark ? '#67e8f9' : '#0e7490',
      grid: dark ? '#93c5fd' : '#1d4ed8',
      nestedGrid: dark ? '#5eead4' : '#0f766e',
    };
    const px = (value) => Number.parseFloat(value) || 0;
    const labelBoxes = [];

    function line(x1, y1, x2, y2, color, dashed = false) {
      ink.strokeStyle = color;
      ink.setLineDash(dashed ? [4, 3] : []);
      ink.beginPath();
      ink.moveTo(x1, y1);
      ink.lineTo(x2, y2);
      ink.stroke();
    }

    function label(text, x, y, color, anchor = null) {
      ink.font = '600 11px system-ui, sans-serif';
      const w = ink.measureText(text).width + 12;
      const h = 18;
      const left = Math.max(3, Math.min(innerWidth - w - 3, x - w / 2));
      for (const offset of [0, -20, 20, -40, 40, -60, 60, -80, 80]) {
        const top = Math.max(3, Math.min(innerHeight - h - 3, y - h / 2 + offset));
        if (labelBoxes.some(b => left < b.left + b.w + 3 && left + w + 3 > b.left &&
          top < b.top + h + 3 && top + h + 3 > b.top)) continue;
        labelBoxes.push({ left, top, w });
        if (anchor) line(...anchor, left + w / 2, top + h / 2, color);
        ink.fillStyle = '#151922';
        ink.fillRect(left, top, w, h);
        ink.fillStyle = color;
        ink.fillRect(left, top, 2, h);
        ink.fillStyle = '#fff';
        ink.textBaseline = 'middle';
        ink.fillText(text, left + 6, top + h / 2);
        break;
      }
    }

    if (action === 'compare') {
      paintComparison();
      return;
    }
    if (!node?.getClientRects().length) return;

    function paintComparison() {
      const { from, to, selectors } = comparison;
      const axis = axes[from];
      const horizontal = axis === 'x';
      const axisLimit = horizontal ? innerWidth : innerHeight;
      const crossLimit = horizontal ? innerHeight : innerWidth;
      const crossStart = horizontal ? 'top' : 'left';
      const crossEnd = horizontal ? 'bottom' : 'right';
      const targets = selectors.map(value => {
        const matches = visibleMatches(value).filter(isVisible);
        return matches.length === 1 ? matches[0] : null;
      });
      const edge = (bounds, name) => {
        if (name === 'center-x') return bounds.left + bounds.width / 2;
        if (name === 'center-y') return bounds.top + bounds.height / 2;
        return bounds[name];
      };
      const measurements = [];
      for (let i = 1; i < targets.length; i++) {
        const first = targets[i - 1];
        const second = targets[i];
        const result = { fromSelector: selectors[i - 1], toSelector: selectors[i], actual: null, drawn: false };
        measurements.push(result);
        if (!first || !second || first === second) continue;
        const a = first.getBoundingClientRect();
        const b = second.getBoundingClientRect();
        const start = edge(a, from);
        const end = edge(b, to);
        const actual = end - start;
        result.actual = round(actual);
        const saved = activeChecks.find(check => check.selector === result.toSelector &&
          check.relativeTo === result.fromSelector && check.metric === to &&
          (check.relativeEdge ?? check.metric) === from);
        if (saved) {
          const tolerance = saved.tolerance ?? 1;
          const status = saved.status === 'unavailable' ? saved.status :
            Math.abs(actual - saved.expected) <= tolerance ? 'pass' : 'fail';
          result.check = { id: saved.id, expected: saved.expected, tolerance, status };
        }
        const visibleCross = bounds => bounds[crossStart] < crossLimit && bounds[crossEnd] > 0;
        if (Math.min(start, end) < 0 || Math.max(start, end) > axisLimit ||
          !visibleCross(a) || !visibleCross(b)) continue;
        const sharedStart = Math.max(0, a[crossStart], b[crossStart]);
        const sharedEnd = Math.min(crossLimit, a[crossEnd], b[crossEnd]);
        const cross = (sharedStart + sharedEnd) / 2;
        const color = result.check?.status === 'fail' ? (dark ? '#fca5a5' : '#b91c1c') :
          result.check?.status === 'pass' ? colors.padding : colors.grid;
        const draw = (along1, cross1, along2, cross2, dashed = false) => horizontal
          ? line(along1, cross1, along2, cross2, color, dashed)
          : line(cross1, along1, cross2, along2, color, dashed);
        for (const [point, bounds] of [[start, a], [end, b]]) {
          const anchor = Math.max(bounds[crossStart], Math.min(cross, bounds[crossEnd]));
          if (anchor !== cross) draw(point, anchor, point, cross, true);
          draw(point, cross - 5, point, cross + 5);
        }
        draw(start, cross, end, cross);
        const middle = (start + end) / 2;
        const verdict = result.check ? ` · ${result.check.status} (target ${result.check.expected})` : '';
        const text = `${targets.length > 2 ? `${i} · ` : ''}${result.actual} px${verdict}`;
        label(text, horizontal ? middle : cross + (result.check ? 86 : 48), horizontal ? cross - 17 : middle,
          color, horizontal ? [middle, cross] : [cross, middle]);
        result.drawn = true;
      }
      comparisonReport = { axis, from, to, focused: comparison.focus === true, measurements };
    }

    function ring(outer, inner, color) {
      ink.fillStyle = `${color}2e`;
      ink.beginPath();
      ink.rect(outer.x, outer.y, outer.width, outer.height);
      ink.rect(inner.x, inner.y, inner.width, inner.height);
      ink.fill('evenodd');
      ink.strokeStyle = color;
      ink.setLineDash([3, 3]);
      ink.strokeRect(inner.x, inner.y, inner.width, inner.height);
    }

    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    function edges(prefix, suffix = '') {
      return sides.map(side => px(style[`${prefix}${side}${suffix}`]));
    }
    function inset(bounds, [top, right, bottom, left]) {
      return new DOMRect(bounds.x + left, bounds.y + top,
        Math.max(0, bounds.width - left - right), Math.max(0, bounds.height - top - bottom));
    }
    const border = edges('border', 'Width');
    const padding = edges('padding');
    const margin = edges('margin');
    const borderInner = inset(rect, border);
    const content = inset(borderInner, padding);
    const axisAligned = ![node, ...ancestors(node)].some(element => {
      const css = getComputedStyle(element);
      return css.transform !== 'none' || (css.rotate && css.rotate !== 'none') ||
        (css.scale && css.scale !== 'none');
    });
    if (axisAligned && node instanceof HTMLElement && style.display !== 'inline' && node.getClientRects().length === 1) {
      const marginOuter = inset(rect, margin.map(value => -Math.max(0, value)));
      ring(marginOuter, rect, colors.margin);
      ring(rect, borderInner, colors.border);
      ring(borderInner, content, colors.padding);

      drawSpacingLabels();
      drawFlex();
    }

    localGrids = collectLocalGrids(node);
    for (const grid of localGrids.grids) drawGrid(grid);
    label(`${round(rect.width)} × ${round(rect.height)} px`, rect.left + rect.width / 2, rect.top - 33, colors.grid);
    drawText();
    drawIcon();
    const clipping = measureClipping(node, rect);
    const clipColor = dark ? '#fca5a5' : '#b91c1c';
    for (const [side, amount] of Object.entries(clipping.clipped)) {
      if (amount <= 0) continue;
      const boundary = clipping.boundary[side];
      const vertical = side === 'left' || side === 'right';
      const start = vertical ? Math.max(rect.top, clipping.boundary.top) : Math.max(rect.left, clipping.boundary.left);
      const end = vertical ? Math.min(rect.bottom, clipping.boundary.bottom) : Math.min(rect.right, clipping.boundary.right);
      if (end <= start) continue;
      const x = vertical ? boundary : (start + end) / 2;
      const y = vertical ? (start + end) / 2 : boundary;
      if (vertical) line(boundary, start, boundary, end, clipColor, true);
      else line(start, boundary, end, boundary, clipColor, true);
      label(`${amount} px clipped · ${side}`, x + (vertical ? (side === 'left' ? 64 : -64) : 0),
        y + (side === 'bottom' ? -14 : 14), clipColor, [x, y]);
    }

    function drawSpacingLabels() {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const metrics = [[padding, 'Padding'], [border, 'Border'], [margin, 'Margin']];
      if (metrics.every(([values]) => values[0] === values[2] && values[1] === values[3])) {
        const names = metrics.filter(([values]) => values.some(Boolean)).map(([[vertical, horizontal], name]) =>
          `${name} ${round(vertical)}${vertical === horizontal ? '' : ` × ${round(horizontal)}`} px`);
        if (names.length) label(names.join(' · '), centerX, rect.top - 12, colors.padding, [centerX, rect.top]);
        return;
      }
      const anchors = [[centerX, rect.top], [rect.right, centerY], [centerX, rect.bottom], [rect.left, centerY]];
      for (const [index, anchor] of anchors.entries()) {
        const values = metrics.filter(([values]) => values[index]);
        if (!values.length) continue;
        const text = values.map(([values, name]) =>
          `${values.length === 1 ? name : name[0]} ${round(values[index])} px`).join(' · ');
        ink.font = '600 11px system-ui, sans-serif';
        const clearance = ink.measureText(text).width / 2 + 12;
        const x = anchor[0] + (index === 1 ? clearance : index === 3 ? -clearance : 0);
        const y = anchor[1] + (index === 0 ? -12 : index === 2 ? 12 : 0);
        label(text, x, y, colors[values[0][1].toLowerCase()], anchor);
      }
    }

    function drawGrid(grid) {
      const bounds = grid.contentBox;
      if (!bounds) return;
      const right = bounds.x + bounds.width;
      const bottom = bounds.y + bounds.height;
      const nested = grid.scope === 'nested';
      const color = nested ? colors.nestedGrid : colors.grid;
      ink.save();
      ink.beginPath();
      ink.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      ink.clip();
      for (const [axis, horizontal] of [[grid.columns, true], [grid.rows, false]]) {
        if (!axis.tracks || axis.start === null) continue;
        let offset = axis.start;
        for (const size of axis.tracks.slice(0, -1)) {
          offset += size;
          for (const position of new Set([offset, offset + axis.renderedGap])) {
            if (horizontal) line(position, bounds.y, position, bottom, color, true);
            else line(bounds.x, position, right, position, color, true);
          }
          offset += axis.renderedGap;
        }
      }
      ink.restore();

      if (nested) {
        ink.strokeStyle = color;
        ink.setLineDash([4, 3]);
        ink.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
        const counts = [grid.columns, grid.rows].map(axis => axis.tracks?.length ?? '–');
        if (grid.depth === 1 && grid.tag !== 'label') {
          label(`Local grid · ${counts.join(' × ')}`, Math.max(bounds.x + 60, right - 62), bounds.y - 9, color);
        }
      } else {
        for (const [axis, horizontal] of [[grid.columns, true], [grid.rows, false]]) {
          if (axis.tracks?.length > 1 && axis.start !== null && axis.renderedGap) {
            label(`${horizontal ? 'Column' : 'Row'} gap ${round(axis.renderedGap)} px`,
              horizontal ? right : bounds.x, horizontal ? bounds.y + 12 : bottom - 12, color);
          }
        }
      }
    }

    function drawFlex() {
      if (!style.display.includes('flex') || style.flexWrap !== 'nowrap' || style.writingMode !== 'horizontal-tb') return;
      const horizontal = style.flexDirection.startsWith('row');
      const gap = px(horizontal ? style.columnGap : style.rowGap);
      if (!gap) return;
      const start = horizontal ? 'left' : 'top';
      const end = horizontal ? 'right' : 'bottom';
      const children = [...node.children].filter(child => child.getClientRects().length &&
        !['absolute', 'fixed'].includes(getComputedStyle(child).position))
        .map(child => child.getBoundingClientRect()).sort((a, b) => a[start] - b[start]);
      for (let index = 1; index < Math.min(children.length, 12); index++) {
        const a = children[index - 1][end];
        const b = children[index][start];
        if (Math.abs(b - a - gap) > 0.5) continue;
        const cross = horizontal ? content.top + content.height / 2 : content.left + content.width / 2;
        if (horizontal) line(a, cross, b, cross, colors.grid);
        else line(cross, a, cross, b, colors.grid);
        label(`Gap ${gap} px`, horizontal ? (a + b) / 2 : cross + 40,
          horizontal ? cross + 14 : (a + b) / 2, colors.grid,
          horizontal ? [(a + b) / 2, cross] : [cross, (a + b) / 2]);
      }
    }

    function drawText() {
      if (!axisAligned || style.writingMode !== 'horizontal-tb') return;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let remaining = 60;
      let first;
      let textStyle;
      while (remaining-- > 0 && walker.nextNode()) {
        const text = walker.currentNode;
        if (!text.data.trim() || text.parentElement.closest('svg, script, style')) continue;
        const css = getComputedStyle(text.parentElement);
        if (css.visibility !== 'visible' || css.writingMode !== 'horizontal-tb') continue;
        range.selectNodeContents(text);
        for (const box of [...range.getClientRects()].slice(0, 16)) {
          if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight) continue;
          line(box.left, box.top, box.right, box.top, colors.type, true);
          line(box.left, box.bottom, box.right, box.bottom, colors.type, true);
          if (!first) {
            first = box;
            textStyle = css;
            const baseline = measureBaseline(text, css, range, box);
            if (baseline !== null) {
              baselineY = round(baseline);
              line(box.left, baseline, box.right, baseline, colors.type);
              label('Baseline', box.left - 38, baseline, colors.type, [box.left, baseline]);
            }
          }
        }
      }
      if (first) label(`Line height ${textStyle.lineHeight}`, first.right + 55, first.top + first.height / 2,
        colors.type, [first.right, first.top + first.height / 2]);
    }

    function measureBaseline(text, css, range, fragment) {
      const parent = text.parentElement;
      if (parent.childNodes.length !== 1 || parent.isContentEditable || range.getClientRects().length !== 1 ||
        !['inline', 'inline-block', 'block'].includes(css.display) ||
        parent.closest('button, select, input, textarea, [contenteditable]') ||
        [...ancestors(parent), parent].some(element => getComputedStyle(element).transform !== 'none')) return null;
      const signature = [text.data, fragment.width, fragment.height, css.font, css.lineHeight, css.verticalAlign].join('|');
      const cached = baselineCache.get(parent);
      if (cached?.signature === signature) return cached.offset === null ? null : fragment.top + cached.offset;
      const marker = document.createElement('span');
      marker.style.cssText = 'all:initial;display:inline-block;width:0;height:0;overflow:hidden;vertical-align:baseline';
      parent.append(marker);
      let offset = null;
      try {
        const after = range.getBoundingClientRect();
        if (['x', 'y', 'width', 'height'].every(key => Math.abs(after[key] - fragment[key]) < 0.1)) {
          offset = marker.getBoundingClientRect().bottom - fragment.top;
        }
      } finally {
        marker.remove();
      }
      baselineCache.set(parent, { signature, offset });
      return offset === null ? null : fragment.top + offset;
    }

    function drawIcon() {
      const svg = findSvg(node);
      if (!svg?.getClientRects().length) return;
      const box = svg.getBoundingClientRect();
      ink.strokeStyle = colors.icon;
      ink.setLineDash([]);
      ink.strokeRect(box.x, box.y, box.width, box.height);
      line(box.left, box.top + box.height / 2, box.right, box.top + box.height / 2, colors.icon, true);
      line(box.left + box.width / 2, box.top, box.left + box.width / 2, box.bottom, colors.icon, true);
      const artwork = svgGeometry(node);
      if (artwork?.artwork) {
        const matrix = svg.getScreenCTM();
        if (matrix) {
          const { x, y, width, height } = artwork.artwork;
          const points = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
            .map(([px, py]) => new DOMPoint(px, py).matrixTransform(matrix));
          ink.setLineDash([3, 2]);
          ink.beginPath();
          ink.moveTo(points[0].x, points[0].y);
          for (const point of points.slice(1)) ink.lineTo(point.x, point.y);
          ink.closePath();
          ink.stroke();
        }
      }
      const stroke = artwork?.strokeWidths.join(', ');
      label(`SVG ${round(box.width)} × ${round(box.height)} px${stroke ? ` · stroke ${stroke}` : ''}`,
        box.left + box.width / 2, box.bottom + 14, colors.icon, [box.left + box.width / 2, box.bottom]);
    }
  }

  function* ancestors(node) {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) yield parent;
  }

  function stop() {
    events.abort();
    tracking.abort();
    cancelAnimationFrame(frame);
    clearInterval(interval);
    host.remove();
    if (host.hasAttribute('data-layout-cue-focus')) {
      document.querySelector('[data-layout-witness]')?.style.removeProperty('visibility');
    }
    delete globalThis[key];
  }

  function select(node) {
    selected = node;
    picking = false;
    events.abort();
    cancelAnimationFrame(frame);
    frame = undefined;
    hint.remove();
    selector = selectorFor(node);
    chrome.runtime.sendMessage({ type: 'element-selected', selector, pathname }).catch(() => {});
    draw(selected);
    followLayout();
  }

  function followLayout() {
    function schedule() {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        refresh();
      });
    }
    window.addEventListener('scroll', schedule, { capture: true, passive: true, signal: tracking.signal });
    window.addEventListener('resize', schedule, { signal: tracking.signal });
    interval = setInterval(refresh, 350);
  }

  function refresh() {
    if (pathname !== location.pathname) {
      stop();
      return;
    }
    if (action === 'compare') {
      const matches = visibleMatches(comparison.selectors[0]).filter(isVisible);
      selected = matches.length === 1 ? matches[0] : null;
    } else if (!selected?.isConnected) {
      const matches = visibleMatches(selector);
      selected = matches.length === 1 ? matches[0] : null;
    }
    draw(selected);
  }

  function selectorFor(node) {
    const path = [];
    for (let element = node; element; element = element.parentElement) {
      if (element.id) {
        const id = `#${CSS.escape(element.id)}`;
        if (document.querySelectorAll(id).length === 1) return [id, ...path].join(' > ');
      }
      const name = CSS.escape(element.localName);
      const peers = element.parentElement
        ? [...element.parentElement.children].filter((child) => child.localName === element.localName)
        : [];
      path.unshift(peers.length > 1 ? `${name}:nth-of-type(${peers.indexOf(element) + 1})` : name);
    }
    return path.join(' > ');
  }

  const round = (number) => Number(number.toFixed(2));
  function box(rect) {
    return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
  }

  function measureClipping(node, rect) {
    const boundary = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const sources = [];
    const layout = getComputedStyle(node);
    const offsetParent = node.offsetParent;
    const canClip = value => ['auto', 'hidden', 'scroll', 'clip', 'overlay'].includes(value);
    const topLayer = node.closest(':modal, :popover-open');
    for (let parent = node === topLayer ? null : node.parentElement; parent; parent = parent.parentElement) {
      if (parent === document.documentElement || parent === document.body) break;
      if (layout.position === 'absolute' && offsetParent && parent !== offsetParent && offsetParent.contains(parent)) continue;
      if (layout.position === 'fixed' && !offsetParent) break;
      const style = getComputedStyle(parent);
      const clipsX = canClip(style.overflowX);
      const clipsY = canClip(style.overflowY);
      if (clipsX || clipsY) {
        const bounds = parent.getBoundingClientRect();
        // Scrollports use the client box. overflow:clip uses the padding edge by default.
        const scaleX = parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
        const scaleY = parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
        const clipMargin = /^\d+(?:\.\d+)?px$/.test(style.overflowClipMargin)
          ? Number.parseFloat(style.overflowClipMargin) : 0;
        const marginX = style.overflowX === 'clip' ? clipMargin * scaleX : 0;
        const marginY = style.overflowY === 'clip' ? clipMargin * scaleY : 0;
        const left = bounds.left + parent.clientLeft * scaleX;
        const top = bounds.top + parent.clientTop * scaleY;
        const next = { ...boundary };
        if (clipsX) {
          next.left = Math.max(next.left, left - marginX);
          next.right = Math.min(next.right, left + parent.clientWidth * scaleX + marginX);
        }
        if (clipsY) {
          next.top = Math.max(next.top, top - marginY);
          next.bottom = Math.min(next.bottom, top + parent.clientHeight * scaleY + marginY);
        }
        if (Object.keys(next).some(side => next[side] !== boundary[side])) {
          sources.push({ selector: selectorFor(parent), axes: [clipsX && 'x', clipsY && 'y'].filter(Boolean) });
          Object.assign(boundary, next);
        }
      }
      if (parent === topLayer) break;
    }
    const clipped = {
      left: round(Math.min(rect.width, Math.max(0, boundary.left - rect.left))),
      right: round(Math.min(rect.width, Math.max(0, rect.right - boundary.right))),
      top: round(Math.min(rect.height, Math.max(0, boundary.top - rect.top))),
      bottom: round(Math.min(rect.height, Math.max(0, rect.bottom - boundary.bottom))),
    };
    const width = Math.max(0, Math.min(rect.right, boundary.right) - Math.max(rect.left, boundary.left));
    const height = Math.max(0, Math.min(rect.bottom, boundary.bottom) - Math.max(rect.top, boundary.top));
    const status = !width || !height ? 'outside' : Object.values(clipped).some(Boolean) ? 'partial' : 'inside';
    return { status, clipped, visible: { width: round(width), height: round(height) },
      boundary: Object.fromEntries(Object.entries(boundary).map(([side, value]) => [side, round(value)])), sources };
  }

  function collectLocalGrids(node) {
    const grids = [];
    const gridDepths = new Map();
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
    let candidate = node;
    let inspected = 0;
    while (candidate && inspected < 200 && grids.length < 8) {
      inspected++;
      const style = getComputedStyle(candidate);
      if (['grid', 'inline-grid'].includes(style.display) && style.visibility === 'visible') {
        const rect = candidate.getBoundingClientRect();
        if (rect.width && rect.height && rect.right > 0 && rect.bottom > 0 &&
            rect.left < innerWidth && rect.top < innerHeight) {
          const scope = candidate === node ? 'selected' : 'nested';
          const parentGrid = ancestors(candidate).find(parent => gridDepths.has(parent));
          const depth = scope === 'selected' ? 0 : (gridDepths.get(parentGrid) ?? 0) + 1;
          gridDepths.set(candidate, depth);
          grids.push(measureGrid(candidate, style, rect, scope, depth));
        }
      }
      candidate = walker.nextNode();
    }
    return { grids, truncated: Boolean(candidate) };
  }

  function measureGrid(node, style, rect, scope, depth) {
    const px = (value) => Number.parseFloat(value) || 0;
    const horizontal = style.writingMode === 'horizontal-tb' && style.direction === 'ltr';
    const canPlot = horizontal && [node, ...ancestors(node)].every(element => {
      const css = getComputedStyle(element);
      if ((css.rotate && css.rotate !== 'none') || (css.scale && css.scale !== 'none')) return false;
      if (css.transform === 'none') return true;
      const matrix = new DOMMatrixReadOnly(css.transform);
      return matrix.is2D && matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1;
    });
    const left = px(style.borderLeftWidth) + px(style.paddingLeft);
    const top = px(style.borderTopWidth) + px(style.paddingTop);
    const right = px(style.borderRightWidth) + px(style.paddingRight);
    const bottom = px(style.borderBottomWidth) + px(style.paddingBottom);
    const verticalScrollbar = node.scrollHeight > node.clientHeight && ['auto', 'scroll'].includes(style.overflowY)
      ? Math.max(0, node.offsetWidth - node.clientWidth - px(style.borderLeftWidth) - px(style.borderRightWidth)) : 0;
    const horizontalScrollbar = node.scrollWidth > node.clientWidth && ['auto', 'scroll'].includes(style.overflowX)
      ? Math.max(0, node.offsetHeight - node.clientHeight - px(style.borderTopWidth) - px(style.borderBottomWidth)) : 0;
    const contentBox = canPlot ? box(new DOMRect(rect.x + left, rect.y + top,
      Math.max(0, rect.width - left - right - verticalScrollbar),
      Math.max(0, rect.height - top - bottom - horizontalScrollbar))) : null;
    const axis = (template, cssGap, align, origin, available, scroll) => {
      const values = template.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/);
      const tracks = values.every(value => /^\d+(?:\.\d+)?px$/.test(value)) ? values.map(px) : null;
      const gap = cssGap === 'normal' ? 0 : /^\d+(?:\.\d+)?px$/.test(cssGap) ? px(cssGap) : null;
      const result = { tracks, gap, start: null, renderedGap: null };
      if (!tracks || gap === null || origin === undefined) return result;
      const count = tracks.length;
      const free = available - tracks.reduce((sum, size) => sum + size, 0) - gap * (count - 1);
      let offset = 0;
      let renderedGap = gap;
      switch (align) {
        case 'normal': case 'stretch': case 'start': case 'flex-start': case 'left': break;
        case 'end': case 'flex-end': case 'right': offset = free; break;
        case 'center': offset = free / 2; break;
        case 'space-between': if (count > 1) renderedGap += Math.max(0, free) / (count - 1); break;
        case 'space-around':
          if (free < 0) return result;
          offset = free / count / 2;
          renderedGap += free / count;
          break;
        case 'space-evenly':
          if (free < 0) return result;
          offset = free / (count + 1);
          renderedGap += offset;
          break;
        default: return result;
      }
      return { ...result, start: round(origin + offset - scroll), renderedGap: round(renderedGap) };
    };
    return {
      selector: selectorFor(node), tag: node.localName, scope, depth, contentBox,
      columns: axis(style.gridTemplateColumns, style.columnGap, style.justifyContent, contentBox?.x, contentBox?.width, node.scrollLeft),
      rows: axis(style.gridTemplateRows, style.rowGap, style.alignContent, contentBox?.y, contentBox?.height, node.scrollTop),
    };
  }

  function findSvg(node) {
    const enclosing = node.closest('svg');
    if (enclosing) return enclosing;
    const icons = node.querySelectorAll('svg');
    return icons.length === 1 ? icons[0] : null;
  }

  function svgGeometry(node) {
    const svg = findSvg(node);
    if (!svg || !svg.getClientRects().length) return null;
    const viewBox = svg.hasAttribute('viewBox') ? box(svg.viewBox.baseVal) : null;
    const rect = box(svg.getBoundingClientRect());
    let artwork = null;
    try {
      artwork = box(svg.getBBox());
    } catch {
      // Some SVG containers do not expose an artwork bounding box.
    }
    const strokes = new Set();
    for (const shape of svg.querySelectorAll('path, circle, ellipse, rect, line, polygon, polyline, use, text')) {
      const style = getComputedStyle(shape);
      if (style.stroke !== 'none' && style.visibility !== 'hidden' && shape.getClientRects().length) {
        strokes.add(style.strokeWidth);
      }
    }
    return { rendered: rect, viewBox, artwork, strokeWidths: [...strokes] };
  }

  function snapshot(nextChecks) {
    if (nextChecks) activeChecks = nextChecks;
    if (picking) return { picking: true, comparisonPicking: action === 'pick-comparison', element: null };
    if (pathname !== location.pathname) {
      stop();
      return { picking: false, element: null };
    }
    refresh();
    if (!selected?.isConnected) return { picking: false, element: null, comparison: comparisonReport };
    const style = getComputedStyle(selected);
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const edges = (prefix, suffix = '') => Object.fromEntries(
      sides.map((side) => [side.toLowerCase(), style[`${prefix}${side}${suffix}`]]),
    );
    return {
      picking: false,
      automatic: action === 'auto',
      ...(comparisonReport ? { comparison: comparisonReport } : {}),
      element: {
        selector: selectorFor(selected),
        tag: selected.localName,
        box: box(selected.getBoundingClientRect()),
        clipping: measureClipping(selected, selected.getBoundingClientRect()),
        margin: edges('margin'),
        padding: edges('padding'),
        border: edges('border', 'Width'),
        localGrids,
        layout: {
          display: style.display, boxSizing: style.boxSizing,
          rowGap: style.rowGap, columnGap: style.columnGap,
          columns: style.gridTemplateColumns, rows: style.gridTemplateRows,
        },
        typography: {
          fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
          lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, baselineY,
        },
        svg: svgGeometry(selected),
      },
    };
  }

  if (['auto', 'restore', 'select', 'compare', 'related'].includes(action)) {
    globalThis[key] = { snapshot, stop };
    refresh();
    followLayout();
    return snapshot();
  }

  document.addEventListener('pointermove', (event) => {
    hovered = event.composedPath().find(target => target instanceof Element && target !== host && !host.contains(target)) ?? event.target;
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (action === 'pick-comparison' && comparisonFirst) paintPickComparison(comparisonFirst, hovered);
      else draw(hovered);
    });
  }, options);
  document.addEventListener('keydown', (event) => {
    const target = document.activeElement;
    const canSelect = event.key === 'Enter' && target && target !== document.body;
    if (event.key !== 'Escape' && !canSelect) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (canSelect && action === 'pick-comparison') chooseComparisonNode(target);
    else if (canSelect) select(target);
    else stop();
  }, options);
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
    document.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, options);
  }
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (action === 'pick-comparison') chooseComparisonNode(event.target);
    else select(event.target);
  }, options);

  function chooseComparisonNode(node) {
    if (!node?.isConnected || node === host || host.contains(node) || !isVisible(node)) return;
    if (!comparisonFirst) {
      comparisonFirst = node;
      hint.textContent = 'A selected. Hover another element to preview the gap, then click it. Enter selects the focused element; Esc cancels.';
      draw(node);
      return;
    }
    if (node === comparisonFirst) return;
    const firstSelector = selectorFor(comparisonFirst);
    const secondSelector = selectorFor(node);
    const axis = comparison?.from === 'right' ? 'x' : 'y';
    const lockedComparison = {
      from: axis === 'x' ? 'right' : 'bottom',
      to: axis === 'x' ? 'left' : 'top',
      selectors: [firstSelector, secondSelector],
      focus: true,
    };
    chrome.runtime.sendMessage({
      type: 'comparison-selected', selector: firstSelector, pathname, comparison: lockedComparison,
    }).catch(() => {});
    inspectElement({ action: 'compare', origin, selector: firstSelector, comparison: lockedComparison });
  }

  function paintPickComparison(first, second) {
    if (!first?.isConnected || !second?.isConnected || first === second || !isVisible(second)) return;
    const topLayer = second?.closest(':modal, :popover-open') ??
      [...document.querySelectorAll(':modal, :popover-open')].find(layer => layer !== host);
    if (topLayer && !host.matches(':popover-open')) {
      host.setAttribute('popover', 'manual');
      host.showPopover();
    } else if (!topLayer && host.matches(':popover-open')) {
      host.hidePopover();
      host.removeAttribute('popover');
    }
    const scale = devicePixelRatio || 1;
    const width = Math.ceil(innerWidth * scale);
    const height = Math.ceil(innerHeight * scale);
    if (guides.width !== width || guides.height !== height) {
      guides.width = width;
      guides.height = height;
      guides.style.width = `${innerWidth}px`;
      guides.style.height = `${innerHeight}px`;
    }
    ink.setTransform(scale, 0, 0, scale, 0, 0);
    ink.clearRect(0, 0, innerWidth, innerHeight);
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    const horizontal = comparison?.from === 'right';
    const start = horizontal ? a.right : a.bottom;
    const end = horizontal ? b.left : b.top;
    const crossStart = horizontal ? Math.max(a.top, b.top) : Math.max(a.left, b.left);
    const crossEnd = horizontal ? Math.min(a.bottom, b.bottom) : Math.min(a.right, b.right);
    const cross = crossStart <= crossEnd ? (crossStart + crossEnd) / 2 : (crossStart + crossEnd) / 2;
    const edgeStart = horizontal ? [start, cross] : [cross, start];
    const edgeEnd = horizontal ? [end, cross] : [cross, end];
    const color = '#2d7efc';
    ink.strokeStyle = color;
    ink.fillStyle = '#151922';
    ink.lineWidth = 1.5;
    ink.setLineDash([]);
    ink.beginPath(); ink.moveTo(...edgeStart); ink.lineTo(...edgeEnd); ink.stroke();
    for (const [x, y] of [edgeStart, edgeEnd]) {
      ink.beginPath();
      if (horizontal) { ink.moveTo(x, y - 5); ink.lineTo(x, y + 5); }
      else { ink.moveTo(x - 5, y); ink.lineTo(x + 5, y); }
      ink.stroke();
    }
    const distance = Number((end - start).toFixed(2));
    const text = `${distance} px`;
    ink.font = '600 12px system-ui, sans-serif';
    const labelWidth = ink.measureText(text).width + 12;
    const labelX = horizontal ? (start + end - labelWidth) / 2 : cross + 8;
    const labelY = horizontal ? cross - 9 : (start + end) / 2;
    ink.fillRect(labelX, labelY - 9, labelWidth, 18);
    ink.fillStyle = '#fff'; ink.textBaseline = 'middle'; ink.fillText(text, labelX + 6, labelY);
    hint.textContent = `Preview ${text} ${horizontal ? 'horizontal' : 'vertical'} gap. Click to pin B; move to another element to compare. Esc cancels.`;
  }

  globalThis[key] = { snapshot, stop };
  return snapshot();
}
