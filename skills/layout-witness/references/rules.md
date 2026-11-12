# Layout Witness rules

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

Each check resolves exactly one visible element. Narrow selectors when a component repeats. Add inclusive `minWidth` or `maxWidth` bounds to guides or checks that apply at specific viewport sizes. Rules outside the active width are omitted.

| Metric | What is measured |
| --- | --- |
| `width`, `height` | Rendered border-box dimensions |
| `left`, `right`, `top`, `bottom` | Viewport-relative box edge, or the difference from the same edge of `relativeTo` |
| `padding-top`, `padding-right`, `padding-bottom`, `padding-left`, `row-gap`, `column-gap`, `line-height`, `font-size` | Computed pixel value |
| `stroke-width` | Computed stroke width of the selected SVG node |
| `horizontal-overflow` | Scroll width beyond the element's client width |

Expected values and tolerances are numbers in CSS pixels. The default tolerance is 1 px. For strict SVG checks, select the shape with the stroke. A computed keyword such as `line-height: normal` is unavailable.

Use `--ready` for a selector that appears when the initial page is ready to inspect. Watch mode samples the state you open in its browser. Capture mode opens a fresh page for each width and theme. The report lists pass, fail, and unavailable checks. Capture with `--strict` exits with a failure status when any configured measurement fails or is unavailable.
