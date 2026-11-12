---
name: layout-witness
description: Build and refine web layouts with persistent browser guides, from the page shell to individual controls. Use when implementing or reviewing alignment, spacing, typography, icons, or responsive layout on a running page.
license: MIT
---

# Layout Witness

Make the page easier to scan and use. Give related elements a clear grouping, keep repeated components consistent, and preserve those relationships as content and viewport size change. Use the guides to decide what to fix while you edit.

Use the Chrome extension on the existing development tab. Pair its local agent connection to control guides and read page and element measurements as JSON in the terminal. Use the optional Playwright CLI for unattended captures in fresh browser contexts.

## Connect to the existing tab

Load the complete `layout-witness` skill directory as an unpacked extension from `chrome://extensions`. Use Chrome 116 or later.

1. Set `WITNESS_DIR` to the installed skill directory. Run `(cd "$WITNESS_DIR" && npm ci --omit=dev)` once, then start `node "$WITNESS_DIR/scripts/agent.mjs" serve` in a persistent terminal.
2. Open Layout Witness from the toolbar on the development tab. Under **Agent access**, paste the pairing URL printed by the terminal and choose **Connect agent**. This authorizes the one tab. If access is missing, ask the user to pair that tab once.
3. Use the CLI from any terminal on the same machine. Keep the local server running during edits.

```sh
node "$WITNESS_DIR/scripts/agent.mjs" start
node "$WITNESS_DIR/scripts/agent.mjs" select 'header [aria-label="Search"]'
node "$WITNESS_DIR/scripts/agent.mjs" measure
# Edit the project's CSS and wait for the dev server to apply it.
node "$WITNESS_DIR/scripts/agent.mjs" measure
```

`measure` prints page regions, check results and the currently selected element when available. That element can include its rendered box, margin, border, padding, grid and gap values, typography (including viewport baseline Y when measurable), and SVG geometry. Use a selector that matches one visible element. Keep the selection while editing and read its JSON again after the browser applies the change.

Use `status` to check the connection, `clear` to remove only the element guide, `pick` for manual click selection, `import <rules.json>` to load [project rules](references/rules.md), and `defaults` to restore default rules. Use `stop` to remove both guides and clear the selection for clean review. Use `start` and `select` to resume. Use `disconnect` when done if the tab should stop accepting commands. Same-origin reloads can restore guides and a selection on the same route. A different origin or tab closure ends the pairing.

For manual review, use **Start guides**, **Inspect element**, and **Stop guides** in the toolbar popup. **Download report** is available when you want to save a copy.

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
