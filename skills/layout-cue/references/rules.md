# Layout Cue rules

Create a JSON file with `regions`, `checks`, or both. IDs are unique within each array.

```json
{
  "regions": [
    { "id": "content", "selector": "main", "columns": 4, "gap": 12, "inset": 16 },
    { "id": "header", "selector": "header.site-header" }
  ],
  "checks": [
    { "id": "card-padding", "selector": "#recent", "metric": "padding-left", "expected": 16 },
    { "id": "heading-edge", "selector": "main h1", "metric": "left", "relativeTo": "#recent", "expected": 0, "tolerance": 1 },
    { "id": "mobile-overflow", "selector": "html", "metric": "horizontal-overflow", "expected": 0, "tolerance": 0, "maxWidth": 600 }
  ]
}
```

A region outlines its selector. Add `columns` to draw equal-width columns across the element's rendered box. `gap` is the space between columns and `inset` is the space on each side. Both default to zero. These guide lines represent the supplied plan. The screenshot remains a view of the original CSS.

In the Chrome extension, a checks-only file keeps the default main-content grid of 4, 8, or 12 columns. A visible custom column region overrides the default grid within its configured width range. When no custom grid can be drawn, the extension uses the responsive default. The popup shows the column count and source.

Each check resolves exactly one visible element. Narrow selectors when a component repeats. Add inclusive `minWidth` or `maxWidth` bounds to guides or checks that apply at specific viewport sizes. Rules outside the active width are omitted.

| Metric | What is measured |
| --- | --- |
| `width`, `height` | Rendered border-box dimensions |
| `left`, `right`, `top`, `bottom`, `center-x`, `center-y` | Viewport-relative box edge or center. With `relativeTo`, measures the selected edge against a source edge |
| `padding-top`, `padding-right`, `padding-bottom`, `padding-left`, `row-gap`, `column-gap`, `line-height`, `font-size` | Computed pixel value |
| `stroke-width` | Computed stroke width of the selected SVG node |
| `horizontal-overflow` | Scroll width beyond the element's client width. This measures geometry even when local scrolling is intentional. Set an expected value of zero only where the layout contract requires it. |
| `grid-column-count` | Number of rendered CSS Grid column tracks, including implicit and zero-width tracks |
| `visible-height` | Target height remaining after intersecting its box with the viewport and ancestor vertical scrollports, in CSS pixels |
| `clipped-height` | Target border-box height hidden by the viewport and ancestor vertical scrollports, in CSS pixels (`height - visible-height`) |

Expected values and tolerances are numbers in CSS pixels. The default tolerance is 1 px. For strict SVG checks, select the shape with the stroke. A computed keyword such as `line-height: normal` is unavailable.

For `grid-column-count`, use a whole number of tracks and an optional tolerance in tracks. The default is zero. Flex containers and track lists that the browser cannot resolve to pixel lengths, such as subgrid columns, are unavailable. Use width bounds to give the same container separate expectations at narrow and wide sizes.

## Route and UI-state scoped checks

Add `pathname` to apply a check only when `location.pathname` exactly matches the configured path. Query strings and fragments are not part of this comparison. A route mismatch is reported as `skipped`, so it does not count as a failed or unavailable measurement.

Add `whenVisible` with a selector for a UI state marker, such as the open dialog or expanded filter panel. If the selector has no visible match, the check is `skipped`; when it has more than one visible match, the check is `unavailable` because the state is ambiguous. When the gate is visible, the regular `selector` must still resolve to exactly one visible target. A missing target in that active state is `unavailable`, which makes conditional markup regressions visible.

```json
{
  "checks": [
    {
      "id": "edit-dialog-footer-visible-height",
      "selector": "[role=dialog][data-state=open] .dialog-footer",
      "metric": "visible-height",
      "expected": 56,
      "tolerance": 1,
      "pathname": "/projects/42/edit",
      "whenVisible": "[role=dialog][data-state=open]"
    },
    {
      "id": "filter-chip-clipping",
      "selector": ".filter-chip-list",
      "metric": "clipped-height",
      "expected": 0,
      "tolerance": 0,
      "whenVisible": ".filter-panel[aria-expanded=true]"
    }
  ]
}
```

`visible-height` and `clipped-height` account for the viewport and ancestor elements whose vertical overflow clips or scrolls. They describe rectangular geometry, not whether clipped content can be reached by scrolling, nor occlusion by another element, masks, or clip paths. For an intentionally scrollable panel, check that the relevant controls can be revealed and activated; do not treat clipping alone as a defect.

Use `--ready` for a selector that appears when the initial page is ready to inspect. Watch mode samples the state you open in its browser. Capture mode opens a fresh page for each width and theme. A check can pass, fail, be unavailable, or be skipped. Capture with `--strict` exits with a failure status when any configured measurement fails or is unavailable.


## Relative alignment checks

Use `relativeTo` to compare a target edge with an edge on another visible element. `selector` and `metric` identify the target element and its edge; `relativeTo` identifies the source element. The reported value is target coordinate minus source coordinate in CSS pixels. `relativeEdge` optionally chooses the source edge and defaults to `metric`. Both edges must be on the same axis. Horizontal edges are `left`, `right`, and `center-x`; vertical edges are `top`, `bottom`, and `center-y`.

```json
{
  "checks": [
    {
      "id": "toolbar-reading-edge",
      "selector": "#results-toolbar",
      "metric": "left",
      "relativeTo": "#results-title",
      "relativeEdge": "left",
      "expected": 0,
      "tolerance": 1
    }
  ]
}
```

In this example the page specification puts the toolbar and heading on the same reading edge. If the toolbar starts at 40 px and the heading starts at 32 px, the report returns `actual: 8` and `status: "fail"`. At 32 px for both edges it returns `actual: 0` and `status: "pass"`. Reports include the source selector, source edge, and tolerance. Failed comparisons outline both elements and connect the measured edges in the live guide.

Use different edges to express relationships such as a control aligned to a card's far edge or an icon centered against a label:

```json
{ "id": "action-aligns-to-card-end", "selector": ".card-action", "metric": "right", "relativeTo": ".card", "relativeEdge": "right", "expected": 0 }
```
