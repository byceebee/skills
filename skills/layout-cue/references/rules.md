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
| `left`, `right`, `top`, `bottom` | Viewport-relative box edge, or the difference from the same edge of `relativeTo` |
| `padding-top`, `padding-right`, `padding-bottom`, `padding-left`, `row-gap`, `column-gap`, `line-height`, `font-size` | Computed pixel value |
| `stroke-width` | Computed stroke width of the selected SVG node |
| `horizontal-overflow` | Scroll width beyond the element's client width. This measures geometry even when local scrolling is intentional. Set an expected value of zero only where the layout contract requires it. |
| `grid-column-count` | Number of rendered CSS Grid column tracks, including implicit and zero-width tracks |

Expected values and tolerances are numbers in CSS pixels. The default tolerance is 1 px. For strict SVG checks, select the shape with the stroke. A computed keyword such as `line-height: normal` is unavailable.

For `grid-column-count`, use a whole number of tracks and an optional tolerance in tracks. The default is zero. Flex containers and track lists that the browser cannot resolve to pixel lengths, such as subgrid columns, are unavailable. Use width bounds to give the same container separate expectations at narrow and wide sizes.

Use `--ready` for a selector that appears when the initial page is ready to inspect. Watch mode samples the state you open in its browser. Capture mode opens a fresh page for each width and theme. The report lists pass, fail, and unavailable checks. Capture with `--strict` exits with a failure status when any configured measurement fails or is unavailable.


## Shared edge checks

Use `relativeTo` to compare the same physical border-box edge on two visible elements. The check returns the subject coordinate minus the reference coordinate in CSS pixels. For `left`, a positive result means the subject starts farther right. For `right`, a negative result means the subject ends farther left. Use a child selector when the intended edge is the content inside a padded box.

```json
{
  "checks": [
    {
      "id": "toolbar-reading-edge",
      "selector": "#results-toolbar",
      "metric": "left",
      "relativeTo": "#results-title",
      "expected": 0,
      "tolerance": 1
    }
  ]
}
```

In this example the page specification puts the toolbar and heading on the same reading edge. If the toolbar starts at 40 px and the heading starts at 32 px, the report returns `actual: 8` and `status: "fail"`. At 32 px for both edges it returns `actual: 0` and `status: "pass"`.
