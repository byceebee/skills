---
name: layout-witness
description: Build and refine web layouts with persistent browser guides, from the page shell to individual controls. Use when implementing or reviewing alignment, spacing, typography, icons, or responsive layout on a running page.
license: MIT
---

# Layout Witness

Make the page easier to scan and use. Give related elements a clear grouping, keep repeated components consistent, and preserve those relationships as content and viewport size change. Use the guides to decide what to fix while you edit.

Use the Chrome extension first when the page is already open in a logged-in browser tab. It inspects the current page without signing in again or opening a separate browser. Load the extension directly in Chrome. Use the optional Playwright CLI for unattended captures in fresh browser contexts.

## Inspect an existing tab

Load the unpacked extension from the complete installed skill folder:

1. Open `chrome://extensions` and enable Developer mode.
2. Select **Load unpacked**, then choose the entire `layout-witness` skill directory. Its root contains `manifest.json`.
3. Open the target page in Chrome and select Layout Witness from the toolbar.
4. Choose **Start guides** to add guides to the active HTTP(S) tab. To load project-specific checks, open **Layout rules** and choose **Import rules** with a file in the [rules format](references/rules.md).
5. Use **Inspect element** to select a specific part of the page. Click it or press Enter while it is focused. Reopen the popup to read its dimensions, spacing, typography, and SVG geometry when present. **Download report** saves this selection with the page measurements.
6. Choose **Stop guides** to remove the overlay.

Keep guides on during edits. The selected element shows live size, spacing, text and SVG guides directly on the page. Grid tracks and gaps appear when the selected layout can be measured. A baseline appears when a single text line can be measured without moving it. Reopen the popup for the complete report.

The extension restores page guides on same-origin reloads while Chrome retains access. The selected element follows scroll, resize, and CSS edits and can be restored on the same route when its selector still resolves. Activate guides again after moving to another origin. Rules and measurements stay in the browser until you export a report.

## Work with the guides on

1. **Set the expected layout.** Read the project’s layout and component rules, then check the existing tokens and accepted sibling components. Write down the relationships that matter for the task, such as a shared reading edge, a gap between nav groups, or the inline padding of a button. On a new page, choose these relationships from the brief and record your assumptions. Treat the extension’s default grid as an exploratory guide.
2. **Inspect from the page to the element.** Start guides before editing. Capture the rendered starting point and select the element that owns the problem. Use the report for exact measurements when labels are crowded. For a new page, start once the shell renders and keep the guides on as you add sections and controls.
3. **Edit the source with the selection active.** Compare the measured value to the expected one. Fix the CSS or shared component that owns the relationship. When the dev server applies the edit, check the same element’s guides and measurements before choosing another element. If a reload replaces the element, confirm the restored selection still refers to the intended control. Record the actual value, expected value, and measured result.
4. **Review the clean render.** Capture the corrected guide first, then turn guides off and inspect the actual page. Check grouping, hierarchy, alignment, wrapping, and visible focus at the widths where the layout changes. Include long labels or translated content and relevant open, collapsed, or dense states. Report remaining issues and the widths and states you checked.

| Scope | What to inspect |
| --- | --- |
| Page shell | Header, sidebar or rail, main area, and footer. Check shared reading edges, outer gutters, nested column boundaries, and how each region moves or collapses at breakpoints. |
| Groups and repeated components | Check row and column gaps, local grid tracks and spans, card insets, and alignment among peers. Give tightly related content less space between its parts than between separate groups. Verify the reading order when groups stack. |
| Individual elements | Compare padding, borders, and gaps for controls with the same role and size. Inspect the line height and visible baseline of text that shares a row. Check icon box, visible shape, and stroke against peers, then judge optical balance at rendered size. Measure the interactive control separately from its glyph. |

Example: a sidebar action has 8 px inline-start padding and 16 px inline-end padding. Its shared component specifies 16 px on both sides. Keep the action selected, restore its spacing token, and confirm the guides read 16 px on both sides. Then check the label and icon in the expanded and collapsed sidebar. Intentional asymmetry and optical adjustments can be valid. Use the component contract to decide.

Use strict checks for explicit expectations such as token values, alignment between named edges, and overflow. Judge hierarchy and optical balance in the rendered page. When accessibility is in scope, check reflow, user text-spacing overrides, and actual pointer targets against the applicable WCAG criteria, including their exceptions.

## Design references

- Use a spacing scale to express relationships and hierarchy within and between groups. [IBM Carbon spacing](https://www.carbondesignsystem.com/building-blocks/foundations/spacing/overview)
- Check the layout at the widths where regions reflow. Outer spacing can change by breakpoint while some component spacing stays fixed. [GOV.UK layout](https://design-system.service.gov.uk/styles/layout/) and [spacing](https://design-system.service.gov.uk/styles/spacing/)
- Compare icon spacing and stroke within the project’s icon family at the rendered size. [Adobe Spectrum icon fundamentals](https://spectrum.adobe.com/page/iconography/)
- Check content and controls under reflow, user text-spacing overrides, and minimum pointer-target requirements. [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html), and [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

## Optional unattended captures

Use the CLI when automation needs fresh browser contexts across viewport widths or themes. It requires Node.js 22+ and Playwright Chromium. Set `WITNESS_DIR` to the installed skill directory and install its dependencies there:

```sh
(cd "$WITNESS_DIR" && npm ci && npx --no-install playwright install chromium)
```

Run the CLI from the project so its config and output paths resolve there:

```sh
node "$WITNESS_DIR/scripts/witness.mjs" capture http://localhost:3000 \
  --config ./layout-witness.json --width 1440 --width 390 --strict \
  --out .layout-witness/review
```

Read the generated overlay and JSON report. Capture mode opens a fresh page for each width and theme. See the [rules reference](references/rules.md) for region and check definitions. Use `watch` for the interactive CLI workflow.
