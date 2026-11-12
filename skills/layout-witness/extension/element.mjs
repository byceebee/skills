export function inspectElement({ action, origin }) {
  if (location.origin !== origin) throw new Error('This tab changed to a different site.');
  const key = Symbol.for('layout-witness.element');
  const current = globalThis[key];
  if (action === 'status') return current?.snapshot() ?? { picking: false, element: null };
  if (action === 'clear') {
    current?.stop();
    return { picking: false, element: null };
  }
  if (action !== 'pick') throw new Error('Unknown element inspection action.');
  current?.stop();

  const host = document.createElement('div');
  host.setAttribute('data-layout-witness-element', '');
  Object.assign(host.style, {
    all: 'initial', position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none',
  });
  const root = host.attachShadow({ mode: 'closed' });
  const outline = document.createElement('div');
  Object.assign(outline.style, {
    position: 'fixed', display: 'none', boxSizing: 'border-box',
    outline: '2px solid #2d7efc', outlineOffset: '-1px',
  });
  const hint = document.createElement('div');
  hint.textContent = 'Click an element, or press Enter on a focused element. Esc cancels.';
  Object.assign(hint.style, {
    position: 'fixed', bottom: '12px', left: '12px', right: '12px',
    width: 'fit-content', maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box',
    color: '#fff', background: '#151922', border: '1px solid #8cbaff',
    borderRadius: '7px', padding: '8px 10px', font: '13px/1.4 system-ui, sans-serif',
  });
  root.append(outline, hint);
  document.documentElement.append(host);

  let picking = true;
  let selected;
  let hovered;
  let frame;
  let interval;
  const events = new AbortController();
  const options = { capture: true, signal: events.signal };

  function draw(node) {
    if (!node?.isConnected || !node.getClientRects().length) {
      outline.style.display = 'none';
      return;
    }
    const rect = node.getBoundingClientRect();
    Object.assign(outline.style, {
      display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
  }

  function stop() {
    events.abort();
    cancelAnimationFrame(frame);
    clearInterval(interval);
    host.remove();
    delete globalThis[key];
  }

  function select(node) {
    selected = node;
    picking = false;
    events.abort();
    cancelAnimationFrame(frame);
    hint.remove();
    draw(selected);
    interval = setInterval(() => selected.isConnected ? draw(selected) : stop(), 350);
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

  function svgGeometry(node) {
    const childIcons = node.querySelectorAll('svg');
    const svg = node.closest('svg') ?? (childIcons.length === 1 ? childIcons[0] : null);
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

  function snapshot() {
    if (picking) return { picking: true, element: null };
    if (!selected?.isConnected) {
      stop();
      return { picking: false, element: null };
    }
    const style = getComputedStyle(selected);
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const edges = (prefix, suffix = '') => Object.fromEntries(
      sides.map((side) => [side.toLowerCase(), style[`${prefix}${side}${suffix}`]]),
    );
    return {
      picking: false,
      element: {
        selector: selectorFor(selected),
        tag: selected.localName,
        box: box(selected.getBoundingClientRect()),
        margin: edges('margin'),
        padding: edges('padding'),
        border: edges('border', 'Width'),
        layout: {
          display: style.display, boxSizing: style.boxSizing,
          rowGap: style.rowGap, columnGap: style.columnGap,
          columns: style.gridTemplateColumns, rows: style.gridTemplateRows,
        },
        typography: {
          fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
          lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
        },
        svg: svgGeometry(selected),
      },
    };
  }

  document.addEventListener('pointermove', (event) => {
    hovered = event.target;
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      draw(hovered);
    });
  }, options);
  document.addEventListener('keydown', (event) => {
    const target = document.activeElement;
    const canSelect = event.key === 'Enter' && target && target !== document.body;
    if (event.key !== 'Escape' && !canSelect) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (canSelect) select(target);
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
    select(event.target);
  }, options);

  globalThis[key] = { snapshot, stop };
  return snapshot();
}
