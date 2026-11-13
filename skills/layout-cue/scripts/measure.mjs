export function inspectPage({ action, config, report, origin }) {
  function samplePage(config) {
    const view = window;
    const viewport = {
      width: view.innerWidth,
      height: view.innerHeight,
    };
    const positionMetrics = new Set(["left", "right", "top", "bottom"]);
    const metricProperties = {
      width: null,
      height: null,
      left: null,
      right: null,
      top: null,
      bottom: null,
      "padding-top": "paddingTop",
      "padding-right": "paddingRight",
      "padding-bottom": "paddingBottom",
      "padding-left": "paddingLeft",
      "row-gap": "rowGap",
      "column-gap": "columnGap",
      "line-height": "lineHeight",
      "font-size": "fontSize",
      "stroke-width": "strokeWidth",
      "horizontal-overflow": null,
      "grid-column-count": null,
    };

    function visible(element) {
      if (!element || !element.isConnected) return false;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        rect.width > 0 &&
        rect.height > 0;
    }

    function resolve(selector) {
      let matches;
      try {
        matches = Array.from(document.querySelectorAll(selector));
      } catch (error) {
        return { element: null, reason: "invalid selector" };
      }
      if (matches.length === 0) return { element: null, reason: "no matches" };
      if (matches.length > 1) return { element: null, reason: "multiple matches" };
      if (!visible(matches[0])) return { element: null, reason: "element is not visible" };
      return { element: matches[0], reason: null };
    }

    function boxFor(element) {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }

    function parseCssPx(value) {
      if (typeof value !== "string" || !/^-?(?:\d+\.?\d*|\.\d+)px$/.test(value.trim())) return null;
      const number = Number.parseFloat(value);
      return Number.isFinite(number) ? number : null;
    }

    const inRange = (rule) => (rule.minWidth === undefined || viewport.width >= rule.minWidth) &&
      (rule.maxWidth === undefined || viewport.width <= rule.maxWidth);
    const regions = config.regions.filter(inRange).map((rule) => {
      const result = {
        id: rule.id,
        selector: rule.selector,
        status: "unavailable",
      };
      const found = resolve(rule.selector);
      if (!found.element) {
        result.reason = found.reason;
        return result;
      }
      result.status = "available";
      result.box = boxFor(found.element);
      for (const key of ["columns", "gap", "inset"]) {
        if (rule[key] !== undefined) result[key] = rule[key];
      }
      return result;
    });

    const checks = config.checks.filter(inRange).map((rule) => {
      const result = {
        id: rule.id,
        selector: rule.selector,
        metric: rule.metric,
        expected: rule.expected,
        actual: null,
        status: "unavailable",
      };

      const found = resolve(rule.selector);
      if (!found.element) {
        result.reason = found.reason;
        return result;
      }
      const element = found.element;
      const box = boxFor(element);
      result.box = box;

      if (!Object.prototype.hasOwnProperty.call(metricProperties, rule.metric)) {
        result.reason = "unsupported metric";
        return result;
      }

      let actual;
      if (rule.metric === "horizontal-overflow") {
        actual = Math.max(0, element.scrollWidth - element.clientWidth);
      } else if (rule.metric === "grid-column-count") {
        const style = view.getComputedStyle(element);
        if (!["grid", "inline-grid"].includes(style.display)) {
          result.reason = "element is not a CSS Grid container";
          return result;
        }
        const template = style.gridTemplateColumns;
        if (/^subgrid(?:\s|$)/.test(template)) {
          result.reason = "subgrid columns use parent tracks";
          return result;
        }
        const tracks = template === "none" ? [] : template.replace(/\[(?:\\.|[^\]\\])*\]/g, "").trim().split(/\s+/);
        if (tracks.some((track) => parseCssPx(track) === null)) {
          result.reason = "grid columns do not resolve to pixel tracks";
          return result;
        }
        actual = tracks.length;
      } else if (rule.metric === "width") {
        actual = box.width;
      } else if (rule.metric === "height") {
        actual = box.height;
      } else if (positionMetrics.has(rule.metric)) {
        actual = box[rule.metric];
        if (rule.relativeTo !== undefined) {
          const target = resolve(rule.relativeTo);
          if (!target.element) {
            result.reason = `relative target ${target.reason}`;
            return result;
          }
          actual -= boxFor(target.element)[rule.metric];
        }
      } else {
        const property = metricProperties[rule.metric];
        actual = parseCssPx(view.getComputedStyle(element)[property]);
        if (actual === null) {
          result.reason = "CSS value is not a pixel length";
          return result;
        }
      }

      if (!Number.isFinite(actual)) {
        result.reason = "metric could not be measured";
        return result;
      }
      result.actual = actual;
      const tolerance = rule.tolerance ?? (rule.metric === "grid-column-count" ? 0 : 1);
      result.status = Math.abs(actual - rule.expected) <= tolerance ? "pass" : "fail";
      return result;
    });

    if (!regions.some((region) => region.status === "available" && region.columns > 0)) {
      const { width, height } = viewport;
      regions.push({
        id: "viewport-grid", selector: "html", status: "available",
        box: { left: 0, top: 0, right: width, bottom: height, width, height },
        columns: width >= 1024 ? 12 : width >= 640 ? 8 : 4, gap: width >= 640 ? 16 : 8,
      });
    }
    const explicitTheme = document.documentElement.dataset.theme;
    const theme = explicitTheme === 'dark' || explicitTheme === 'light'
      ? explicitTheme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return { viewport, theme, regions, checks };
  }

  function paintPage(report) {
    const selector = "[data-layout-witness]";
    document.querySelectorAll(selector).forEach((node) => node.remove());

    const overlay = document.createElement("div");
    overlay.setAttribute("data-layout-witness", "");
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      overflow: "hidden",
      colorScheme: "light dark",
    });

    const drawing = overlay.attachShadow({ mode: "closed" });
    const isDark = report.theme === 'dark';
    const regionColor = isDark ? "#7dd3fc" : "#0369a1";
    const failColor = isDark ? "#fca5a5" : "#b91c1c";

    function drawRect(box, color, dashed = false) {
      if (!box) return;
      const rect = document.createElement("div");
      Object.assign(rect.style, {
        position: "fixed",
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${Math.max(0, box.width)}px`,
        height: `${Math.max(0, box.height)}px`,
        boxSizing: "border-box",
        border: `1px ${dashed ? "dashed" : "solid"} ${color}`,
        pointerEvents: "none",
      });
      drawing.appendChild(rect);
    }

    function drawLine(x1, y1, x2, y2, color) {
      const line = document.createElement("div");
      Object.assign(line.style, {
        position: "fixed",
        left: `${Math.min(x1, x2)}px`,
        top: `${Math.min(y1, y2)}px`,
        width: `${Math.max(1, Math.abs(x2 - x1))}px`,
        height: `${Math.max(1, Math.abs(y2 - y1))}px`,
        background: color,
        opacity: "0.6",
        pointerEvents: "none",
      });
      if (x1 === x2) {
        line.style.width = "1px";
        line.style.height = `${Math.max(1, Math.abs(y2 - y1))}px`;
      } else {
        line.style.height = "1px";
      }
      drawing.appendChild(line);
    }

    for (const region of report.regions || []) {
      if (region.status !== "available" || !region.box) continue;
      const box = region.box;
      drawRect(box, regionColor);
      const columns = Number(region.columns);
      const gap = Number(region.gap || 0);
      const inset = Number(region.inset || 0);
      if (!Number.isInteger(columns) || columns < 1 || !Number.isFinite(gap) || !Number.isFinite(inset)) continue;
      const left = box.left + inset;
      const right = box.right - inset;
      const usableWidth = right - left - gap * (columns - 1);
      if (usableWidth <= 0) continue;
      const columnWidth = usableWidth / columns;
      for (let index = 0; index < columns; index += 1) {
        const start = left + index * (columnWidth + gap);
        drawLine(start, box.top, start, box.bottom, regionColor);
        drawLine(start + columnWidth, box.top, start + columnWidth, box.bottom, regionColor);
      }
    }

    for (const check of report.checks || []) {
      if (check.status === "fail") drawRect(check.box, failColor, true);
    }

    (document.body || document.documentElement).appendChild(overlay);
    return true;
  }

  if (action === "sample") return samplePage(config);
  if (action === "paint") return paintPage(report);

  if (location.origin !== origin) throw new Error("This tab changed to a different site.");
  const key = Symbol.for("layout-witness.live");
  const current = globalThis[key];
  if (action === "stop") {
    current?.stop();
    return null;
  }
  const ruleSignature = JSON.stringify(config);
  if (action === "status") return current && current.ruleSignature === ruleSignature ? current.snapshot() : null;
  if (action !== "start") throw new Error("Unknown layout inspection action.");

  current?.stop();
  let signature;
  function snapshot() {
    const result = samplePage(config);
    const nextSignature = JSON.stringify(result);
    if (nextSignature !== signature || !document.querySelector("[data-layout-witness]")) {
      paintPage(result);
      signature = nextSignature;
    }
    return { ...result, origin, sampledAt: new Date().toISOString() };
  }

  const initial = snapshot();
  const interval = setInterval(snapshot, 350);
  globalThis[key] = {
    ruleSignature,
    snapshot,
    stop() {
      clearInterval(interval);
      document.querySelector("[data-layout-witness]")?.remove();
      delete globalThis[key];
    },
  };
  return initial;
}
