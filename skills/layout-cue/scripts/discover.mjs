/**
 * Read-only, bounded discovery of measurable layout irregularities inside a
 * uniquely selected composition. This function is intentionally standalone so
 * Chrome can serialize it with chrome.scripting.executeScript.
 */
export function discoverLayout({ selector, tokens } = {}) {
  const MAX_NODES = 350;
  const MAX_CANDIDATES = 12;
  const view = window;

  function unavailable(reason) {
    return { selector: typeof selector === "string" ? selector : "", status: "unavailable", reason, candidateCount: 0, candidates: [] };
  }

  if (typeof selector !== "string" || !selector.trim()) return unavailable("invalid selector");
  let matches;
  try {
    matches = Array.from(document.querySelectorAll(selector));
  } catch {
    return unavailable("invalid selector");
  }
  if (matches.length === 0) return unavailable("no matches");
  if (matches.length !== 1) return unavailable("multiple matches");

  const root = matches[0];
  const visible = (element) => {
    if (!element?.isConnected) return false;
    const style = view.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && rect.width > 0 && rect.height > 0;
  };
  if (!visible(root)) return unavailable("element is not visible");

  function selectorFor(element) {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.localName;
      const classes = Array.from(node.classList || []).filter((name) => !/\d{5,}/.test(name)).slice(0, 2);
      if (classes.length) part += `.${classes.map((name) => CSS.escape(name)).join(".")}`;
      const parent = node.parentElement;
      if (parent) {
        const peers = Array.from(parent.children).filter((peer) => peer.localName === node.localName);
        if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node === root) break;
      node = parent;
    }
    return parts.join(" > ");
  }
  const rectOf = (element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  const round = (number) => Math.round(number * 10) / 10;
  const styleOf = (element) => view.getComputedStyle(element);
  const cssSummary = (element, keys) => {
    const style = styleOf(element);
    const output = {};
    for (const key of keys) output[key] = style[key];
    return output;
  };
  const tokenValues = [];
  if (Array.isArray(tokens)) {
    for (const value of tokens) if (Number.isFinite(value) && value >= 0) tokenValues.push(value);
  } else if (tokens && typeof tokens === "object") {
    for (const value of Object.values(tokens)) {
      if (Number.isFinite(value) && value >= 0) tokenValues.push(value);
      else if (Array.isArray(value)) for (const candidate of value) if (Number.isFinite(candidate) && candidate >= 0) tokenValues.push(candidate);
    }
  }
  const uniqueTokens = Array.from(new Set(tokenValues)).sort((a, b) => a - b).slice(0, 64);
  const tokenMatches = (value) => uniqueTokens
    .map((token) => ({ value: token, delta: round(Math.abs(value - token)) }))
    .filter(({ delta }) => delta <= 2)
    .sort((a, b) => a.delta - b.delta || a.value - b.value)
    .slice(0, 3);

  const nodes = [root, ...Array.from(root.querySelectorAll("*"))].slice(0, MAX_NODES);
  const candidates = [];
  const add = (candidate) => {
    candidates.push({ id: `${candidate.type}:${candidate.target}`, ...candidate });
  };

  // Detect content escaping an ancestor's actual scroll/clip box. Report the
  // nearest ancestor that establishes the clipping boundary as the cause.
  for (const element of nodes) {
    if (element === root || !visible(element)) continue;
    const box = rectOf(element);
    const ownStyle = styleOf(element);
    const ownClipX = ["hidden", "clip"].includes(ownStyle.overflowX) ? Math.max(0, element.scrollWidth - element.clientWidth) : 0;
    const ownClipY = ["hidden", "clip"].includes(ownStyle.overflowY) ? Math.max(0, element.scrollHeight - element.clientHeight) : 0;
    if (ownClipX > 1 || ownClipY > 1) {
      add({ type: "clipping", target: selectorFor(element), container: selectorFor(element), actual: { clippedHorizontal: ownClipX, clippedVertical: ownClipY }, computed: cssSummary(element, ["overflowX", "overflowY", "display", "position"]) });
    }
    let ancestor = element.parentElement;
    while (ancestor && root.contains(ancestor)) {
      const style = styleOf(ancestor);
      // Scroll containers are commonly intentional (for example filter chips);
      // only non-scroll clipping is reported as a candidate.
      const clipsX = ["hidden", "clip"].includes(style.overflowX);
      const clipsY = ["hidden", "clip"].includes(style.overflowY);
      if (clipsX || clipsY) {
        const clip = rectOf(ancestor);
        const left = clipsX ? Math.max(0, clip.left - box.left) : 0;
        const right = clipsX ? Math.max(0, box.right - clip.right) : 0;
        const top = clipsY ? Math.max(0, clip.top - box.top) : 0;
        const bottom = clipsY ? Math.max(0, box.bottom - clip.bottom) : 0;
        if (left + right + top + bottom > 1) {
          const target = selectorFor(element);
          add({ type: "clipping", target, container: selectorFor(ancestor), actual: { clippedLeft: round(left), clippedRight: round(right), clippedTop: round(top), clippedBottom: round(bottom) }, computed: cssSummary(ancestor, ["overflowX", "overflowY", "display", "position"]) });
          break;
        }
      }
      ancestor = ancestor.parentElement;
    }
  }

  // A primary submit action outside the viewport is worth reviewing even in
  // a scrollable form. Keep ordinary scrollable lists out of this signal.
  for (const target of nodes.filter(node => node.matches('button[type="submit"], input[type="submit"]') && visible(node))) {
    const box = rectOf(target);
    const top = Math.min(box.height, Math.max(0, -box.top));
    const bottom = Math.min(box.height, Math.max(0, box.bottom - innerHeight));
    if (top + bottom <= 1) continue;
    const ancestors = [];
    for (let parent = target.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      ancestors.push(parent);
    }
    const scrollOwner = ancestors.find(node => /^(auto|scroll)$/.test(styleOf(node).overflowY) &&
      node.scrollHeight > node.clientHeight);
    const container = scrollOwner ?? root;
    add({
      type: "action-outside-viewport",
      target: selectorFor(target),
      container: selectorFor(container),
      actual: { clippedTop: round(top), clippedBottom: round(bottom), visibleHeight: round(box.height - top - bottom) },
      computed: cssSummary(container, ["display", "overflowY", "maxBlockSize"]),
    });
  }

  // Group direct siblings only when their element and explicit role match.
  // Geometry, not CSS declarations alone, is used to identify uneven spacing.
  for (const container of nodes) {
    if (!visible(container)) continue;
    const style = styleOf(container);
    const children = Array.from(container.children).filter(visible);
    if (children.length < 3) continue;
    let axis = null;
    if (style.display.includes("flex")) axis = style.flexDirection.startsWith("column") ? "y" : "x";
    else if (style.display.includes("grid")) {
      const first = rectOf(children[0]);
      const second = rectOf(children[1]);
      axis = Math.abs(second.left - first.left) >= Math.abs(second.top - first.top) ? "x" : "y";
    }
    if (!axis) continue;
    const groups = new Map();
    for (const child of children) {
      const key = `${child.localName}|${child.getAttribute("role") || ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }
    for (const group of groups.values()) {
      if (group.length < 3) continue;
      const boxes = group.map(rectOf).sort((a, b) => axis === "x" ? a.left - b.left : a.top - b.top);
      const gaps = [];
      for (let i = 1; i < boxes.length; i++) gaps.push(axis === "x" ? boxes[i].left - boxes[i - 1].right : boxes[i].top - boxes[i - 1].bottom);
      const sorted = [...gaps].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      const outlierIndex = gaps.reduce((best, gap, index) => Math.abs(gap - median) > Math.max(4, Math.abs(median) * 0.35) &&
        (best < 0 || Math.abs(gap - median) > Math.abs(gaps[best] - median)) ? index : best, -1);
      if (outlierIndex >= 0) {
        const value = gaps[outlierIndex];
        const element = group[outlierIndex + 1];
        add({ type: "uneven-gap", target: selectorFor(element), container: selectorFor(container), reference: selectorFor(group[outlierIndex]), actual: { gap: round(value), axis }, expected: { gap: round(median) }, delta: round(value - median), computed: cssSummary(container, ["display", "gap", "rowGap", "columnGap", "flexDirection"]) , tokenMatches: tokenMatches(value) });
      }
      const starts = boxes.map((box) => axis === "x" ? box.left : box.top);
      const centers = boxes.map((box) => axis === "x" ? (box.top + box.bottom) / 2 : (box.left + box.right) / 2);
      const medianCenter = [...centers].sort((a, b) => a - b)[Math.floor(centers.length / 2)];
      const alignmentIndex = centers.findIndex((center) => Math.abs(center - medianCenter) > 4);
      if (alignmentIndex >= 0) {
        const element = group[alignmentIndex];
        const reference = group.find((_, index) => index !== alignmentIndex && Math.abs(centers[index] - medianCenter) <= 4);
        if (reference) add({ type: "alignment-outlier", target: selectorFor(element), container: selectorFor(container), reference: selectorFor(reference), actual: { center: round(centers[alignmentIndex]), axis: axis === "x" ? "vertical" : "horizontal" }, expected: { center: round(medianCenter) }, delta: round(centers[alignmentIndex] - medianCenter), computed: cssSummary(element, ["alignSelf", "marginTop", "marginRight", "marginBottom", "marginLeft", "transform"]) });
      }
    }
  }

  // Text wrapping is informational: it is not treated as a defect by itself.
  for (const element of nodes) {
    if (!visible(element) || element.children.length > 0) continue;
    const text = element.textContent?.trim();
    if (!text || text.length < 24) continue;
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = Array.from(range.getClientRects());
    const lineCount = rects.length;
    if (lineCount < 2) continue;
    const style = styleOf(element);
    add({ type: "wrapping-text", target: selectorFor(element), container: selectorFor(element.parentElement || root), actual: { lineCount, width: round(rectOf(element).width), height: round(rectOf(element).height) }, computed: { fontSize: style.fontSize, lineHeight: style.lineHeight, whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, wordBreak: style.wordBreak } });
  }

  const typeOrder = { "action-outside-viewport": -1, clipping: 0, "uneven-gap": 1, "alignment-outlier": 2, "wrapping-text": 3 };
  candidates.sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.target.localeCompare(b.target) || a.container.localeCompare(b.container));
  const bounded = candidates.slice(0, MAX_CANDIDATES);
  return { selector, status: "available", candidateCount: bounded.length, candidates: bounded };
}
